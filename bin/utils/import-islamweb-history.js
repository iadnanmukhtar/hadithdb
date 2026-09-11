#!/usr/bin/env node
'use strict';
// Source-faithful import of Islamweb book 200. Dry-run by default; cached pages permit resumption.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const mysql = require('mysql');
const { promisify } = require('util');
const { normalizeField } = require('./normalize-hadith-honorifics');

const BOOK_ID = 200;
const FIRST_PAGE = 16068;
const LAST_PAGE = 23060;
const SOURCE = `https://www.islamweb.net/ar/library/content/${BOOK_ID}/${FIRST_PAGE}/index.php`;
const ALIAS = 'history';
const CACHE = path.resolve('var/imports/islamweb-history-200-vocalized');

function cleanText($, element) {
 const copy = $(element).clone();
 copy.find('script,style,.quranatt,[style*="display:none"],[style*="display: none"]').remove();
 copy.find('br').replaceWith('\n');
 return copy.text().replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function readerHeadings(headings) {
 return headings.length <= 3 ? headings : [headings[0], headings[1], headings.slice(2).join(' — ')];
}

function parsePage(html, expectedId) {
 const $ = cheerio.load(html);
 const article = $('[itemscope][itemtype="http://schema.org/Article"]');
 if (article.length !== 1) throw new Error(`Expected one article container on Islamweb page ${expectedId}; found ${article.length}`);
 const articleBody = article.find('#pagebody_thaskeel.bookcontent-dic');
 if (articleBody.length !== 1) throw new Error(`Expected one vocalized article body on Islamweb page ${expectedId}; found ${articleBody.length}`);
 const current = Number(article.find('#currentpage').first().val());
 if (current !== Number(expectedId)) throw new Error(`Wrong Islamweb page identity ${expectedId}: ${current || 'missing'}`);
 const breadcrumbs = $('#topPath [itemprop="name"]').map((_, node) => $(node).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean);
 if (breadcrumbs[0] !== 'موسوعة السيرة النبوية والتاريخ الإسلامي' || breadcrumbs.length < 3)
  throw new Error(`Invalid breadcrumbs on Islamweb page ${expectedId}`);
 const body = cleanText($, articleBody);
 if (!body) throw new Error(`Empty Islamweb page ${expectedId}`);
 const title = breadcrumbs.at(-1);
 const sourceHeadings = breadcrumbs.slice(1, -1);
 const headings = readerHeadings(sourceHeadings);
 const canonical = $('link[rel="canonical"]').attr('href') || `${SOURCE.replace(`/${FIRST_PAGE}/index.php`, '')}/${expectedId}/index.php`;
 return { source_page_id: Number(expectedId), title, headings, source_headings: sourceHeadings, body, source_url: canonical };
}

async function fetchPage(id) {
 const file = path.join(CACHE, `${id}.json`);
 if (fs.existsSync(file)) {
  const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!cached.source_headings) cached.source_headings = [...cached.headings];
  return cached;
 }
 const url = `https://www.islamweb.net/ar/library/content/${BOOK_ID}/${id}/index.php`;
 for (let attempt = 1; attempt <= 5; attempt++) {
  try {
   const response = await axios.get(url, { timeout: 45000, headers: { 'User-Agent': 'HadithDB source preservation importer/1.0' } });
   const page = parsePage(response.data, id);
   fs.writeFileSync(`${file}.tmp`, JSON.stringify(page));
   fs.renameSync(`${file}.tmp`, file);
   return page;
  } catch (error) {
   if (attempt === 5) throw error;
   await new Promise(resolve => setTimeout(resolve, attempt * 750));
  }
 }
}

async function mapLimit(rows, limit, fn) {
 let cursor = 0;
 await Promise.all(Array.from({ length: limit }, async () => {
  while (cursor < rows.length) { const index = cursor++; await fn(rows[index], index); }
 }));
}

