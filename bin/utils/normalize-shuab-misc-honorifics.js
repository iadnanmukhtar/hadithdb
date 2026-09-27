#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs = require('fs');
const assert = require('assert/strict');
const crypto = require('crypto');
const mysql = require('mysql');
const { promisify } = require('util');
const { normalizeField } = require('./normalize-hadith-honorifics');
const REPORT = 'temp/mishkat-import-review.json';
const PREFIX = 'temp/shuab-misc-honorifics';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function changes(rows, fields) {
	return rows.map(row => {
		const patch = Object.fromEntries(fields.map(k => [k, normalizeField(row[k])]));
		return fields.some(k => patch[k] !== row[k]) ? { id: row.id, ...patch } : null;
	}).filter(Boolean);
}
async function main() {
	const db = mysql.createConnection(require('../initializeHadithAttributions').connectionSettings());
	const q = promisify(db.query).bind(db);
	try {
		const rows = await q("SELECT h.* FROM hadiths h JOIN books b ON b.id=h.bookId WHERE (b.alias='shuab' AND h.lastmod_user='epub:shuab') OR (b.alias='misc' AND h.lastmod_user='epub:mishkat-misc') ORDER BY h.id");
		assert.equal(rows.filter(r => r.bookId === 100420).length, 10725);
		const [mishkat] = await q("SELECT properties FROM books WHERE alias='mishkat'");
		assert.equal(rows.filter(r => r.bookId === 9999).length, JSON.parse(mishkat.properties).mishkatMiscImport.entries);
		const aliases = await q('SELECT * FROM hadiths_virtual WHERE hadithId IN (?) ORDER BY id', [rows.map(r => r.id)]);
		const physical = changes(rows, ['chain', 'body', 'footnote']);
		physical.forEach(r => { r.text = [r.chain, r.body].filter(Boolean).join(' ').trim(); });
		const virtual = changes(aliases, ['textActual', 'note']);
		const summary = { scanned: rows.length, shuab: physical.filter(r => rows.find(x => x.id === r.id).bookId === 100420).length, misc: physical.filter(r => rows.find(x => x.id === r.id).bookId === 9999).length, aliases: virtual.length };
		console.log(summary);
		fs.writeFileSync(`${PREFIX}-plan.json`, JSON.stringify({ summary, physical, virtual }, null, 2));
		if (!process.argv.includes('--apply') || !physical.length && !virtual.length) return;
		const books = await q('SELECT * FROM books WHERE id IN (?)', [[...new Set([...rows, ...aliases].map(r => r.bookId))]]);
		const bytes = fs.readFileSync(REPORT), report = JSON.parse(bytes);
		const backup = `${PREFIX}-before-${Date.now()}.json`;
		fs.writeFileSync(backup, JSON.stringify({ books, rows, aliases, report }));
		const entries = new Map(report.entries.map(e => [e.number, e]));
		for (const row of rows.filter(r => r.bookId === 9999)) {
			const entry = entries.get(Number(row.num.replace('mishkat-', '')));
			assert(entry && entry.links.some(l => l.id === row.id));
			assert.equal(entry.text, row.body);
			assert.equal(entry.footnote, row.footnote);
			entry.text = normalizeField(entry.text);
			entry.footnote = normalizeField(entry.footnote);
		}
		const nextReport = JSON.stringify(report, null, 2);
		await q('START TRANSACTION');
		try {
			for (const [table, before, patches, fields] of [
				['hadiths', rows, physical, ['chain', 'body', 'footnote', 'text']],
				['hadiths_virtual', aliases, virtual, ['textActual', 'note']]
			]) {
				if (!patches.length) continue;
				const locked = await q(`SELECT * FROM ${table} WHERE id IN (?) ORDER BY id FOR UPDATE`, [patches.map(r => r.id)]);
				const old = new Map(before.map(r => [r.id, r]));
				for (const row of locked) assert.deepEqual(row, old.get(row.id));
				const temp = `normalized_${table}`;
				await q(`CREATE TEMPORARY TABLE ${temp} (id INT PRIMARY KEY, ${fields.map(k => `\`${k}\` LONGTEXT NULL`).join(',')})`);
				for (let i = 0; i < patches.length; i += 100) await q(`INSERT INTO ${temp} VALUES ?`, [patches.slice(i, i + 100).map(r => [r.id, ...fields.map(k => r[k])])]);
				await q(`UPDATE ${table} h JOIN ${temp} n ON n.id=h.id SET ${fields.map(k => `h.\`${k}\`=n.\`${k}\``).join(',')}`);
				// The legacy update trigger derives search_body from OLD.body; a second update synchronizes it.
				if (table === 'hadiths') await q(`UPDATE hadiths h JOIN ${temp} n ON n.id=h.id SET h.body=h.body`);
				const after = await q(`SELECT * FROM ${table} WHERE id IN (?) ORDER BY id`, [patches.map(r => r.id)]);
				const expected = new Map(patches.map(r => [r.id, r]));
				for (const row of after) for (const key of Object.keys(row).filter(k => !['lastmod', 'search_chain', 'search_body', 'search_text'].includes(k))) assert.deepEqual(row[key], fields.includes(key) ? expected.get(row.id)[key] : old.get(row.id)[key], `${table}:${row.id}:${key}`);
				if (table === 'hadiths') {
					const [audit] = await q(`SELECT COUNT(*) n FROM hadiths h JOIN ${temp} n ON n.id=h.id WHERE NOT (h.search_body <=> remove_tashkil(h.body)) OR NOT (h.search_chain <=> remove_tashkil(h.chain)) OR NOT (h.search_text <=> remove_tashkil(CONCAT(COALESCE(h.chain,''),' ',COALESCE(h.body,''),' ',COALESCE(h.footnote,''))))`);
					assert.equal(audit.n, 0);
				}
			}
			assert.equal(sha(fs.readFileSync(REPORT)), sha(bytes));
			const book = books.find(r => r.alias === 'mishkat');
			const props = JSON.parse(book.properties);
			props.mishkatImport.reportSha256 = sha(nextReport);
			await q('UPDATE books SET properties=?,content_lastmod=NOW() WHERE id=?', [JSON.stringify(props), book.id]);
			if (physical.length) await q('UPDATE books SET content_lastmod=NOW() WHERE id IN (?)', [[...new Set(physical.map(r => rows.find(x => x.id === r.id).bookId))]]);
			await q('COMMIT');
		} catch (error) { await q('ROLLBACK'); throw error; }
		fs.writeFileSync(REPORT, nextReport);
		fs.writeFileSync(`${PREFIX}-applied.json`, JSON.stringify({ backup, summary, physical, virtual, verified: true }, null, 2));
		console.log({ applied: true, verified: true, backup });
	} finally { db.destroy(); }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { changes };
