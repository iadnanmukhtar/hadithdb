'use strict';

const QuranMushaf = require('./QuranMushaf');
const QuranTocSubdivisions = require('./QuranTocSubdivisions');
const Utils = require('./Utils');

async function data(_req, res, next) {
  try {
    const [juz, info] = await Promise.all([QuranTocSubdivisions.juzRows(), QuranMushaf.info()]);
    res.json({
      surahs: (global.surahs || []).map(s => ({ num: Number(s.num), name: s.name_en, arabic: s.name_ar, ayahs: Number(s.ayahs) })),
      juz: juz.map(j => ({ num: Number(j.num), title: j.title, ref: j.start })),
      pages: Number(info && info.number_of_pages) || 604
    });
  } catch (err) { next(err); }
}

async function navigate(req, res, next) {
  try {
    let ref = String(req.query.ref || '');
    let page;
    if (req.query.page !== undefined) {
      page = Number(req.query.page);
      const info = await QuranMushaf.info();
      if (!Number.isInteger(page) || page < 1 || page > Number(info && info.number_of_pages))
        return res.status(400).send('Invalid Quran page');
      const sheet = await QuranMushaf.page(page);
      const word = sheet && sheet.lines.flatMap(line => line.words || []).find(w => !w.is_ayah_marker);
      if (!word) return res.status(404).send('Quran page unavailable');
      ref = `${word.surah}:${word.ayah}`;
    }
    const match = /^(\d+):(\d+)$/.exec(ref);
    const surah = match && (global.surahs || []).find(s => Number(s.num) === Number(match[1]));
    if (!surah || Number(match[2]) < 1 || Number(match[2]) > Number(surah.ayahs))
      return res.status(400).send('Invalid Quran verse');
    ref = `${Number(match[1])}:${Number(match[2])}`;
    const book = /^[A-Za-z0-9_-]+$/.test(String(req.query.book || '')) ? req.query.book : '';
    let target = `/quran:${ref}`;
    if (req.query.mode === 'mushaf') {
      page = page || await QuranMushaf.pageForRef(Number(match[1]), Number(match[2]));
      if (!page) return res.status(404).send('Quran page unavailable');
      target = `/quran/page/${page}?ayah=${ref}${req.query.memorize !== undefined ? '&memorize' : ''}`;
    } else if (req.query.mode === 'tafsir' && book) {
      target = `/quran/tafsir/${encodeURIComponent(book)}/quran:${ref}`;
    } else if (book) {
      target = `/quran/${encodeURIComponent(book)}/quran:${ref}`;
    }
    if (req.query.ayat !== undefined && req.query.mode !== 'mushaf') target += '?ayat';
    return res.redirect(302, Utils.quranUrl(req, target));
  } catch (err) { next(err); }
}

module.exports = { data, navigate };
