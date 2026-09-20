#!/usr/bin/env node
'use strict';

// Source-specific, reviewed crosswalk. Never infer a write from a fuzzy match.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const cheerio = require('cheerio');
const mysql = require('mysql');
const { promisify } = require('util');
const { connectionSettings } = require('../initializeHadithAttributions');
const alignment = require('./shamail-qari-alignment.json');
const SOURCE = { bookId: -8, title: 'جمع الوسائل في شرح الشمائل',
	titleEn: 'Jamʿ al-Wasāʾil fī Sharḥ al-Shamāʾil', author: 'علي بن سلطان محمد القاري' };
const BOOK_INTRO = { title: 'مقدمة الكتاب', titleEn: 'Book introduction',
	text: 'تُعرض شروح الكتاب أدناه.', textEn: 'Commentaries on the book appear below.' };
const BOOK_SHARH_ENTRY_ID = -8000000;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
function normalizeHonorifics(text) {
	const mark = '[\\u0610-\\u061A\\u0640\\u064B-\\u065F\\u0670\\u06D6-\\u06ED]*';
	const marked = word => [...word].map(letter => `${letter}${mark}`).join('');
	const phrase = words => words.split(' ').map(marked).join('\\s+');
	// This edition also uses تعالى, عليه الصلاة والسلام, and two page-split formulas.
	// Do not abbreviate incomplete quotations discussing the wording of blessings.
	text = text.replace(new RegExp(`${phrase('صلى الله تعالى عليه وسلم')}|${phrase('عليه الصلاة والسلام')}`, 'gu'), ' ﷺ ');
	text = text.replace(new RegExp(`${phrase('صلى الله')}\\s*-\\s*${phrase('عليه وسلم')}\\s*-|${phrase('صلى الله عليه')}\\s*-\\s*${marked('وسلم')}\\s*-`, 'gu'), ' ﷺ ');
	return require('../../lib/Utils').normalizeArabicHonorifics(text).replace(/[ \t]{2,}/g, ' ').trim();
}

function extract(filename) {
	const bytes = fs.readFileSync(filename);
	if (sha256(bytes) !== alignment.epubSha256) throw new Error('EPUB differs from the reviewed edition');
	const zip = new AdmZip(bytes);
	const opf = cheerio.load(zip.readAsText('OEBPS/content.opf'), { xmlMode: true });
	const manifest = new Map(opf('manifest item').toArray().map(e => [opf(e).attr('id'), opf(e).attr('href')]));
	const spine = opf('spine itemref').toArray().map(e => manifest.get(opf(e).attr('idref')))
		.filter(href => /^xhtml\/P\d+\.xhtml$/.test(href));
	if (spine.length !== 494 || spine.some((href, i) => href !== `xhtml/P${i + 1}.xhtml`))
		throw new Error('Unexpected EPUB spine');
	const parts = [];
	let chapter = 0;
	for (const href of spine.slice(1)) {
		const $ = cheerio.load(zip.readAsText(`OEBPS/${href}`));
		const footer = $('.center').text();
		const volume = Number(footer.match(/الجزء:\s*(\d+)/)?.[1]);
		const printedPage = Number(footer.match(/الصفحة:\s*(\d+)/)?.[1]);
		if (!volume || !printedPage) throw new Error(`Missing page reference: ${href}`);
		const html = $('#book-container').html().replace(/<span class="title">/g, '<br>[[TITLE]]');
		for (const fragment of html.split(/<br>/)) {
			let text = cheerio.load(fragment).text().trim();
			if (!text) continue;
			if (text.startsWith('[[TITLE]]')) { chapter++; text = text.replace('[[TITLE]]', '').trim(); }
			parts.push({ text, chapter, volume, printedPage, page: Number(href.match(/P(\d+)/)[1]) });
		}
	}
	if (parts.length !== 2674 || chapter !== 56) throw new Error('Source structure changed');
	const segments = alignment.segments.map((boundary, i) => {
		const end = alignment.segments[i + 1];
		const start = parts[boundary.part];
		if (start.page !== boundary.page || start.text.slice(boundary.offset, boundary.offset + 100) !== boundary.start)
			throw new Error(`Boundary witness mismatch: ${i}`);
		const text = parts.slice(boundary.part, (end?.part ?? parts.length - 1) + 1).map((p, j) =>
			p.text.slice(j === 0 ? boundary.offset : 0, end && boundary.part + j === end.part ? end.offset : undefined))
			.join('\n\n').trim();
		if (sha256(text) !== boundary.textSha256) throw new Error(`Segment content mismatch: ${i}`);
		return { ...boundary, text, volume: start.volume, printedPage: start.printedPage };
	});
	const compact = text => text.replace(/\s/g, '');
	if (compact(segments.map(s => s.text).join('')) !== compact(parts.map(p => p.text).join('')))
		throw new Error('Source text was lost, duplicated or reordered');
	return segments.map(segment => ({ ...segment, sourceText: segment.text, text: normalizeHonorifics(segment.text) }));
}

