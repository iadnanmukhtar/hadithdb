'use strict';

const path = require('path');
const ejs = require('ejs');

const partial = path.join(__dirname, '..', 'views', 'sub-views', 'global_search_dialog.ejs');

function render(selectedHadithAliases, overrides = {}) {
	return ejs.renderFile(partial, {
		BookGroups: { list: scope => require('../lib/BookGroups').list(scope, require('./fixtures/bookSearchGroups')()) },
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
		searchQuery: '',
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
		...overrides,
		Tafsir: {
			rawShortName: function () { return ''; },
			tafsirSlug: function (alias) { return alias; }
		}
	});
}

describe('global search dialog', () => {
	test('General leaves all filters unselected without context', async () => {
		const html = await render([]);
		expect(html).toContain('command-search-mode-label">General</span>');
		for (const source of ['hadith', 'sharh', 'quran', 'tafsir'])
			expect(html).not.toContain(`name="b" value="${source}" checked`);
	});

	test('unfiltered results reopen with no selected source filters', async () => {
		const html = await render([], { isSearchResultsContext: true });
		expect(html).not.toMatch(/type="checkbox"[^>]* checked/);
	});

	test('reopening filtered results does not restore removed categories', async () => {
		const html = await render(['quran'], { isSearchResultsContext: true, quranSearchBookFilters: ['quran'] });
		expect(html).toContain('name="b" value="quran" checked');
		for (const source of ['hadith', 'sharh', 'tafsir'])
			expect(html).not.toContain(`name="b" value="${source}" checked`);
	});

	test('selects only the contextual Hadith book', async () => {
		const html = await render(['bukhari']);
		expect(html).not.toMatch(/name="b" value="hadith" checked/);
		expect(html).not.toMatch(/name="b" value="sharh" checked/);
		expect(html).toMatch(/name="b" value="bukhari" checked/);
	});
	test('preserves an explicit Hadith-only selection', async () => {
		const html = await render(['hadith', 'bukhari']);
		expect(html).toMatch(/name="b" value="hadith" checked/);
		expect(html).not.toMatch(/name="b" value="sharh" checked/);
	});

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
