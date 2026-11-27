'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const sqlite3 = require('sqlite3');
const createError = require('http-errors');
const Books = require('./Books');

const catalogLifetime = 30000;
const lease = 60000;
const catalog = ['', 0, 'versions'];

async function loadVersions(query = global.query) {
	const rows = await query("SELECT alias, content_lastmod, lastmod FROM books WHERE alias='quran' OR (hidden=0 AND type IN ('trans','tafsir'))");
	if (!rows.some(row => row.alias === 'quran')) throw new Error('Quran edition missing from book catalog.');
	return Object.fromEntries(rows.map(row => [row.alias, Books.bookVersion(row)]));
}

class ReaderDownloads {
	constructor(filename, loadCatalog = loadVersions, refreshAfter = catalogLifetime) {
		this.filename = filename;
		this.loadCatalog = loadCatalog;
		this.refreshAfter = refreshAfter;
		this.pending = new Map();
	}

	async open() {
		await fs.mkdir(path.dirname(this.filename), { recursive: true });
		const db = await new Promise((resolve, reject) => {
			const connection = new sqlite3.Database(this.filename, error => error ? reject(error) : resolve(connection));
		});
		db.configure('busyTimeout', 10000);
		const exec = promisify(db.exec.bind(db));
		try {
			await exec(`CREATE TABLE IF NOT EXISTS downloads (
				book TEXT NOT NULL, version INTEGER NOT NULL, resource TEXT NOT NULL,
				body TEXT, checked INTEGER DEFAULT 0, owner TEXT, expires INTEGER DEFAULT 0,
				PRIMARY KEY(book, version, resource)
			);
			CREATE TRIGGER IF NOT EXISTS discard_old_editions AFTER UPDATE OF body ON downloads
			WHEN NEW.book='' AND OLD.body IS NOT NEW.body BEGIN
				DELETE FROM downloads WHERE book<>'' AND NOT EXISTS (
					SELECT 1 FROM json_each(NEW.body) WHERE key=downloads.book AND value=downloads.version
				);
			END;`);
		} catch (error) {
			db.close();
			throw error;
		}
		return { get: promisify(db.get.bind(db)), run: promisify(db.run.bind(db)), close: promisify(db.close.bind(db)) };
	}

	connection() {
		if (!this.opening) this.opening = this.open().catch(error => { this.opening = null; throw error; });
		return this.opening;
	}

	// Imports can run outside the web process with their own MySQL connection.
	// Refresh only an existing cache, after the content transaction has committed.
	async catalogChanged(query) {
		try {
			if (!this.opening) await fs.access(this.filename);
			const db = await this.connection();
			await this.pending.get(JSON.stringify(catalog));
			await db.run("UPDATE downloads SET checked=0, owner=NULL, expires=0 WHERE book=''");
			await this.shared(catalog, () => this.loadCatalog(query), this.refreshAfter);
		} catch (error) {
			if (error.code !== 'ENOENT')
				require('./Debug')('hadithdb:ReaderDownloads').error('Could not refresh download versions:', error.message);
			// A cache failure must not undo a committed edit. The next reader retries.
		}
	}

	async versions() {
		const body = await this.shared(catalog, this.loadCatalog, this.refreshAfter);
		return JSON.parse(body);
	}

	prepare(book, version) {
		if (book === 'quran' && this.quranVersion !== version) {
			require('./QuranCacheInvalidation').invalidateQuranMemoryCaches({ allMushaf: true });
			this.quranVersion = version;
		}
	}

	async json(book, resource, build) {
		for (;;) {
			const versions = await this.versions();
			if (!Object.hasOwn(versions, book)) throw createError(404, 'Book edition unavailable.');
			const version = versions[book];
			const body = await this.shared([book, version, resource], async () => {
				this.prepare(book, version);
				return build();
			});
			// A revision published during this build removed the old reservation.
			if (body !== undefined) return body;
		}
	}

	shared(key, build, lifetime) {
		const id = JSON.stringify(key);
		if (!this.pending.has(id))
			this.pending.set(id, this.obtain(key, build, lifetime).finally(() => this.pending.delete(id)));
		return this.pending.get(id);
	}

	async obtain(key, build, lifetime) {
		const db = await this.connection();
		const where = 'book=? AND version=? AND resource=?';
		const token = randomUUID();
		for (;;) {
			const now = Date.now();
			const cutoff = lifetime === undefined ? 0 : now - lifetime;
			const hit = await db.get(`SELECT body FROM downloads WHERE ${where} AND checked>? AND body IS NOT NULL`, [...key, cutoff]);
			if (hit) return hit.body;
			// The current catalog guards insertion as well as publication. A late
			// worker cannot resurrect a superseded edition after the trigger runs.
			const claim = await db.get(`INSERT INTO downloads(book,version,resource,owner,expires)
				SELECT ?,?,?,?,? WHERE ?='' OR EXISTS (
					SELECT 1 FROM downloads, json_each(downloads.body) WHERE downloads.book='' AND key=? AND value=?
				) ON CONFLICT(book,version,resource) DO UPDATE SET owner=excluded.owner,expires=excluded.expires
				WHERE downloads.expires<=? AND (downloads.body IS NULL OR downloads.checked<=?)
				RETURNING owner`, [...key, token, now + lease, key[0], key[0], key[1], now, cutoff]);
			if (claim) break;
			if (key[0] && !await db.get(`SELECT 1 FROM downloads WHERE ${where}`, key)) return undefined;
			await delay(80);
		}
		const owned = where + ' AND owner=?';
		const ownerKey = [...key, token];
		const heartbeat = setInterval(() => db.run(`UPDATE downloads SET expires=? WHERE ${owned}`,
			[Date.now() + lease, ...ownerKey]).catch(() => {}), lease / 3);
		heartbeat.unref();
		try {
			const body = JSON.stringify(await build());
			if (body === undefined) throw new Error('Missing reader download.');
			const published = await db.get(`UPDATE downloads SET body=?, checked=?, owner=NULL, expires=0 WHERE ${owned} RETURNING checked`,
				[body, Date.now(), ...ownerKey]);
			if (published) return body;
			if (!key[0]) return this.obtain(key, build, lifetime);
		} finally {
			clearInterval(heartbeat);
			await db.run(`UPDATE downloads SET owner=NULL,expires=0 WHERE ${owned}`, ownerKey);
		}
	}
}

module.exports = new ReaderDownloads(path.join(os.homedir(), '.hadithdb', 'cache', 'quran-reader-v1.sqlite'));
module.exports.ReaderDownloads = ReaderDownloads;
