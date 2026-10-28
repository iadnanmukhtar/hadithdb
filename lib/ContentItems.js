'use strict';
const mysql = require('mysql');
const error = require('http-errors');
const Utils = require('./Utils');
const sql = (query, values = []) => global.query(mysql.format(query, values));
let ready;
function ensure() {
  if (!ready) ready = (async () => {
    await sql(`CREATE TABLE IF NOT EXISTS content_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      source_key VARCHAR(191) NOT NULL UNIQUE, title TEXT NOT NULL, url TEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await sql(`CREATE TABLE IF NOT EXISTS content_item_bookmarks (
      item_id BIGINT UNSIGNED NOT NULL, user_uid VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY(item_id,user_uid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  })().catch(err => { ready = null; throw err; });
  return ready;
}
function validKey(key) {
  return typeof key === 'string' && key.length <= 191 && /^(?:(?:sharh|heading-sharh|intro):[1-9]\d*|tafsir:[A-Za-z0-9_-]+:[1-9]\d*:[1-9]\d*|tafsir-heading:[A-Za-z0-9_-]+:[\d.]+)$/.test(key);
}
async function source(key) {
  if (!validKey(key)) throw error(400, 'Invalid content reference.');
  const [kind, alias, surah, ayah] = key.split(':');
  if (kind === 'sharh' || kind === 'heading-sharh') {
    const data = await require('./Sharh').entryById(alias, kind === 'heading-sharh' ? 'heading' : 'hadith');
    if (!data) throw error(404, 'Explanation not found.');
    return { title: data.entry.title_en || data.entry.title || data.book.alias, url: data.canonical + '#note-' + key.replace(':', '-') };
  }
  if (kind === 'intro') {
    const [row] = await sql('SELECT t.title_en,t.title,v.path FROM v_toc v JOIN toc t ON t.id=v.id WHERE v.id=? LIMIT 1', [alias]);
    if (!row) throw error(404, 'Introduction not found.');
    return { title: row.title_en || row.title || key, url: '/' + row.path + '#note-intro-' + alias };
  }
  const Tafsir = require('./Tafsir');
  const book = await Tafsir.resolveTafsir(alias);
  if (!book) throw error(404, 'Tafsir not found.');
  const title = Tafsir.displayShortName(book, 'en');
  if (kind === 'tafsir-heading') {
    if (!/^\d+(?:\.\d+)?$/.test(surah)) throw error(400, 'Invalid heading.');
    return { title, url: '/quran/tafsir/' + encodeURIComponent(book.slug || book.alias) + '/' + surah.replace('.', '/') };
  }
  const chapter = (global.surahs || []).find(row => Number(row.num) === Number(surah));
  if (!chapter || Number(ayah) > Number(chapter.ayahs)) throw error(404, 'Ayah not found.');
  return { title: title + ' — Quran ' + surah + ':' + ayah, url: Tafsir.passageUrl(book, Number(surah), Number(ayah), Number(ayah)) };
}
async function resolve(key) {
  const data = await source(key);
  await ensure();
  await sql('INSERT INTO content_items (source_key,title,url) VALUES (?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),url=VALUES(url)', [key, data.title, data.url]);
  return (await sql('SELECT * FROM content_items WHERE source_key=?', [key]))[0];
}
async function get(id) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) return null;
  await ensure();
  const item = (await sql('SELECT * FROM content_items WHERE id=?', [Number(id)]))[0];
  if (!item) return null;
  try { return {...item,...await source(item.source_key)}; } catch(err) { if(err.status===404)return null;throw err; }
}
async function bookmarks(uid) {
  await ensure();
  return sql('SELECT i.* FROM content_item_bookmarks b JOIN content_items i ON i.id=b.item_id WHERE b.user_uid=? ORDER BY b.created_at DESC LIMIT 500', [uid]);
}
async function bookmark(uid, id, enabled) {
  if (!await get(id)) throw error(404, 'Item not found.');
  if (typeof enabled !== 'boolean') throw error(400, 'Choose bookmark or remove bookmark.');
  await sql(enabled ? 'INSERT IGNORE INTO content_item_bookmarks (item_id,user_uid) VALUES (?,?)' : 'DELETE FROM content_item_bookmarks WHERE item_id=? AND user_uid=?', [id, uid]);
}
async function clearBookmarks(uid) { await ensure();await sql('DELETE FROM content_item_bookmarks WHERE user_uid=?',[uid]); }
function url(item, req) { return item.url.startsWith('/quran') ? Utils.quranUrl(req, item.url) : Utils.urlFor(req, item.url); }
module.exports = { ensure, resolve, get, bookmarks, bookmark, clearBookmarks, validKey, source, url };
