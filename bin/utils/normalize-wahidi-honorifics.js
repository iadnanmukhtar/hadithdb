#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql');
const { promisify } = require('util');
const Utils = require('../../lib/Utils');
const fields = ['text', 'text_en', 'footnotes', 'footnotes_en'];
function normalize(value) {
 if (!value) return value;
 let result = value
  .replace(/صلى الله عيه وسلم|صلى عليه وسلم/g, ' ﷺ ')
  .replace(/صلى الله عليه(?= "أَنْشُدُكَ)/g, ' ﷺ ')
  .replace(/, Allah bless him and give,/g, ' ﷺ')
  .replace(/,?\s*Allah bless him(?: and his (?:Household|family))? and give (?:him )?peace\b,?/gi, ' ﷺ ')
  .replace(/,?\s*may Allah be (?:well )?pleased with (?:one and all|all of them|father and son|him|her|them)\b,?/gi, ' ؓ ');
 result = Utils.normalizeArabicHonorifics(result);
 return result === value ? value : result.replace(/[ \t]*([ﷺؓ])[ \t]*/gu, ' $1 ').replace(/([ﷺؓ]) +([,.;:!?،؛؟])/gu, '$1$2').trim();
}
async function main() {
 const apply = process.argv.includes('--apply');
 const c = mysql.createConnection(require(require('os').homedir() + '/.hadithdb/settings.json').mysql.connection);
 const query = promisify(c.query).bind(c);
 try {
  if (apply) await query('START TRANSACTION');
  const [book] = await query("SELECT id FROM books WHERE alias='en-wahidi' AND type='tafsir'");
  if (!book) throw new Error('Wahidi commentary not found');
  const rows = await query(`SELECT * FROM hadiths_commentary WHERE bookId=? ORDER BY id${apply ? ' FOR UPDATE' : ''}`, [book.id]);
  const changes = rows.map(row => ({row, update: Object.fromEntries(fields.filter(f => normalize(row[f]) !== row[f]).map(f => [f, normalize(row[f])]))})).filter(x => Object.keys(x.update).length);
  const counts = Object.fromEntries(fields.map(f => [f, changes.filter(x => f in x.update).length]));
  if (apply && changes.length) {
   fs.mkdirSync('var/imports/wahidi-honorifics', {recursive:true});
   const backup = `var/imports/wahidi-honorifics/before-${Date.now()}.json`;
   fs.writeFileSync(backup, JSON.stringify(changes.map(x => x.row), null, 2));
   console.log('Backup:', backup);
   for (const {row, update} of changes) await query('UPDATE hadiths_commentary SET ? WHERE id=? AND bookId=?', [update, row.id, book.id]);
   await query('UPDATE books SET content_lastmod=NOW() WHERE id=?', [book.id]);
  }
  if (apply) await query('COMMIT');
  console.log(JSON.stringify({apply, passages:rows.length, changed:changes.length, fields:counts}));
 } catch(e) { if (apply) await query('ROLLBACK').catch(() => {}); throw e; }
 finally { c.destroy(); }
}
main().catch(e => {console.error(e);process.exitCode=1;});
