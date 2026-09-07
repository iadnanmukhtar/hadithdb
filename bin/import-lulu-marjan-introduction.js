#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const cheerio = require('cheerio');
const mysql = require('mysql');
const { promisify } = require('util');
const { connectionSettings } = require('./initializeHadithAttributions');

async function main() {
 const source = path.resolve('temp', fs.readdirSync('temp').find(name => name.normalize('NFC') === 'اللؤلؤ والمرجان.epub'));
 const zip = new AdmZip(source);
 const pages = [];
 for (let number = 2; number <= 8; number++) {
  const entry = zip.getEntries().find(item => item.entryName.endsWith(`/P${number}.xhtml`));
  if (!entry) throw Error(`Missing introduction page ${number}`);
  const $ = cheerio.load(zip.readAsText(entry), { xmlMode: true });
  const body = $('#book-container');
  body.find('hr').remove();
  body.find('br').replaceWith('\n');
  const text = body.text().replace(/^[\t ]*-[\t ]*(?:ج|د|هـ|و|ز|ح)[\t ]*-[\t ]*$/gmu, '').trim();
  if (!text) throw Error(`Empty introduction page ${number}`);
  pages.push(text);
 }
 if (!pages[0].startsWith('طريقة وضع الكتاب') || !pages[1].startsWith('مقدمة محمد فؤاد عبد الباقي')) throw Error('Unexpected introduction headings');
 // Pages 3/4 and 5/6 split a verse and a quoted hadith, respectively.
 const mainText = pages.slice(1).reduce((text, page, index) => text + (index === 0 ? '' : [1,3].includes(index) ? ' ' : '\n\n') + page, '');
 const plain = `${pages[0]}\n\n${mainText}`;
 // Protect source line breaks and numbering from Markdown list renumbering.
 const escape = text => text.replace(/([\\`*_{}\[\]<>#+.!|~-])/gu, '\\$1');
 const intro = plain.split('\n').map(line => {
  if (line === 'طريقة وضع الكتاب' || line === 'مقدمة محمد فؤاد عبد الباقي') return `## ${line}\n`;
  return escape(line.trim()) + (line.trim() ? '  ' : '');
 }).join('\n').trim();
 fs.writeFileSync('temp/lulu-marjan-introduction.md', intro + '\n');
 console.log(JSON.stringify({ source, pages: 7, characters: plain.length, apply: process.argv.includes('--apply') }));
 if (!process.argv.includes('--apply')) return;
 const db = mysql.createConnection(connectionSettings());
 const q = promisify(db.query).bind(db);
 global.query = q;
 try {
  const book = (await q("SELECT * FROM books WHERE alias='lulu-marjan' AND `virtual`=1"))[0];
  if (!book) throw Error('Missing virtual book');
  const before = await q('SELECT * FROM toc WHERE bookId=? AND h1=0 ORDER BY ordinal,id', [book.id]);
  const parent = before.find(row => row.level === 1);
  if (!parent) throw Error('Missing introduction chapter');
  const existing = before.filter(row => row.lastmod_user === 'epub:lulu-marjan:introduction');
  if (existing.length > 1) throw Error('Ambiguous existing article');
  const links = await q('SELECT id,tocId,num,numInChapter,hadithId FROM hadiths_virtual WHERE bookId=? ORDER BY ordinal,id', [book.id]);
  const backup = `temp/lulu-marjan-introduction-before-${new Date().toISOString().replace(/[:.]/gu,'-')}.json`;
  fs.writeFileSync(backup, JSON.stringify({ book, toc: before, links }, null, 2));
  await q('START TRANSACTION');
  try {
   const articleId = existing[0]?.id || (await require('../lib/CommentaryHeadings').addIntroductionArticle(book.id, {
    title: 'مقدمة محمد فؤاد عبد الباقي', title_en: 'Introduction by Muhammad Fuad Abd al-Baqi'
   }, 'epub:lulu-marjan:introduction')).value.id;
   await q('UPDATE toc SET intro=?,ordinal=?,lastmod=CURRENT_TIMESTAMP(),lastfixed=CURRENT_TIMESTAMP(),lastmod_user=? WHERE id=?', [intro, parent.ordinal, 'epub:lulu-marjan:introduction', articleId]);
   await q('UPDATE books SET content_lastmod=CURRENT_TIMESTAMP() WHERE id=?', [book.id]);
   const saved = (await q('SELECT * FROM toc WHERE id=?', [articleId]))[0];
   if (saved.intro !== intro) throw Error('Stored source text differs');
   const afterLinks = await q('SELECT id,tocId,num,numInChapter,hadithId FROM hadiths_virtual WHERE bookId=? ORDER BY ordinal,id', [book.id]);
   if (JSON.stringify(links) !== JSON.stringify(afterLinks)) throw Error('Hadith links changed');
   await q('COMMIT');
   console.log(JSON.stringify({ articleId, h2: saved.h2, backup, hadithLinksPreserved: links.length, characters: intro.length }));
  } catch (error) { await q('ROLLBACK'); throw error; }
 } finally { db.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
