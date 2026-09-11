'use strict';

const ejs = require('ejs');
const path = require('path');
const Arabic = require('../lib/Arabic');

const partial = path.join(__dirname, '..', 'views', 'sub-views', 'translation_search_result.ejs');

test('translation search references link to the translation reader and use language-appropriate names', async () => {
	const html = await ejs.renderFile(partial, {
		req: {},
		utils: { quranUrl: (_req, url) => url },
		arabic: Arabic,
		translation: {
			url: '/quran/en-ahmedraza/quran:68:17',
			translation_alias: 'en-ahmedraza',
			translation_book_ar: 'رضا',
			translation_ref: '68:17',
			translation_name: 'Translation: Ahmed Raza Khan',
			translation_author: '',
			translation_body_html: 'test',
			translation_footnote_html: '',
			translation_ayahs: [],
			translation_surah_name_en: '',
			translation_surah_name_ar: '',
			surah: 68
		}
	});

	expect(html).toContain('href="/quran/en-ahmedraza/quran:68:17"');
	expect(html).toContain('>en-ahmedraza:68:17</a>');
	expect(html).toContain('>رضا:٦٨:١٧</a>');
});