function validateTargets(segments, hadiths, headings) {
	const entries = segments.filter(s => s.kind === 'hadith');
	if (hadiths.length !== 417 || entries.length !== 417 || new Set(entries.map(s => s.hadithId)).size !== 417)
		throw new Error('Expected 417 distinct hadiths');
	for (const entry of entries) {
		const target = hadiths.find(h => h.id === entry.hadithId);
		if (!target || Number(target.num) !== entry.num || target.tocId !== entry.tocId || sha256(target.text) !== entry.targetSha256)
			throw new Error(`Target identity changed: shamail:${entry.num}`);
	}
	const chapters = segments.filter(s => s.kind === 'heading');
	if (chapters.length !== 57 || new Set(chapters.map(s => s.tocId)).size !== 57 ||
		chapters.some(s => !headings.some(t => t.id === s.tocId && t.level === 2)))
		throw new Error('Chapter crosswalk changed');
	return { entries, chapters };
}

async function ensureBookSharh(query, bookId, source, opening) {
	const [existing] = await query(`SELECT ts.toc_id,ts.text,t.bookId FROM hdith_toc_sharh ts
		JOIN toc t ON t.id=ts.toc_id WHERE ts.source_id=? AND ts.source_entry_id=? FOR UPDATE`,
		[source.id, BOOK_SHARH_ENTRY_ID]);
	if (existing) {
		if (existing.bookId !== bookId || existing.text !== opening.text) throw new Error('Existing book sharh differs');
		return existing.toc_id;
	}
	// Migrate only this importer's former article; leave independently authored introductions alone.
	const legacy = await query('SELECT * FROM toc WHERE bookId=? AND level=2 AND h1=0 AND title=? FOR UPDATE', [bookId, SOURCE.title]);
	if (legacy.length > 1) throw new Error('Ambiguous legacy book commentary article');
	let article = legacy[0];
	if (article) {
		if (normalizeHonorifics(article.intro) !== opening.text || article.intro_en) throw new Error('Legacy book commentary was edited');
	} else {
		if (!(await query('SELECT id FROM toc WHERE bookId=? AND level=1 AND h1=0', [bookId])).length)
			await query("INSERT INTO toc (ordinal,bookId,level,h1,title,title_en) VALUES (0,?,1,0,'المقدمة','Introduction')", [bookId]);
		const [{ next }] = await query('SELECT COALESCE(MAX(h2),0)+1 next FROM toc WHERE bookId=? AND level=2 AND h1=0', [bookId]);
		const inserted = await query(`INSERT INTO toc (ordinal,bookId,level,h1,h2,title,title_en,intro,intro_en)
			VALUES (?,?,2,0,?,?,?,? ,?)`, [next, bookId, next, BOOK_INTRO.title, BOOK_INTRO.titleEn, BOOK_INTRO.text, BOOK_INTRO.textEn]);
		article = { id: inserted.insertId };
	}
	await query(`INSERT INTO hdith_toc_sharh
		(toc_id,ordinal,source_id,source_entry_id,page_num,title,title_en,text,format,source_url)
		VALUES (?,1,?,?,?,?,?,?,'md','')`,
		[article.id, source.id, BOOK_SHARH_ENTRY_ID, opening.printedPage, source.title, source.title_en, opening.text]);
	await query('UPDATE toc SET title=?,title_en=?,intro=?,intro_en=?,lastfixed=CURRENT_TIMESTAMP() WHERE id=?',
		[BOOK_INTRO.title, BOOK_INTRO.titleEn, BOOK_INTRO.text, BOOK_INTRO.textEn, article.id]);
	await query('UPDATE books SET content_lastmod=CURRENT_TIMESTAMP() WHERE id=?', [bookId]);
	return article.id;
}

