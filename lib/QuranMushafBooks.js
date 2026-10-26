'use strict';

// Catalog-only books: all editions share the existing Quran reader and source data.
const EDITIONS = Object.freeze([
	{ script: 'uthmani', name_en: 'Mushaf Uthmani', name: 'المصحف العثماني' },
	{ script: 'indo-pak', name_en: 'Mushaf Indo-Pak', name: 'المصحف الهندي الباكستاني' },
	{ script: 'warsh', name_en: 'Mushaf Warsh', name: 'مصحف ورش' }
]);

function catalog() {
	return EDITIONS.map(edition => ({
		...edition,
		alias: `mushaf-${edition.script}`,
		type: 'quran',
		virtual: 1,
		lang: 'ar',
		href: `/quran/page/1?script=${edition.script}`
	}));
}

module.exports = { catalog };
