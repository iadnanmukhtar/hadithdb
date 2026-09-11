"""Durable ChatKit storage. Every operation is scoped to the signed guest identity."""
import sqlite3
import uuid
from pathlib import Path

from chatkit.store import NotFoundError, Store
from chatkit.types import Page, ThreadItem, ThreadMetadata
from pydantic import TypeAdapter

ITEM = TypeAdapter(ThreadItem)


class SQLiteStore(Store[dict]):
    def __init__(self, filename):
        Path(filename).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(filename)
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS threads (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                id TEXT UNIQUE NOT NULL, owner TEXT NOT NULL, data TEXT NOT NULL,
                touched INTEGER NOT NULL DEFAULT (unixepoch())
            );
            CREATE INDEX IF NOT EXISTS threads_owner ON threads(owner, seq);
            CREATE TABLE IF NOT EXISTS items (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                id TEXT UNIQUE NOT NULL, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
                data TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS items_thread ON items(thread_id, seq);
        """)
        # Expired anonymous conversations are removed on service startup.
        with self.db:
            self.db.execute("DELETE FROM threads WHERE touched < unixepoch() - 2592000")

    def generate_thread_id(self, context):
        return f"thr_{uuid.uuid4().hex}"

    def generate_item_id(self, item_type, thread, context):
        return f"{item_type}_{uuid.uuid4().hex}"

    async def load_thread(self, thread_id, context):
        row = self.db.execute("SELECT data FROM threads WHERE id=? AND owner=?",
                              (thread_id, context['user'])).fetchone()
        if row is None:
            raise NotFoundError("Thread not found")
        return ThreadMetadata.model_validate_json(row[0])

    async def save_thread(self, thread, context):
        with self.db:
            row = self.db.execute("SELECT owner FROM threads WHERE id=?", (thread.id,)).fetchone()
            if row and row[0] != context['user']:
                raise NotFoundError("Thread not found")
            self.db.execute("""INSERT INTO threads(id, owner, data) VALUES(?,?,?)
                ON CONFLICT(id) DO UPDATE SET data=excluded.data, touched=unixepoch()""",
                (thread.id, context['user'], thread.model_dump_json()))

    def _page(self, table, where, args, after, limit, order, adapter):
        # table and where are internal constants, never client input.
        direction, comparison = ('ASC', '>') if order == 'asc' else ('DESC', '<')
        args = list(args)
        if after:
            row = self.db.execute(f"SELECT seq FROM {table} WHERE {where} AND id=?",
                                  [*args, after]).fetchone()
            if row is None:
                raise NotFoundError("Cursor not found")
            where += f" AND seq {comparison} ?"
            args.append(row[0])
        limit = max(1, min(limit or 20, 100))
        rows = self.db.execute(f"SELECT data FROM {table} WHERE {where} ORDER BY seq {direction} LIMIT ?",
                               [*args, limit + 1]).fetchall()
        data = [adapter(row[0]) for row in rows[:limit]]
        return Page(data=data, has_more=len(rows) > limit,
                    after=data[-1].id if len(rows) > limit else None)

    async def load_threads(self, limit, after, order, context):
        return self._page('threads', 'owner=?', [context['user']], after, limit, order,
                          ThreadMetadata.model_validate_json)

    async def load_thread_items(self, thread_id, after, limit, order, context):
        await self.load_thread(thread_id, context)
        return self._page('items', 'thread_id=?', [thread_id], after, limit, order, ITEM.validate_json)

    async def add_thread_item(self, thread_id, item, context):
        await self.save_item(thread_id, item, context)

    async def save_item(self, thread_id, item, context):
        await self.load_thread(thread_id, context)
        if item.thread_id != thread_id:
            raise NotFoundError("Item not found")
        with self.db:
            existing = self.db.execute("SELECT thread_id FROM items WHERE id=?", (item.id,)).fetchone()
            if existing and existing[0] != thread_id:
                raise NotFoundError("Item not found")
            self.db.execute("""INSERT INTO items(id, thread_id, data) VALUES(?,?,?)
                ON CONFLICT(id) DO UPDATE SET data=excluded.data""",
                (item.id, thread_id, item.model_dump_json()))
            self.db.execute("UPDATE threads SET touched=unixepoch() WHERE id=?", (thread_id,))

    async def load_item(self, thread_id, item_id, context):
        await self.load_thread(thread_id, context)
        row = self.db.execute("SELECT data FROM items WHERE id=? AND thread_id=?", (item_id, thread_id)).fetchone()
        if row is None:
            raise NotFoundError("Item not found")
        return ITEM.validate_json(row[0])

    async def delete_thread(self, thread_id, context):
        await self.load_thread(thread_id, context)
        with self.db:
            self.db.execute("DELETE FROM threads WHERE id=? AND owner=?", (thread_id, context['user']))

    async def delete_thread_item(self, thread_id, item_id, context):
        await self.load_thread(thread_id, context)
        with self.db:
            self.db.execute("DELETE FROM items WHERE id=? AND thread_id=?", (item_id, thread_id))

    async def save_attachment(self, attachment, context):
        raise ValueError("Attachments are disabled")

    async def load_attachment(self, attachment_id, context):
        raise NotFoundError("Attachment not found")

    async def delete_attachment(self, attachment_id, context):
        raise NotFoundError("Attachment not found")
