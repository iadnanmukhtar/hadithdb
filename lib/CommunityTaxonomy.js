'use strict';
const categories = Object.freeze(['Tafsir', 'Hadith', 'Topical', 'Fiqh', 'Sciences', 'Aqidah', 'Sirah', 'History', 'Spirituality']);
function category(value) {
  if (value === undefined) return undefined;
  if (value === '') return '';
  if (typeof value !== 'string' || !categories.includes(value)) throw require('http-errors')(400, 'Choose a valid article category.');
  return value;
}
async function migrate(sql) {
  for (const [table, column] of [['community_posts','category'], ['community_posts','public_category'], ['community_revisions','category']]) {
    try { await sql(`ALTER TABLE ${table} ADD COLUMN ${column} VARCHAR(40) NOT NULL DEFAULT ''`); }
    catch (err) { if (err.code !== 'ER_DUP_FIELDNAME') throw err; }
  }
}
module.exports = { categories, category, migrate };
