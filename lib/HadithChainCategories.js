// @ts-check
'use strict';

const CATEGORIES = Object.freeze([
	Object.freeze({ key: 'muttasil', title_en: 'Muttaṣil', title: 'متصل' }),
	Object.freeze({ key: 'muallaq', title_en: 'Muʿallaq', title: 'معلق' }),
	Object.freeze({ key: 'mursal', title_en: 'Mursal', title: 'مرسل' }),
	Object.freeze({ key: 'munqati', title_en: 'Munqaṭiʿ', title: 'منقطع' })
]);

function normalize(value) {
	return String(value || '')
		.normalize('NFKC')
		.replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/gu, '')
		.replace(/[إأآٱ]/gu, 'ا')
		.replace(/\s+/g, ' ')
		.trim();
}

function parse(value) {
	const seen = new Set();
	return String(value || '').split(/[,،·]/u).map(normalize).filter(Boolean).map(title => {
		const category = CATEGORIES.find(item => normalize(item.title) === title);
		return category || { key: title, title_en: title, title };
	}).filter(category => !seen.has(category.key) && seen.add(category.key));
}

module.exports = { CATEGORIES, parse };