function headingRuns(pages) {
 const roots = [];
 let stack = [];
 pages.forEach((page, pageIndex) => {
  let shared = 0;
  while (shared < stack.length && shared < page.headings.length && stack[shared].title === page.headings[shared]) shared++;
  stack = stack.slice(0, shared);
  for (let depth = shared; depth < page.headings.length; depth++) {
   const node = { level: depth + 1, title: page.headings[depth], startIndex: pageIndex, endIndex: pageIndex, children: [] };
   if (depth) stack[depth - 1].children.push(node); else roots.push(node);
   stack.push(node);
  }
  stack.forEach(node => { node.endIndex = pageIndex; });
  page.headingNode = stack.at(-1);
 });
 return roots;
}

async function scrape() {
 fs.mkdirSync(CACHE, { recursive: true });
 const ids = Array.from({ length: LAST_PAGE - FIRST_PAGE + 1 }, (_, index) => FIRST_PAGE + index);
 const pages = new Array(ids.length);
 let completed = 0;
 await mapLimit(ids, 8, async (id, index) => {
  pages[index] = await fetchPage(id);
  if (++completed % 100 === 0 || completed === ids.length) console.log(`Fetched ${completed}/${ids.length} history pages`);
 });
 for (let index = 0; index < pages.length; index++) {
  if (pages[index].source_page_id !== FIRST_PAGE + index) throw new Error(`Broken source sequence at ${index + 1}`);
 }
 const roots = headingRuns(pages);
 const result = { source: SOURCE, book_id: BOOK_ID, first_page: FIRST_PAGE, last_page: LAST_PAGE, page_count: pages.length, roots, pages };
 fs.writeFileSync(path.join(CACHE, 'complete.json'), JSON.stringify(result));
 return result;
}