async function refresh(sourceId) {
	require('../../lib/Globals');
	try {
		console.log(await require('../../lib/SharhBooks').sync());
		const [book] = await global.query(mysql.format(`SELECT b.id,b.alias FROM books b JOIN sharh_book_mappings m ON m.book_id=b.id
			WHERE m.source_id=? AND m.source_title=''`, [sourceId]));
		if (!book) throw new Error('Source catalog mapping missing');
		if (book.alias === `sharh-${book.id}`)
			await global.query(mysql.format("UPDATE books SET alias='shamail-qari',lang='ar',author_en='ʿAlī al-Qārī' WHERE id=?", [book.id]));
		const index = require('../../lib/HadithSharhIndex');
		await index.ensureIndex();
		let afterId = 0, count = 0;
		while (true) {
			const docs = await index.documents(`hs.source_id=${Number(sourceId)} AND hs.id>${afterId}`);
			if (!docs.length) break;
			await index.writeBatch(docs);
			afterId = docs[docs.length - 1].id;
			count += docs.length;
		}
		if (count !== 417) throw new Error(`Expected 417 indexed commentaries, got ${count}`);
		await require('axios').post(`${global.settings.search.domain}/sharhs/_refresh`, null, require('../../lib/SearchHttp').axiosConfig());
		const Index = require('../../lib/Index');
		const introHeadings = await global.query(`SELECT * FROM v_toc WHERE book_id=${alignment.bookId} AND h1=0 ORDER BY ordinal`);
		await Index.updateBulk('toc', introHeadings);
		await Index.refresh('toc');
		await require('../../lib/Utils').flushBookDiskCache('shamail');
		await require('../../lib/RuntimeRefresh').publish();
		console.log(`Indexed ${count} commentaries; refreshed Shamail caches and runtime catalog.`);
	} finally { await promisify(global.dbPool.end).call(global.dbPool); }
}

// Reclassify an already imported opening without needing the original EPUB again.
async function migrateBookSharh() {
	const connection = mysql.createConnection(connectionSettings());
	const query = promisify(connection.query).bind(connection);
	let source;
	try {
		await require('../../lib/HadithHeadingSharh').ensureSchema(query);
		if (Number((await query("SELECT GET_LOCK('import-shamail-qari',30) locked"))[0].locked) !== 1)
			throw new Error('Import is already running');
		await query('START TRANSACTION');
		try {
			[source] = await query('SELECT * FROM hdith_sharh_sources WHERE source_book_id=? AND author=? FOR UPDATE', [SOURCE.bookId, SOURCE.author]);
			if (!source) throw new Error('Source has not been imported');
			const articles = await query('SELECT * FROM toc WHERE bookId=? AND h1=0 FOR UPDATE', [alignment.bookId]);
			const rows = await query('SELECT * FROM hdith_toc_sharh WHERE source_id=? FOR UPDATE', [source.id]);
			const text = rows.find(row => row.source_entry_id === BOOK_SHARH_ENTRY_ID)?.text || articles.find(row => row.title === SOURCE.title)?.intro;
			const reviewed = alignment.segments.find(row => row.kind === 'book-sharh');
			if (!text || ![reviewed.textSha256, reviewed.normalizedTextSha256, ...(reviewed.previousNormalizedTextSha256 || [])].includes(sha256(text))) throw new Error('Stored book commentary differs from reviewed source');
			const backupDir = path.join(require('os').homedir(), '.hadithdb', 'backups');
			fs.mkdirSync(backupDir, { recursive: true });
			const backup = path.join(backupDir, `shamail-book-sharh-${Date.now()}.json`);
			fs.writeFileSync(backup, JSON.stringify({ source, articles, rows }, null, 2));
			const articleId = await ensureBookSharh(query, alignment.bookId, source, { text, printedPage: reviewed.page });
			const [stored] = await query('SELECT text FROM hdith_toc_sharh WHERE source_id=? AND source_entry_id=? AND toc_id=?', [source.id, BOOK_SHARH_ENTRY_ID, articleId]);
			if (stored?.text !== text) throw new Error('Book sharh exact-text audit failed');
			await query('COMMIT');
			console.log(JSON.stringify({ articleId, sourceId: source.id, bookSharhCharacters: text.length, exactTextVerified: true, backup }));
		} catch (error) { await query('ROLLBACK'); throw error; }
		finally { await query("SELECT RELEASE_LOCK('import-shamail-qari')"); }
	} finally { connection.end(); }
	await refresh(source.id);
}

