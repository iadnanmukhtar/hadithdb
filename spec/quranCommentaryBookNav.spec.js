'use strict';

const path = require('path');
const ejs = require('ejs');
const Tafsir = require('../lib/Tafsir');

const template = path.join(__dirname, '..', 'views', 'sub-views', 'quran_commentary_book_nav.ejs');
const books = [{
	id: 1,
	type: 'tafsir',
	alias: 'dawat',
	slug: 'dawat',
	lang: 'en',
	source: 'local',
	shortName_en: 'Dawat'
}, {
	id: 2,
	type: 'tafsir',
	alias: 'rida',
	slug: 'rida',
	lang: 'en',
	source: 'local',
	shortName_en: 'Rida'
}];

function render(extra = {}) {
	return ejs.renderFile(template, {
		req: {},
		utils: {
			quranUrl: (_req, href) => href,
			emptyIfNull: value => value == null ? '' : value
		},
		Tafsir,
		quranCommentaryBook: books[0],
		quranCommentaryBooks: books,
		...extra
	});
}

describe('Quran commentary book navigation', () => {
	test('uses tafsir table-of-contents links when an introduction has no passage', async () => {
		const html = await render();

		expect(html).toContain('href="/quran/tafsir/rida"');
		expect(html).not.toContain('quran:0:0');
		expect(html).not.toContain('data-commentary-passage-carousel="1"');
	});

	test('keeps a real ayah-zero passage linked across tafsirs', async () => {
		const html = await render({
			quranCommentaryPassage: { surah: 1, ayah: 0, endAyah: 0 }
		});

		expect(html).toContain('href="/quran/tafsir/rida/quran:1:0"');
		expect(html).toContain('data-commentary-passage-carousel="1"');
		expect(html).toContain('data-commentary-quran-ref="1:0"');
	});
});
