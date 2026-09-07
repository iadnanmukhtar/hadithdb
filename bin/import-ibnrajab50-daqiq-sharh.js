#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const cheerio = require('cheerio');
const mysql = require('mysql');
const util = require('util');
const { connectionSettings } = require('./initializeHadithAttributions');
const HadithHeadingSharh = require('../lib/HadithHeadingSharh');
const Utils = require('../lib/Utils');
const ALIAS = 'ibnrajab50';
const SOURCE = { bookId: -6, title: 'شرح الأربعين النووية لابن دقيق العيد',
	titleEn: 'Explanation of the Forty Hadith (Ibn Daqīq al-ʿĪd)', author: 'ابن دقيق العيد' };
const clean = text => text.replace(/\u00a0/g, ' ').split('\n').map(s => s.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const normalize = text => String(text || '').normalize('NFKD').replace(/[\u064B-\u065F\u0670\u06D6-\u06EDـ]/gu, '').replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function overlap(a, b) {
	const left = new Set(normalize(a).split(' ').filter(w => w.length >= 3));
	const right = new Set(normalize(b).split(' ').filter(w => w.length >= 3));
	return [...left].filter(w => right.has(w)).length / Math.max(1, Math.min(left.size, right.size));
}
function extract(epub) {
	const zip = new AdmZip(epub);
	const opf = cheerio.load(zip.readAsText('OEBPS/content.opf'), { xmlMode: true });
	const manifest = new Map(opf('manifest item').map((i, e) => [[opf(e).attr('id'), opf(e).attr('href')]]).get());
	const sections = [];
	let current;
	for (const node of opf('spine itemref').toArray()) {
		const href = manifest.get(opf(node).attr('idref'));
		if (!/^xhtml\/P\d+\.xhtml$/.test(href)) continue;
		const $ = cheerio.load(zip.readAsText(`OEBPS/${href}`));
		const container = $('#book-container');
		const anchor = container.find('a[id^="C"]').attr('id');
		const page = Number($('.center').text().match(/الصفحة:\s*(\d+)/u)?.[1]);
		if (anchor) {
			const number = Number(anchor.slice(1)) - 1;
			if (number !== sections.length) throw new Error(`Unexpected section ${anchor}`);
			if (number && Number(container.find('.red').first().text().match(/\d+/)?.[0]) !== number)
				throw new Error(`Printed number mismatch: ${anchor}`);
			current = { number, anchor, page, pages: [], notes: [] };
			sections.push(current);
		}
		if (!current) throw new Error('Content before introduction');
		container.find('br').replaceWith('\n\n');
		container.find('.footnote').each((i, e) => {
			current.notes.push(`حواشي الصفحة ${page}\n\n${clean($(e).text())}`);
			$(e).remove();
		});
		container.find('.footnote-hr').remove();
		container.find('.matn-hr').replaceWith('\n[[COMMENTARY]]\n');
		current.pages.push({ page, text: clean(container.text()) });
	}
	if (sections.length !== 43) throw new Error(`Expected introduction and 42 hadiths, got ${sections.length}`);
	for (const section of sections) {
		const full = section.pages.map(p => p.text).join('\n\n');
		let boundary = full.indexOf('[[COMMENTARY]]');
		if (!section.number) {
			section.source = '';
			section.text = full.replaceAll('[[COMMENTARY]]', '\n\n');
		} else if ([2, 19, 29, 37].includes(section.number)) {
			// In this EPUB these four source quotations occupy their whole first page.
			section.source = section.pages[0].text;
			section.text = section.pages.slice(1).map(p => p.text).join('\n\n');
		} else {
			if (boundary < 0) throw new Error(`No commentary boundary for ${section.number}`);
			section.source = full.slice(0, boundary);
			section.text = full.slice(boundary + '[[COMMENTARY]]'.length);
		}
		section.text = clean([section.text, ...section.notes].join('\n\n'));
		if (section.text.length < 100 || section.text.includes('[[COMMENTARY]]')) throw new Error(`Invalid text ${section.number}`);
	}
	return sections;
}
async function main() {
	const epub = path.resolve(process.argv.find(a => a.startsWith('--epub='))?.slice(7) ||
		'temp/' + fs.readdirSync('temp').find(f => f.endsWith('.epub') && f.normalize('NFC').includes('دقيق')));
	const sections = extract(epub);
	const connection = mysql.createConnection(connectionSettings());
	const query = util.promisify(connection.query).bind(connection);
	try {
		const book = (await query('SELECT id FROM books WHERE alias=? AND `virtual`=1', [ALIAS]))[0];
		if (!book) throw new Error('Target book missing');
		const primary = await query(`SELECT hv.id,hv.num0,hv.hadithId,hv.tocId,t.title chapter,
			COALESCE(NULLIF(hv.textActual,''),NULLIF(h.text,''),CONCAT_WS(' ',h.chain,h.body)) matchText
			FROM hadiths_virtual hv LEFT JOIN hadiths h ON h.id=hv.hadithId JOIN toc t ON t.id=hv.tocId
			WHERE hv.bookId=? AND hv.num0 BETWEEN 1 AND 42 AND hv.num0=FLOOR(hv.num0) ORDER BY hv.num0`, [book.id]);
		if (primary.length !== 42) throw new Error('Expected exactly 42 primary entries');
		const rows = sections.slice(1).map(section => {
			const target = primary.find(row => Number(row.num0) === section.number);
			const score = overlap(section.source, target.matchText);
			const reviewedPhrase = { 32: 'لا ضرر ولا ضرار', 41: 'لا يؤمن أحدكم حتى يكون هواه تبعا لما جئت به' }[section.number];
			const reviewed = reviewedPhrase && normalize(target.matchText).includes(normalize(reviewedPhrase));
			if (score < 0.4 && !reviewed) throw new Error(`Identity review required for ${section.number}: ${score}`);
			if (!target.hadithId) throw new Error(`Missing primary link ${section.number}`);
			return { ...section, ...target, score };
		});
		const audit = { epub, sha256: crypto.createHash('sha256').update(fs.readFileSync(epub)).digest('hex'),
			introductionCharacters: sections[0].text.length,
			rows: rows.map(r => ({ number: r.number, virtualId: r.id, hadithId: r.hadithId, tocId: r.tocId,
				page: r.page, score: r.score, characters: r.text.length, notes: r.notes.length })) };
		fs.writeFileSync('temp/ibnrajab50-daqiq-import-audit.json', JSON.stringify(audit, null, 2) + '\n');
		console.log(JSON.stringify(audit, null, 2));
		if (!process.argv.includes('--apply')) return;
		await HadithHeadingSharh.ensureSchema(query);
		await query('START TRANSACTION');
		try {
			const existing = (await query('SELECT * FROM hdith_sharh_sources WHERE source_book_id=?', [SOURCE.bookId]))[0];
			if (existing && existing.author !== SOURCE.author) throw new Error('Source ID already owned by another author');
			await query(`INSERT INTO hdith_sharh_sources (source_book_id,title,title_en,author,source_url)
				VALUES (?,?,?,?,'') ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`, [SOURCE.bookId,SOURCE.title,SOURCE.titleEn,SOURCE.author]);
			const source = (await query('SELECT id FROM hdith_sharh_sources WHERE source_book_id=?', [SOURCE.bookId]))[0];
			for (const row of rows) {
				await query(`INSERT INTO hdith_hadith_sharh
					(hadith_id,ordinal,source_id,source_entry_id,chapter,page_num,title,title_en,text,text_en,format,source_url)
					VALUES (?,?,?,?,?,?,?,?,?,NULL,'md','') ON DUPLICATE KEY UPDATE text=VALUES(text),page_num=VALUES(page_num)`,
					[row.hadithId,row.number,source.id,row.number,row.chapter,row.page,SOURCE.title,SOURCE.titleEn,row.text]);
			}
			// A separate attributed article preserves any existing authored introduction.
			let intro = (await query('SELECT id,intro FROM toc WHERE bookId=? AND level=2 AND h1=0 AND title=?', [book.id,SOURCE.title]))[0];
			if (intro && intro.intro !== sections[0].text) throw new Error('Existing introduction differs; refusing to overwrite');
			if (!intro) {
				if (!(await query('SELECT id FROM toc WHERE bookId=? AND level=1 AND h1=0',[book.id])).length)
					await query("INSERT INTO toc (ordinal,bookId,level,h1,title,title_en) VALUES (0,?,1,0,'المقدمة','Introduction')",[book.id]);
				const [{ next }] = await query('SELECT COALESCE(MAX(h2),0)+1 next FROM toc WHERE bookId=? AND level=2 AND h1=0',[book.id]);
				await query(`INSERT INTO toc (ordinal,bookId,level,h1,h2,title,title_en,intro,intro_en)
					VALUES (?,?,2,0,?,?,?,?,'')`,[next,book.id,next,SOURCE.title,SOURCE.titleEn,sections[0].text]);
			}
			await query('COMMIT');
		} catch (error) { await query('ROLLBACK'); throw error; }
		await Utils.flushCacheContaining(ALIAS);
		await Utils.flushCacheContaining(`book:${ALIAS}`);
		console.log('Imported introduction and 42 primary-hadith commentaries.');
	} finally { connection.end(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { extract, overlap };
