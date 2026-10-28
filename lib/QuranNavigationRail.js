'use strict';

const QuranMushaf = require('./QuranMushaf');
const QuranTocSubdivisions = require('./QuranTocSubdivisions');
const Utils = require('./Utils');
const QuranHeadings = require('./QuranHeadings');

async function data(_req, res, next) {
  try {
    const [juz, manzil, info] = await Promise.all([QuranTocSubdivisions.juzRows(), QuranTocSubdivisions.manzilRows(), QuranMushaf.info()]);
    res.json({
      surahs: (global.surahs || []).map(s => ({ num: Number(s.num), name: s.name_en, arabic: s.name_ar, aliases: s.aliases || [s.alias].filter(Boolean), ayahs: Number(s.ayahs) })),
      manzil: manzil.map(m => {
        // Match the Quran TOC: each Manzil is named by its opening Surah.
        const startSurah = Number(m.startSurah) || Number(String(m.start || '').split(':')[0]);
        const surah = (global.surahs || []).find(s => Number(s.num) === startSurah);
        return { num: Number(m.num), title: surah && surah.name_ar || '', ref: m.start };
      }),
      juz: juz.map(j => ({ num: Number(j.num), title: j.title, ref: j.start })),
      pages: Number(info && info.number_of_pages) || 604
    });
  } catch (err) { next(err); }
}

async function navigate(req, res, next) {
  try {
    // Legacy reader links must not manufacture a review item from reading context.
    if (req.query.mode === 'review') return res.redirect(302, Utils.quranUrl(req, '/quran/review'));
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
    if (!surah || Number(match[2]) < (Number(match[1]) === 1 ? 0 : 1) || Number(match[2]) > Number(surah.ayahs))
      return res.status(400).send('Invalid Quran ayah');
    ref = `${Number(match[1])}:${Number(match[2])}`;
    const book = /^[A-Za-z0-9_-]+$/.test(String(req.query.book || '')) ? req.query.book : '';
    let target = `/quran:${ref}`;
    if (['mushaf', 'memorize'].includes(req.query.mode)) {
      page = page || await QuranMushaf.pageForRef(Number(match[1]), Math.max(1, Number(match[2])));
      if (!page) return res.status(404).send('Quran page unavailable');
      target = `/quran/page/${page}?ayah=${ref}`;
      if (req.query.mode === 'memorize' || req.query.memorize !== undefined) target += '&memorize';
    } else if (req.query.mode === 'tafsir' && book) {
      target = `/quran/tafsir/${encodeURIComponent(book)}/quran:${ref}`;
    } else if (req.query.mode === 'translations') {
      target = `/quran/translations/quran:${ref}`;
    } else if (book) {
      target = `/quran/${encodeURIComponent(book)}/quran:${ref}`;
    }
    if (req.query.destination === 'passage' && !['mushaf', 'memorize', 'translations'].includes(req.query.mode)) {
      const section = await QuranHeadings.sectionForAyah(Number(match[1]), Number(match[2]));
      if (!section || !Number.isInteger(Number(section.h2)) || Number(section.h2) < 1)
        return res.status(404).send('Quran passage unavailable');
      const prefix = req.query.mode === 'tafsir' && book ? `/quran/tafsir/${encodeURIComponent(book)}`
        : book ? `/quran/${encodeURIComponent(book)}` : '/quran';
      target = `${prefix}/${Number(match[1])}/${Number(section.h2)}`;
    }
    if (req.query.ayat !== undefined && !['mushaf', 'memorize'].includes(req.query.mode)) target += '?ayat';
    return res.redirect(302, Utils.quranUrl(req, target));
  } catch (err) { next(err); }
}

module.exports = { data, navigate };
