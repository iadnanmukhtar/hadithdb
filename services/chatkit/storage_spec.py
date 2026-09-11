import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from chatkit.store import NotFoundError
from chatkit.types import ThreadMetadata, UserMessageItem, UserMessageTextContent, InferenceOptions
from storage import SQLiteStore


class StorageSpec(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / 'chat.sqlite3'
        self.store = SQLiteStore(self.path)
        self.a, self.b = {'user': 'alice'}, {'user': 'bob'}
        self.thread = ThreadMetadata(id='thr_a', created_at=datetime.now(timezone.utc))
        await self.store.save_thread(self.thread, self.a)

    async def asyncTearDown(self):
        self.store.db.close()
        self.directory.cleanup()

    async def test_all_thread_operations_enforce_ownership(self):
        item = UserMessageItem(id='msg_a', thread_id='thr_a', created_at=datetime.now(timezone.utc),
                              content=[UserMessageTextContent(text='Hello')], attachments=[],
                              inference_options=InferenceOptions())
        await self.store.add_thread_item('thr_a', item, self.a)
        operations = [
            self.store.load_thread('thr_a', self.b), self.store.save_thread(self.thread, self.b),
            self.store.load_thread_items('thr_a', None, 20, 'asc', self.b),
            self.store.load_item('thr_a', 'msg_a', self.b), self.store.save_item('thr_a', item, self.b),
            self.store.delete_thread_item('thr_a', 'msg_a', self.b), self.store.delete_thread('thr_a', self.b),
        ]
        for operation in operations:
            with self.assertRaises(NotFoundError):
                await operation
        self.assertEqual((await self.store.load_threads(20, None, 'desc', self.b)).data, [])
        self.assertEqual((await self.store.load_item('thr_a', 'msg_a', self.a)).id, 'msg_a')

    async def test_pagination_persistence_and_delete(self):
        for index in range(4):
            thread = self.thread.model_copy(update={'id': f'thr_{index}'})
            await self.store.save_thread(thread, self.a)
        page = await self.store.load_threads(2, None, 'asc', self.a)
        self.assertTrue(page.has_more)
        next_page = await self.store.load_threads(2, page.after, 'asc', self.a)
        self.assertFalse(set(t.id for t in page.data) & set(t.id for t in next_page.data))
        with self.assertRaises(NotFoundError):
            await self.store.load_threads(2, page.after, 'asc', self.b)
        self.store.db.close()
        self.store = SQLiteStore(self.path)
        self.assertEqual((await self.store.load_thread('thr_a', self.a)).id, 'thr_a')
        await self.store.delete_thread('thr_a', self.a)
        with self.assertRaises(NotFoundError):
            await self.store.load_thread('thr_a', self.a)


if __name__ == '__main__':
    unittest.main()
