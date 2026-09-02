'use strict';

const fs = require('fs');
const path = require('path');
const Search = require('../lib/Search');

describe('Quran and tafsir canonical search ordering', () => {
	test('sorts mixed Quran and tafsir hits by Surah and ayah', () => {
		const docs = [
			{ doctype: 'commentary', commentary_alias: 'tabari', surah: 2, ayahFrom: 3, id: 4 },
			{ doctype: 'hadith', ref: 'quran:1:7', h1: 1, numInChapter: 7, hId: 3 },
			{ doctype: 'commentary', commentary_alias: 'ibn-kathir', surah: 1, ayahFrom: 7, id: 2 },
			{ doctype: 'hadith', ref: 'quran:1:2', h1: 1, numInChapter: 2, hId: 1 }
		];

		docs.sort(Search.compareCanonicalQuranResults);

		expect(docs.map(doc => doc.ref || `${doc.commentary_alias}:${doc.surah}:${doc.ayahFrom}`)).toEqual([
			'quran:1:2',
			'quran:1:7',
			'ibn-kathir:1:7',
			'tabari:2:3'
		]);
	});

	test('renders a Quran-only sort switch and preserves it in pagination', () => {
		const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'search.ejs'), 'utf8');

		expect(template).toContain('aria-label="Sort search results"');
		expect(template).toContain('>Relevance</a>');
		expect(template).toContain('>Quran order</a>');
		expect(template).toContain("params.append('sort', 'canonical')");
		expect(template).toMatch(/if \(isQuranSearchProxy\)[\s\S]*search-results-sort/);
	});

	test('keeps the result query in the header search and mirrors the RTL icon', () => {
		const header = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'header.ejs'), 'utf8');
		const dialog = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'global_search_dialog.ejs'), 'utf8');
		const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');
		const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'css', 'style.css'), 'utf8');

		expect(header).toContain('headerSearchTerm');
		expect(header).toContain('data-command-search-trigger-label');
		expect(header).toContain('data-command-search-direction-container');
		expect(header).toContain('searchQuery: headerSearchTerm');
		expect(dialog).toContain('value="<%= searchQuery || \'\' %>"');
		expect(script).toContain('updateCommandSearchPresentation');
		expect(script).toContain("container.dir = rtl ? 'rtl' : 'ltr'");
		expect(script).toContain("icon.classList.toggle('is-rtl-search', rtl)");
		expect(styles).toMatch(/\.bi-search\.is-rtl-search \{\s*transform: scaleX\(-1\);/);
		expect(styles).toMatch(/\.command-search-trigger \{[\s\S]*?text-align: start;/);
		expect(styles).toMatch(/\.command-search-trigger-label \{[\s\S]*?text-align: start;[\s\S]*?unicode-bidi: plaintext;/);
	});

	test('defaults Quran search to Quran and Tafsir except within a specific commentary', () => {
		const dialog = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'global_search_dialog.ejs'), 'utf8');

		expect(dialog).toContain('hasCommandSpecificCommentary');
		expect(dialog).toMatch(/commandQuranTextSelected = isSearchResultsContext[\s\S]*: true;/);
		expect(dialog).toMatch(/commandAllTafsirSelected = isSearchResultsContext[\s\S]*: !hasCommandSpecificCommentary;/);
	});
});
