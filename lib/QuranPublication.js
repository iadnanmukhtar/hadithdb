'use strict';

const { createHash } = require('node:crypto');
const { gzip, gunzip } = require('node:zlib');
const { promisify } = require('node:util');
const express = require('express');
const downloads = require('./ReaderDownloads');
const compress = promisify(gzip);
const decompress = promisify(gunzip);
const log = require('./Debug')('hadithdb:QuranPublication');
let opening;

function database() {
	if (!opening) opening = downloads.connection().then(async db => {
		await db.run('CREATE TABLE IF NOT EXISTS reader_objects(hash TEXT PRIMARY KEY, encoded BLOB NOT NULL, created INTEGER NOT NULL)');
		await db.run('CREATE TABLE IF NOT EXISTS reader_editions(book TEXT PRIMARY KEY, version INTEGER NOT NULL, manifest TEXT NOT NULL)');
		return db;
	}).catch(error => { opening = null; throw error; });
	return opening;
}

async function object(db, value) {
	const bytes = Buffer.from(JSON.stringify(value));
	const hash = createHash('sha256').update(bytes).digest('hex');
	const existing = await db.get('SELECT created FROM reader_objects WHERE hash=?', hash);
	if (existing && existing.created < Date.now() - 43200000)
		await db.run('UPDATE reader_objects SET created=? WHERE hash=?', [Date.now(), hash]);
	if (!existing)
		await db.run('INSERT OR IGNORE INTO reader_objects VALUES(?,?,?)', [hash, await compress(bytes), Date.now()]);
	return hash;
}

async function publish(book, version, origin) {
	const db = await database();
	const current = await db.get("SELECT version, json_extract(manifest,'$.format') AS format FROM reader_editions WHERE book=?", book.alias);
	if (current?.version === version && current.format === 3) return;
	const manifest = await downloads.shared([book.alias, version, 'reader-publication-v3'], async () => {
		downloads.prepare(book.alias, version);
		const files = {};
		const add = async (path, value) => { files['/quran/api/' + path] = await object(db, value); };
		if (book.alias === 'quran') {
			await add('relationships', await require('./QuranStudyIndex').relationships());
			await add('study-index', await require('./QuranStudyIndex').build());
			const scripts = require('./QuranScripts');
			const outlines = await require('./QuranHeadingOutlines').forSurahs(global.surahs.map(s => Number(s.num)));
			for (const [surah, outline] of Object.entries(outlines)) await add('page-outlines/' + surah, { [surah]: outline });
			const corpus = require('./QuranCorpus');
			for (const chapter of global.surahs) await add('corpus-chapter/' + chapter.num,
				corpus.wordsByAyah(await corpus.wordsForRange(chapter.num, 1, chapter.ayahs)));
			for (let part = 0; part < 29; part++)
				for (const script of ['uthmani', 'indo-pak', 'warsh'])
					await add('text/' + script + '/' + part, await scripts.editionPart(script, part));
			for (let first = 1; first <= 604; first += 8) {
				const numbers = Array.from({ length: Math.min(8, 605 - first) }, (_, i) => first + i);
				const response = await fetch(origin + '/quran/api/page-batch/' + numbers.join(','), { redirect: 'error' });
				if (!response.ok) throw new Error('Page publication failed: ' + response.status);
				const pages = await response.json();
				if (pages.length !== numbers.length || pages.some((page, i) => page.number !== numbers[i])) throw new Error('Incomplete Mushaf pages');
				for (const page of pages) await add('page-data/' + page.number, page);
			}
		} else {
			await add('introductions/' + book.alias, await require('./QuranStudyIndex').introductions(book));
			const lang = book.lang || 'en';
			for (const chapter of global.surahs) {
				const surah = Number(chapter.num);
				const query = new URLSearchParams({ src: book.alias, s: surah, lang, render: 'reader', whole: '1' });
				const entries = await require('../routes/proxy').localTranslationPayload([book.alias], surah, 0, Number(chapter.ayahs), lang, true, false, true);
				await add('proxy/translations/local?' + query, entries);
			}
		}
		return { format: 3, book: book.alias, version, files };
	});
	if (!manifest) return;
	await db.run(`INSERT INTO reader_editions SELECT ?,?,? WHERE EXISTS (
		SELECT 1 FROM downloads,json_each(body) WHERE book='' AND key=? AND value=?
	) ON CONFLICT(book) DO UPDATE SET version=excluded.version,manifest=excluded.manifest
		WHERE reader_editions.version < excluded.version OR (reader_editions.version = excluded.version
		AND json_extract(reader_editions.manifest,'$.format') <= json_extract(excluded.manifest,'$.format'))`,
		[book.alias, version, manifest, book.alias, version]);
}

function start(port) {
	let running = false;
	async function update() {
		if (running) return;
		running = true;
		try {
			const versions = await downloads.versions();
			const books = [{ alias: 'quran' }, ...require('./Tafsir').visibleTranslationsSync().filter(b => b.source === 'local')];
			for (const book of books) {
				if (!versions[book.alias]) continue;
				try { await publish(book, versions[book.alias], 'http://localhost:' + port); }
				catch (error) { log.error('Edition will retry:', book.alias, error.message); }
			}
			const db = await database();
			await db.run("DELETE FROM reader_editions WHERE NOT EXISTS (SELECT 1 FROM downloads,json_each(body) WHERE book='' AND key=reader_editions.book)");
			await db.run(`DELETE FROM reader_objects WHERE created<? AND hash NOT IN
				(SELECT value FROM reader_editions,json_each(manifest,'$.files'))`, Date.now() - 86400000);
		} catch (error) { log.error('Publication will retry:', error.message); }
		finally { running = false; }
	}
	update();
	setInterval(update, 60000).unref();
}

const router = express.Router();
router.get('/editions/:book', async (req, res, next) => {
	try {
		const row = await (await database()).get('SELECT manifest FROM reader_editions WHERE book=?', req.params.book);
		res.set('Cache-Control', 'no-cache');
		if (!row) return res.sendStatus(404);
		res.type('json').send(row.manifest);
	} catch (error) { next(error); }
});
router.get('/files/:hash([0-9a-f]{64})', async (req, res, next) => {
	try {
		const row = await (await database()).get('SELECT encoded FROM reader_objects WHERE hash=?', req.params.hash);
		if (!row) return res.sendStatus(404);
		res.type('json').vary('Accept-Encoding').set('ETag', 'W/ + req.params.hash + ').set('Cache-Control', 'public, max-age=31536000, immutable');
		if (req.acceptsEncodings('gzip')) res.set('Content-Encoding', 'gzip').send(row.encoded);
		else res.send(await decompress(row.encoded));
	} catch (error) { next(error); }
});
module.exports = { start, router };
