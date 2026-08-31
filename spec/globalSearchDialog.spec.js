'use strict';

const path = require('path');
const ejs = require('ejs');

const partial = path.join(__dirname, '..', 'views', 'sub-views', 'global_search_dialog.ejs');

function render(selectedHadithAliases) {
	return ejs.renderFile(partial, {
		initialSearchMode: 'hadith',
		hadithSearchAction: '/',
		quranSearchAction: '/quran',
		quranSearchReturnMode: '',
		quranSearchTafsirSlug: '',
		quranSearchContext: 'quran',
		quranSearchCommentaryAlias: '',
		isSearchResultsContext: false,
		hadithSearchBookAliases: selectedHadithAliases || [],
		quranSearchBookFilters: [],
		quranSearchCommentaryAliases: [],
		hadithSearchBooks: [{
			id: 1,
			alias: 'bukhari',
			book_model: 'hadith',
			hidden: 0,
			ordinal: 1,
			shortName_en: 'Bukhari',
			virtual: 0
		}, {
			id: 2,
			alias: 'riyad',
			book_model: 'hadith',
			hidden: 0,
			ordinal: 2,
			shortName_en: 'Riyad al-Salihin',
			virtual: 1
		}, {
			id: 3,
			alias: 'hidden-virtual',
			book_model: 'hadith',
			hidden: 1,
			ordinal: 3,
			shortName_en: 'Hidden Virtual Book',
			virtual: 1
		}],
		quranSearchTafsirs: [],
		quranSearchTranslations: [],
		Tafsir: {
			rawShortName: function () { return ''; },
			tafsirSlug: function (alias) { return alias; }
		}
	});
}

describe('global search dialog', () => {
	test('shows and contextually selects visible virtual Hadith books', async () => {
		const html = await render(['riyad']);

		expect(html).toContain('Riyad al-Salihin');
		expect(html).toMatch(/name="b" value="riyad" checked/);
		expect(html).toContain('Bukhari');
		expect(html).not.toContain('Hidden Virtual Book');
	});

	test('shows the canonical Hadith book groups', async () => {
		const html = await render(['ninebooks']);

		expect(html).toMatch(/name="b" value="sahihayn"[^>]*data-command-filter-label="Sahihayn"/);
		expect(html).toMatch(/name="b" value="kutubarbaah"[^>]*data-command-filter-label="Four Sunan"/);
		expect(html).toMatch(/name="b" value="sixbooks"[^>]*data-command-filter-label="Six Books"/);
		expect(html).toMatch(/name="b" value="ninebooks" checked[^>]*data-command-filter-label="Nine Books"/);
	});
});