async function normalizeImportedHonorifics(apply) {
	const connection = mysql.createConnection(connectionSettings());
	const query = promisify(connection.query).bind(connection);
	let source, changed = 0;
	try {
		if (Number((await query("SELECT GET_LOCK('import-shamail-qari',30) locked"))[0].locked) !== 1)
			throw new Error('Import is already running');
		await query('START TRANSACTION');
		try {
			[source] = await query('SELECT * FROM hdith_sharh_sources WHERE source_book_id=? AND author=?', [SOURCE.bookId, SOURCE.author]);
			if (!source) throw new Error('Source has not been imported');
			const tables = ['hdith_hadith_sharh', 'hdith_toc_sharh'];
			const snapshot = {};
			const plans = {};
			for (const table of tables) {
				const rows = await query(`SELECT * FROM ${table} WHERE source_id=? FOR UPDATE`, [source.id]);
				snapshot[table] = rows;
				if (rows.length !== (table === 'hdith_hadith_sharh' ? 417 : 57)) throw new Error('Unexpected source row count');
				plans[table] = [];
				for (const row of rows) {
					const witness = alignment.segments.find(s => table === 'hdith_hadith_sharh'
						? s.kind === 'hadith' && s.hadithId === row.hadith_id
						: row.source_entry_id === BOOK_SHARH_ENTRY_ID ? s.kind === 'book-sharh'
							: s.kind === 'heading' && !s.headingOnly && s.tocId === row.toc_id);
					if (!witness || ![witness.textSha256, witness.normalizedTextSha256, ...(witness.previousNormalizedTextSha256 || [])].includes(sha256(row.text)))
						throw new Error(`Stored source text was edited: ${table}/${row.id}`);
					const text = normalizeHonorifics(row.text);
					if (sha256(text) !== witness.normalizedTextSha256) throw new Error(`Normalized source witness mismatch: ${row.id}`);
					if (text !== row.text) plans[table].push([row.id, text]);
				}
				console.log(`${table}: ${rows.length} rows audited; ${plans[table].length} honorific updates.`);
				changed += plans[table].length;
			}
			if (!apply || !changed) { await query('ROLLBACK'); return; }
			const backupDir = path.join(require('os').homedir(), '.hadithdb', 'backups');
			fs.mkdirSync(backupDir, { recursive: true });
			const backup = path.join(backupDir, `shamail-qari-honorifics-${Date.now()}.json`);
			fs.writeFileSync(backup, JSON.stringify({ source, ...snapshot }, null, 2));
			await query('CREATE TEMPORARY TABLE shamail_honorific_updates (id BIGINT PRIMARY KEY,text LONGTEXT NOT NULL)');
			for (const table of tables) {
				for (let start = 0; start < plans[table].length; start += 50) {
					await query('INSERT INTO shamail_honorific_updates (id,text) VALUES ?', [plans[table].slice(start, start + 50)]);
					await query(`UPDATE ${table} s JOIN shamail_honorific_updates u ON u.id=s.id SET s.text=u.text WHERE s.source_id=?`, [source.id]);
					await query('DELETE FROM shamail_honorific_updates');
				}
				const after = await query(`SELECT * FROM ${table} WHERE source_id=?`, [source.id]);
				for (const before of snapshot[table]) {
					const row = after.find(r => r.id === before.id);
					if (!row || JSON.stringify(row) !== JSON.stringify({ ...before, text: normalizeHonorifics(before.text) }))
						throw new Error(`Exact-text or metadata-preservation audit failed: ${table}/${before.id}`);
				}
			}
			await query('UPDATE books SET content_lastmod=CURRENT_TIMESTAMP() WHERE id=?', [alignment.bookId]);
			await query('COMMIT');
			console.log(JSON.stringify({ changed, backup, exactTextVerified: true, metadataPreserved: true }));
		} catch (error) { await query('ROLLBACK'); throw error; }
		finally { await query("SELECT RELEASE_LOCK('import-shamail-qari')"); }
	} finally { connection.end(); }
	if (apply && changed) await refresh(source.id);
}

