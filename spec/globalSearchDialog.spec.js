'use strict';

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const partial = path.join(__dirname, '..', 'views', 'sub-views', 'global_search_dialog.ejs');
const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'css', 'style.css'), 'utf8');

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
	test.each(['tafsir', 'trans'])('offers the current %s book without preselecting it', async kind => {
		const book = { alias: 'test-book', source: 'local', hidden: 0, shortName_en: 'Test Book' };
		const html = await render([], {
			initialSearchMode: 'quran', contextualSearchBookAlias: book.alias,
			contextualSearchBookName: book.shortName_en,
			quranSearchCommentaryAliases: [book.alias],
			quranSearchTafsirs: kind === 'tafsir' ? [book] : [],
			quranSearchTranslations: kind === 'trans' ? [book] : []
		});
		expect(html).toContain('Search within Test Book');
		expect(html).not.toContain('name="tafsir" value="test-book" checked');
		expect(html).not.toContain('name="b" value="quran" checked');
	});

	test('General leaves all filters unselected without context', async () => {
		const html = await render([]);
		expect(html).toContain('<option value="all">All</option>');
		for (const source of ['hadith', 'sharh', 'quran', 'tafsir', 'translations'])
			expect(html).not.toContain(`name="b" value="${source}" checked`);
	});

	test('places global source filters together at the top in the requested order', async () => {
		const html = await render([]);
		const sourceOptions = html.match(/<div class="command-search-source-options" data-command-global-source-options>([\s\S]*?)<\/div>/)[1];
		const values = Array.from(sourceOptions.matchAll(/name="b" value="([^"]+)"/g), match => match[1]);

		expect(values).toEqual(['quran', 'tafsir', 'translations', 'hadith', 'sharh', 'sirah', 'blog', 'community']);
		expect(html.match(/data-command-global-source-options/g)).toHaveLength(1);
	});

	test('orders detailed book filters by Tafsir, Translation, Hadith, Sharh, then History', async () => {
		const html = await render([], {
			quranSearchTafsirs: [{ alias: 'tabari', source: 'local', hidden: 0, shortName_en: 'al-Tabari' }]
		});
		const summaries = Array.from(html.matchAll(/<summary(?: [^>]*)?>\s*<span>([^<]+)<\/span>/g), match => match[1]);

		expect(summaries).toEqual([
			'Tafsir Book Groups',
			'Tafsir Books',
			'Translations',
			'Hadith Book Groups',
			'Hadith Books',
			'Sharh Books',
			'History Books'
		]);
	});

	test('unfiltered results reopen with no selected source filters', async () => {
		const html = await render([], { isSearchResultsContext: true });
		expect(html).not.toMatch(/type="checkbox"[^>]* checked/);
	});

	test('global search starts broad in the Quran reader', async () => {
		const html = await render([], {
			initialSearchMode: 'quran',
			quranSearchContext: 'study',
			quranSearchCommentaryAliases: ['test-translation'],
			quranSearchTranslations: [{ alias: 'test-translation', source: 'local', shortName_en: 'Test Translation' }]
		});
		expect(html).not.toMatch(/type="checkbox"[^>]* checked/);
	});

	test('unfiltered Quran results restore their implied Quran and Tafsir filters', async () => {
		const html = await render([], { initialSearchMode: 'quran', isSearchResultsContext: true });
		expect(html).toContain('name="b" value="quran" checked');
		expect(html).toContain('name="b" value="tafsir" checked');
		expect(html).not.toContain('name="b" value="translations" checked');
	});

	test('restores the global Translation filter independently', async () => {
		const html = await render([], { isSearchResultsContext: true, quranSearchBookFilters: ['translations'] });
		expect(html).toContain('name="b" value="translations" checked');
		expect(html).not.toContain('name="b" value="quran" checked');
		expect(html).not.toContain('name="b" value="tafsir" checked');
	});

	test('reopening filtered results does not restore removed categories', async () => {
		const html = await render(['quran'], { isSearchResultsContext: true, quranSearchBookFilters: ['quran'] });
		expect(html).toContain('name="b" value="quran" checked');
		for (const source of ['hadith', 'sharh', 'tafsir', 'translations'])
			expect(html).not.toContain(`name="b" value="${source}" checked`);
	});

	test('restores a single Hadith book on results', async () => {
		const html = await render(['bukhari'], {isSearchResultsContext:true});
		expect(html).not.toMatch(/name="b" value="hadith" checked/);
		expect(html).not.toMatch(/name="b" value="sharh" checked/);
		expect(html).toMatch(/name="b" value="bukhari" checked/);
	});
	test('preserves an explicit Hadith-only selection', async () => {
		const html = await render(['hadith', 'bukhari'], {isSearchResultsContext:true});
		expect(html).toMatch(/name="b" value="hadith" checked/);
		expect(html).not.toMatch(/name="b" value="sharh" checked/);
	});

	test('shows and restores visible virtual Hadith books', async () => {
		const html = await render(['riyad'], {isSearchResultsContext:true});

		expect(html).toContain('Riyad al-Salihin');
		expect(html).toMatch(/name="b" value="riyad" checked/);
		expect(html).toContain('Bukhari');
		expect(html).not.toContain('Hidden Virtual Book');
	});

	test('shows the canonical Hadith book groups', async () => {
		const html = await render(['ninebooks'], {isSearchResultsContext:true});

		expect(html).toMatch(/name="b" value="sahihayn"[^>]*data-command-filter-label="Sahihayn"/);
		expect(html).toMatch(/name="b" value="kutubarbaah"[^>]*data-command-filter-label="Four Sunan"/);
		expect(html).toMatch(/name="b" value="sixbooks"[^>]*data-command-filter-label="Six Books"/);
		expect(html).toMatch(/name="b" value="ninebooks" checked[^>]*data-command-filter-label="Nine Books"/);
	});

	test('keeps current filters and their removal controls outside the collapsible filter container', async () => {
		const html = await render(['bukhari'], {isSearchResultsContext:true});
		const selectedPosition = html.indexOf('data-command-search-selected');
		const filterContainerPosition = html.indexOf('data-command-search-combined-filters');

		expect(selectedPosition).toBeGreaterThan(-1);
		expect(selectedPosition).toBeLessThan(filterContainerPosition);
		expect(html).toContain('Current filters');
		expect(client).toContain("remove.setAttribute('aria-label', `Remove ${label.textContent} filter`)");
		expect(client).toContain("clearAll.textContent = 'Clear all'");
		expect(styles).not.toContain('.command-search-form:has(.command-search-combined-filters:not([open])) .command-search-selected');
	});

	test('expands selected right-rail groups and promotes checked options', () => {
		expect(client).toContain('function sortSelectedFilterOptions(root)');
		expect(client).toContain('function updateFilterGroups(root)');
		expect(client).toContain('updateFilterGroups(filterOptions);');
		expect(client).toContain('function updateRailFilterGroups()');
		expect(client).toContain('updateFilterGroups(railOptions);');
		expect(client).toContain("return option.querySelector('[data-command-filter]:checked:not(:disabled)');");
		expect(client).toContain("var aSelected = a.querySelector('[data-command-filter]').checked ? 0 : 1;");
		expect(client).toContain('aSelected - bSelected || Number(a.dataset.commandFilterOrder) - Number(b.dataset.commandFilterOrder)');
		expect(client).toContain('updateRailFilterGroups();');
		expect(styles).toContain('.command-search-dialog .command-search-filter-group .command-search-book-list {\n\tgrid-template-columns: repeat(3, minmax(0, 1fr));\n}');
		expect(styles).toContain('.search-filter-controls .command-search-book-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }');
		expect(styles).toMatch(/@media \(max-width: 575\.98px\) \{[\s\S]*?\.command-search-dialog \.command-search-filter-group \.command-search-book-list \{[\s\S]*?repeat\(3,[\s\S]*?\.search-filter-top-menu \.search-filter-controls \.command-search-book-list \{[\s\S]*?repeat\(2,/);
	});

	test('keeps selected groups expanded when filter-search text is cleared and uses accurate scope wording', () => {
		const selectedGroupRule = "group.open = hasSelectedFilter || (query !== '' && !!group.querySelector('[data-command-search-book-option]:not([hidden])'));";
		expect(client.match(new RegExp(selectedGroupRule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(2);
		expect(client).toContain("scopePicker.value");
		expect(client).toContain("input.setAttribute('aria-label', placeholder)");
		expect(client).toContain("'Quran, Tafsir, and Translation'");
		expect(client).toContain("'General search'");
	});
});

test('inline scope exposes all collections and leaves URL filters to the form fields', async () => {
 const { JSDOM } = require('jsdom');
 const dom = new JSDOM(await render([]));
 const select = dom.window.document.querySelector('[data-command-scope]');
 expect([...select.options].filter(o => !o.hidden).map(o => o.value)).toEqual([
   'all','quran','tafsir','translations','hadith','sharh','sirah','blog','community'
 ]);
 expect(select.name).toBe('');
 expect(select.form.querySelector('[name=q]')).toBeTruthy();
 dom.window.close();
});
