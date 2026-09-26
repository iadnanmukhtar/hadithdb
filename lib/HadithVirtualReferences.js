'use strict';
const Utils = require('./Utils');
const Arabic = require('./Arabic');

async function addVirtualReferences(items) {
    const sourceId = item => Number(item.actual ? item.actual.id : item.hId || item.id);
    const ids = [...new Set(items.map(sourceId).filter(id => Number.isSafeInteger(id) && id > 0))];
    if (!ids.length) return;
    const rows = await global.query(`
        SELECT DISTINCT hv.id, hv.hadithId AS hId_ref, hv.num, hv.ordinal,
            b.id AS book_id, b.alias AS book_alias, b.hidden AS book_hidden,
            b.shortName_en AS book_shortName_en, b.shortName AS book_shortName,
            hv.h1, ch.title_en AS h1_title_en, ch.title AS h1_title,
            hv.h2, sec.title_en AS h2_title_en, sec.title AS h2_title
        FROM hadiths_virtual hv
        JOIN books b ON b.id=hv.bookId
        LEFT JOIN toc ch ON ch.bookId=hv.bookId AND ch.level=1 AND ch.h1=hv.h1
        LEFT JOIN toc sec ON sec.bookId=hv.bookId AND sec.level=2 AND sec.h1=hv.h1 AND sec.h2=hv.h2
        WHERE hv.hadithId IN (${ids.join(',')})
        ORDER BY b.id, hv.ordinal, hv.id`);
    const byId = new Map();
    const seen = new Set();
    for (const row of rows) {
        if (Number(row.book_hidden) === 1 || seen.has(row.id)) continue;
        seen.add(row.id);
        const parts = [row.book_alias, Utils.formatHadithHeadingNumber(String(row.h1 ?? ''))];
        if (row.h2 !== null && row.h2 !== undefined && Number(row.h2) !== 0)
            parts.push(Utils.formatHadithHeadingNumber(String(row.h2 ?? '')));
        const ref = {
            book_alias: row.book_alias, book_shortName_en: row.book_shortName_en,
            book_shortName: row.book_shortName, num_ar: Arabic.toArabicDigits(row.num),
            num: row.num, h1: row.h1, h1_title_en: row.h1_title_en, h1_title: row.h1_title,
            h2: row.h2, h2_title_en: row.h2_title_en, h2_title: row.h2_title,
            path: parts.join('/'),
            referencePath: `${parts.join('/')}#${encodeURIComponent(String(row.num).replace(/:/g, '-'))}`
        };
        if (!byId.has(Number(row.hId_ref))) byId.set(Number(row.hId_ref), []);
        byId.get(Number(row.hId_ref)).push(ref);
    }
    for (const item of items) {
        item.virtualReferences = (byId.get(sourceId(item)) || []).filter(ref =>
            !(item.book_alias === ref.book_alias && String(item.num) === String(ref.num)));
    }
}
module.exports = { addVirtualReferences };