async function main() {
	if (process.argv.includes('--normalize-honorifics')) return normalizeImportedHonorifics(process.argv.includes('--apply'));
	if (process.argv.includes('--migrate-book-sharh')) return migrateBookSharh();
	const filename = path.resolve(process.argv.find(a => a.startsWith('--epub='))?.slice(7) || 'temp/جمع الوسائل في شرح الشمائل.epub');
	const segments = extract(filename);
	const connection = mysql.createConnection(connectionSettings());
	const query = promisify(connection.query).bind(connection);
	const auditDir = path.resolve('temp/shamail-qari-audit');
	fs.mkdirSync(auditDir, { recursive: true });
	try {
		const book = (await query('SELECT id FROM books WHERE alias=?', [alignment.bookAlias]))[0];
		if (book?.id !== alignment.bookId) throw new Error('Target book identity changed');
		const hadiths = await query('SELECT id,num,tocId,text FROM hadiths WHERE bookId=? ORDER BY ordinal', [book.id]);
		const headings = await query('SELECT * FROM toc WHERE bookId=? ORDER BY ordinal', [book.id]);
		const { entries, chapters } = validateTargets(segments, hadiths, headings);
		const intros = chapters.filter(s => !s.headingOnly);
		const bookSharh = segments.find(s => s.kind === 'book-sharh');
		const report = { epubSha256: alignment.epubSha256, hadiths: entries.length, chapterIntros: intros.length,
			headingOnly: chapters.filter(s => s.headingOnly).map(s => s.tocId), bookSharhCharacters: bookSharh.text.length,
			sourceCharacters: segments.reduce((n, s) => n + s.text.length, 0), textConservation: true,
			segments: segments.map(({ text, sourceText, ...s }) => s) };
		fs.writeFileSync(path.join(auditDir, 'validated.json'), JSON.stringify(report, null, 2) + '\n');
		console.log(JSON.stringify({ ...report, segments: undefined }));
		if (process.argv.includes('--refresh')) {
			const [source] = await query('SELECT id FROM hdith_sharh_sources WHERE source_book_id=? AND author=?', [SOURCE.bookId, SOURCE.author]);
			if (!source) throw new Error('Source has not been imported');
			await refresh(source.id);
			return;
		}
		if (!process.argv.includes('--apply')) return;
		await require('../../lib/HadithHeadingSharh').ensureSchema(query);
		if (Number((await query("SELECT GET_LOCK('import-shamail-qari',30) locked"))[0].locked) !== 1)
			throw new Error('Import is already running');
		await query('START TRANSACTION');
		let source;
		try {
			// Lock and revalidate target text before writing.
			validateTargets(segments, await query('SELECT id,num,tocId,text FROM hadiths WHERE bookId=? FOR UPDATE', [book.id]),
				await query('SELECT * FROM toc WHERE bookId=? FOR UPDATE', [book.id]));
			source = (await query('SELECT * FROM hdith_sharh_sources WHERE source_book_id=? FOR UPDATE', [SOURCE.bookId]))[0];
			if (source && source.author !== SOURCE.author) throw new Error('Source ID belongs to another author');
			const previous = source ? await query('SELECT * FROM hdith_hadith_sharh WHERE source_id=?', [source.id]) : [];
			const previousIntros = source ? await query('SELECT * FROM hdith_toc_sharh WHERE source_id=?', [source.id]) : [];
			fs.writeFileSync(path.join(auditDir, `backup-${Date.now()}.json`), JSON.stringify({ source, previous, previousIntros, headings }, null, 2));
			if (!source) {
				await query('INSERT INTO hdith_sharh_sources (source_book_id,title,title_en,author,source_url) VALUES (?,?,?,?,?)',
					[SOURCE.bookId, SOURCE.title, SOURCE.titleEn, SOURCE.author, '']);
				source = (await query('SELECT * FROM hdith_sharh_sources WHERE source_book_id=?', [SOURCE.bookId]))[0];
			}
			for (const entry of entries) {
				// The legacy unique key omits source_id. Reserve this source's negative namespace.
				const entryId = -8000000 - entry.num;
				const old = (await query('SELECT source_id,text FROM hdith_hadith_sharh WHERE hadith_id=? AND source_entry_id=?', [entry.hadithId, entryId]))[0];
				if (old) {
					if (old.source_id !== source.id || old.text !== entry.text) throw new Error(`Existing commentary differs: ${entry.num}`);
					continue;
				}
				await query(`INSERT INTO hdith_hadith_sharh
					(hadith_id,ordinal,source_id,source_entry_id,chapter,page_num,title,title_en,text,format,source_url)
					VALUES (?,?,?,?,?,?,?,?,?,'md','')`, [entry.hadithId, entry.num, source.id, entryId,
					headings.find(t => t.id === entry.tocId).title, entry.printedPage, source.title, source.title_en, entry.text]);
			}
			for (const intro of intros) {
				const old = (await query('SELECT text FROM hdith_toc_sharh WHERE toc_id=? AND source_id=? AND source_entry_id=?',
					[intro.tocId, source.id, intro.tocId]))[0];
				if (old) {
					if (old.text !== intro.text) throw new Error(`Existing chapter commentary differs: ${intro.tocId}`);
					continue;
				}
				await query(`INSERT INTO hdith_toc_sharh
					(toc_id,source_id,source_entry_id,page_num,title,title_en,text,format,source_url) VALUES (?,?,?,?,?,?,?,'md','')`,
					[intro.tocId, source.id, intro.tocId, intro.printedPage, source.title, source.title_en, intro.text]);
			}
			const bookIntroId = await ensureBookSharh(query, book.id, source, bookSharh);
			const stored = await query('SELECT hadith_id,text FROM hdith_hadith_sharh WHERE source_id=?', [source.id]);
			const storedIntros = await query('SELECT toc_id,text FROM hdith_toc_sharh WHERE source_id=?', [source.id]);
			if (stored.length !== entries.length || entries.some(e => !stored.some(s => s.hadith_id === e.hadithId && s.text === e.text)) ||
				storedIntros.length !== intros.length + 1 || intros.some(e => !storedIntros.some(s => s.toc_id === e.tocId && s.text === e.text)) ||
				!storedIntros.some(s => s.toc_id === bookIntroId && s.text === bookSharh.text))
				throw new Error('Post-write exact-text audit failed');
			await query('COMMIT');
			fs.writeFileSync(path.join(auditDir, 'applied.json'), JSON.stringify({ sourceId: source.id, hadiths: stored.length,
				chapterIntros: intros.length, bookSharhs: 1, bookIntroId, exactTextVerified: true, appliedAt: new Date().toISOString() }, null, 2));
		} catch (error) { await query('ROLLBACK'); throw error; }
		finally { await query("SELECT RELEASE_LOCK('import-shamail-qari')"); }
		console.log(`Imported/verified source ${source.id}: 417 hadith commentaries, 56 chapter introductions and book sharh.`);
		await refresh(source.id);
	} finally { connection.end(); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { extract, validateTargets, sha256, ensureBookSharh, BOOK_INTRO, normalizeHonorifics };