async function apply(source) {
 const settings = require(path.join(require('os').homedir(), '.hadithdb/settings.json'));
 const db = mysql.createConnection(settings.mysql.connection);
 const query = promisify(db.query).bind(db);
 try {
  await query(`CREATE TABLE IF NOT EXISTS islamweb_history_source_entries (
   book_id INT NOT NULL, source_page_id INT NOT NULL, item_id INT NOT NULL, source_url VARCHAR(500) NOT NULL, source_json JSON NOT NULL,
   PRIMARY KEY(book_id,source_page_id), UNIQUE KEY islamweb_history_item(item_id)
  ) CHARACTER SET utf8mb4`);
  await query('START TRANSACTION');
  const existing = await query('SELECT id,type,source FROM books WHERE alias=? FOR UPDATE', [ALIAS]);
  if (existing.length) {
   if (existing[0].type !== 'sirah' || existing[0].source !== SOURCE) throw new Error('Existing alias has a different identity');
   const [{ n }] = await query('SELECT COUNT(*) AS n FROM islamweb_history_source_entries WHERE book_id=?', [existing[0].id]);
   if (Number(n) !== source.page_count) throw new Error('Existing import is incomplete; refusing replacement');
   await query('COMMIT');
   console.log(`Already imported ${n} history passages; book id ${existing[0].id}`);
   return existing[0].id;
  }
  const id = Number((await query('SELECT MAX(id) AS id FROM books FOR UPDATE'))[0].id) + 1;
  const description = 'A comprehensive Arabic history collection from Islamweb covering creation, the stories of the prophets, the Prophetic biography, the Rightly Guided Caliphate, the Umayyad Caliphate, and the Abbasid Caliphate.';
 const properties = { reader: { referenceView: 'section' }, history: { source_book: BOOK_ID, source_first_page: FIRST_PAGE, source_last_page: LAST_PAGE, vocalized: true, reference: 'sequential passage number; Islamweb page IDs retained in islamweb_history_source_entries' } };
  await query(`INSERT INTO books (id,ordinal,alias,type,shortName_en,name_en,title_en,shortName,name,title,author_en,author,description,source,lang,hidden,format,properties,content_lastmod)
   VALUES (?,?,?,'sirah',?,?,?,?,?,?,?,?,?,?,'ar',0,'md',?,NOW())`,
  [id,id,ALIAS,'Islamweb History','Islamweb History','Encyclopedia of the Prophetic Biography and Islamic History','موسوعة التاريخ الإسلامي','موسوعة السيرة النبوية والتاريخ الإسلامي','موسوعة السيرة النبوية والتاريخ الإسلامي','Islamweb','إسلام ويب',description,SOURCE,JSON.stringify(properties)]);

  const [{ increment }] = await query('SELECT @@auto_increment_increment AS increment');
  if (Number(increment) !== 1) throw new Error('Batch import requires auto_increment_increment=1');
  let tocOrdinal = 0;
  const counters = [0, 0, 0];
  const flatNodes = [];
  function collectNodes(nodes, ancestors = []) {
   for (const node of nodes) {
    const level = node.level;
    counters[level - 1]++;
    counters.fill(0, level);
    const numbers = [...ancestors, counters[level - 1]];
    const start = node.startIndex + 1, end = node.endIndex + 1;
    node.insertRow = [++tocOrdinal,id,level,numbers[0],numbers[1] || null,numbers[2] || null,normalizeField(node.title),String(start),String(end),start,end,end-start+1];
    node.numbers = numbers;
    flatNodes.push(node);
    collectNodes(node.children, numbers);
   }
  }
  collectNodes(source.roots);
  for (let offset = 0; offset < flatNodes.length; offset += 250) {
   const batch = flatNodes.slice(offset, offset + 250);
   const inserted = await query('INSERT INTO toc (ordinal,bookId,level,h1,h2,h3,title,start,end,start0,end0,count) VALUES ?', [batch.map(node => node.insertRow)]);
   if (inserted.affectedRows !== batch.length) throw new Error('TOC batch insert count mismatch');
   batch.forEach((node, index) => { node.tocId = inserted.insertId + index; });
  }
  for (let offset = 0; offset < source.pages.length; offset += 100) {
   const batch = source.pages.slice(offset, offset + 100);
   const hadithRows = batch.map((page, batchIndex) => {
    const number = offset + batchIndex + 1, node = page.headingNode, nums = node.numbers;
    return [number,id,node.tocId,nums[0],nums[1] || null,nums[2] || null,String(number),number,number-node.startIndex,normalizeField(page.title),normalizeField(page.body),normalizeField(page.body)];
   });
   const inserted = await query('INSERT INTO hadiths (ordinal,bookId,tocId,h1,h2,h3,num,num0,numInChapter,title,body,text) VALUES ?', [hadithRows]);
   if (inserted.affectedRows !== batch.length) throw new Error('Passage batch insert count mismatch');
   const provenanceRows = batch.map((page, index) => [id,page.source_page_id,inserted.insertId+index,page.source_url,JSON.stringify(page)]);
   const provenance = await query('INSERT INTO islamweb_history_source_entries (book_id,source_page_id,item_id,source_url,source_json) VALUES ?', [provenanceRows]);
   if (provenance.affectedRows !== batch.length) throw new Error('Provenance batch insert count mismatch');
   if ((offset + batch.length) % 1000 === 0 || offset + batch.length === source.pages.length) console.log(`Inserted ${offset + batch.length}/${source.pages.length} history passages`);
  }
  await query('COMMIT');
  console.log(`Imported ${source.page_count} history passages and ${tocOrdinal} headings; book id ${id}, alias ${ALIAS}`);
  return id;
 } catch (error) {
  await query('ROLLBACK');
  throw error;
 } finally { db.end(); }
}

if (require.main === module) (async () => {
 const source = fs.existsSync(path.join(CACHE, 'complete.json')) ? JSON.parse(fs.readFileSync(path.join(CACHE, 'complete.json'), 'utf8')) : await scrape();
 source.pages.forEach(page => { if (!page.source_headings) page.source_headings = [...page.headings]; });
 // Rebuild object links because JSON stores page.headingNode as a detached copy.
 source.roots = headingRuns(source.pages);
 console.log(`${source.page_count} passages, ${source.roots.length} top-level history divisions verified`);
 if (process.argv.includes('--apply')) await apply(source);
 })().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { cleanText, readerHeadings, parsePage, headingRuns, scrape, apply };
