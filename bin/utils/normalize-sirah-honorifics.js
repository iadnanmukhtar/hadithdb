#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql');
const { promisify } = require('util');
const { normalizeField } = require('./normalize-hadith-honorifics');
const Utils = require('../../lib/Utils');

async function main() {
 const apply = process.argv.includes('--apply');
 const settings = require(path.join(require('os').homedir(), '.hadithdb/settings.json'));
 const connection = mysql.createConnection(settings.mysql.connection);
 const query = promisify(connection.query).bind(connection);
 const backup = {};
 const counts = {};
 try {
  const [book] = await query("SELECT id FROM books WHERE alias='ibnhisham' AND type='sirah'");
  if (!book) throw new Error('Sirat Ibn Hisham is not imported');
  if (apply) await query('START TRANSACTION');
  for (const [table, fields, where] of [
   ['hadiths', ['title', 'chain', 'body', 'text', 'footnote'], 'bookId'],
   ['toc', ['title', 'intro'], 'bookId'],
   ['books', ['description'], 'id']
  ]) {
   const columns = ['id', ...fields];
   const rows = await query(`SELECT ${columns.join(',')} FROM ${table} WHERE ${where}=? ORDER BY id${apply ? ' FOR UPDATE' : ''}`, [book.id]);
   const changes = rows.map(row => {
    const updated = { ...row };
    for (const field of fields) updated[field] = normalizeField(row[field]);
    return fields.some(field => row[field] !== updated[field]) ? updated : null;
   }).filter(Boolean);
   counts[table] = changes.length;
   backup[table] = rows.filter(row => changes.some(change => change.id === row.id));
   if (apply && changes.length) {
    await query(`CREATE TEMPORARY TABLE sirah_normalized_${table} AS SELECT ${columns.join(',')} FROM ${table} WHERE 1=0`);
    for (let offset=0;offset<changes.length;offset+=100) {
     await query(`INSERT INTO sirah_normalized_${table} (${columns.join(',')}) VALUES ?`, [changes.slice(offset,offset+100).map(row => columns.map(column => row[column]))]);
    }
    await query(`UPDATE ${table} t JOIN sirah_normalized_${table} n ON n.id=t.id SET ${fields.map(field => `t.${field}=n.${field}`).join(',')} WHERE t.${where}=?`, [book.id]);
   }
  }
  if (apply) {
   const backupDir = path.resolve('var/imports/hdith-b81');
   fs.mkdirSync(backupDir, { recursive: true });
   fs.writeFileSync(path.join(backupDir, `honorifics-before-${Date.now()}.json`), JSON.stringify(backup));
   if (Object.values(counts).some(Boolean)) await query('UPDATE books SET content_lastmod=NOW() WHERE id=?', [book.id]);
   await query('COMMIT');
   await Utils.flushCacheContaining('ibnhisham');
   await Utils.flushCacheContaining('book:ibnhisham');
  }
  console.log(JSON.stringify({ apply, bookId: book.id, changed: counts }));
 } catch (error) {
  if (apply) await query('ROLLBACK').catch(() => {});
  throw error;
 } finally { connection.destroy(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
