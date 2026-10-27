#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const mysql = require('mysql');
const { promisify, isDeepStrictEqual } = require('util');
// Bibliographic dates apply to the English edition; native author death fields are
// preserved because shared tafsir records can store Hijri years.
const changes = [
  { alias: 'yusuf-ali', id: 100387, beforeYear: null, published_year: 1934, deathLabel: 'd. 1953 CE', note: 'First issued in parts, 1934–1937.', sources: ['https://gloqur.de/quran-translation-of-the-week-91-abdullah-yusuf-ali-and-his-afterlives/'] },
  { alias: 'en-ahmedraza', id: 100362, beforeYear: 1910, published_year: 1988, note: 'English rendering by Shah Faridul Haque of Ahmed Raza Khan’s Urdu work. Death year 1921 belongs to Raza Khan.', sources: ['https://books.google.com/books/about/The_Holy_Quran.html?id=bfEGvgEACAAJ'] },
  { alias: 'en-tahir-ul-qadri', id: 100377, beforeYear: 2009, published_year: 2011, note: 'English edition announced by its publisher in 2011.', sources: ['https://www.minhaj.org/english/Overseas/tid/14838/The-Glorious-Quran-English-Translation-by-Shaykh-ul-Islam-Dr-Muhammad-Tahir-ul-Qadri-published-from-UK.html'] },
  { alias: 'en-hilali-khan', id: 100353, beforeYear: 1977, published_year: 1977, deathLabel: 'al-Hilali: d. 1987 CE; Khan: d. 2021 CE', sources: ['https://dar-us-salam.com/authors/taqi-ud-din-hilali.htm', 'https://dar-us-salam.com/authors/muhsin-khan.htm'] },
  { alias: 'en-qaribullah', id: 100367, beforeYear: 2001, published_year: 2001, deathLabel: 'Qaribullah: d. 2005 CE', note: 'Retains the 2001 internet edition date; the death date applies only to Qaribullah, not co-translator Ahmad Darwish.', sources: ['https://www.internetmosque.net/read/english_translation_of_the_quran_meaning/quran_writers.html', 'https://awradalsammaniya.com/en/tariqa/'] },
  { alias: 'en-daryabadi', id: 100363, beforeYear: 1941, published_year: 1941, note: 'Publication began in 1941; the complete edition appeared in 1957.', sources: ['https://academyofislam.com/wp-content/uploads/2020/09/ALI-571-History-of-Translaiton_2.pdf'] },
  { alias: 'en-shakir', id: 100369, beforeYear: 1968, published_year: 1968, note: 'Retains the limited 1968 edition date. Translator identity and death date are disputed; do not assign Muhammad Shakir’s 1939 death to this translation.', sources: ['https://quran-archive.org/explorer/m-h-shakir'] },
  { alias: 'en-rowwad', id: 100352, beforeYear: 2017, published_year: 2017, note: 'Existing catalog publication year retained; first publication year has not been independently verified. QuranEnc dates are revision dates. Institutional translator: no personal death date.', sources: ['https://quranenc.com/en/browse/english_rwwad'] }
];
function plan(rows) {
  return changes.flatMap(change => {
    const row = rows.find(row => row.alias === change.alias);
    if (!row || row.id !== change.id) throw new Error(`Identity changed: ${change.alias}`);
    if (row.published_year !== change.beforeYear && row.published_year !== change.published_year) throw new Error(`Publication date changed: ${change.alias}`);
    const properties = typeof row.properties === 'string' || Buffer.isBuffer(row.properties) ? JSON.parse(row.properties.toString()) : (row.properties || {});
    const { alias, id, beforeYear, published_year, ...bibliography } = change;
    const next = { ...properties, quran: { ...properties.quran, translationBibliography: bibliography } };
    if (row.published_year === published_year && isDeepStrictEqual(properties, next)) return [];
    return [{ row, published_year, properties: next }];
  });
}
async function run(query, apply) {
  await query('START TRANSACTION');
  try {
    const rows = await query('SELECT id, alias, published_year, properties FROM books WHERE alias IN (?) FOR UPDATE', [changes.map(change => change.alias)]);
    const updates = plan(rows);
    let backup;
    if (apply && updates.length) {
      backup = path.join(os.tmpdir(), `hadithdb-translation-dates-${Date.now()}.json`);
      fs.writeFileSync(backup, JSON.stringify(rows, null, 2), { mode: 0o600 });
      for (const update of updates) {
        const result = await query('UPDATE books SET published_year=?, properties=? WHERE id=? AND alias=?', [update.published_year, JSON.stringify(update.properties), update.row.id, update.row.alias]);
        if (result.affectedRows !== 1) throw new Error(`Unexpected update: ${update.row.alias}`);
      }
      const after = await query('SELECT id, alias, published_year, properties FROM books WHERE alias IN (?)', [changes.map(change => change.alias)]);
      if (plan(after).length) throw new Error('Verification failed');
    }
    await query(apply ? 'COMMIT' : 'ROLLBACK');
    return { apply, updates: updates.map(update => update.row.alias), backup };
  } catch (error) { await query('ROLLBACK'); throw error; }
}
async function main() {
  const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb/settings.json')));
  const connection = mysql.createConnection(settings.mysql.connection);
  try { console.log(JSON.stringify(await run(promisify(connection.query).bind(connection), process.argv.includes('--apply')), null, 2)); }
  finally { connection.end(); }
}
module.exports = { plan, run, changes };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
