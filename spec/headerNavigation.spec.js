'use strict';

const fs = require('fs');
const path = require('path');

describe('shared header navigation', () => {
  const header = fs.readFileSync(
    path.join(__dirname, '..', 'views', 'sub-views', 'header.ejs'),
    'utf8'
  );
  const styles = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'static', 'css', 'style.css'),
    'utf8'
  );
  const scripts = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'),
    'utf8'
  );
  const searchDialog = fs.readFileSync(
    path.join(__dirname, '..', 'views', 'sub-views', 'global_search_dialog.ejs'),
    'utf8'
  );
  const searchRoutes = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'search.js'),
    'utf8'
  );
  const searchLibrary = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'Search.js'),
    'utf8'
  );
  const hadithHome = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.ejs'), 'utf8');
  const quranToc = fs.readFileSync(path.join(__dirname, '..', 'views', 'toc.ejs'), 'utf8');
  const quranStudy = fs.readFileSync(path.join(__dirname, '..', 'views', 'section_quran.ejs'), 'utf8');
  const tafsirPassage = fs.readFileSync(path.join(__dirname, '..', 'views', 'tafsir_passage.ejs'), 'utf8');
  const translationPassage = fs.readFileSync(path.join(__dirname, '..', 'views', 'translation_passage.ejs'), 'utf8');
  const searchResults = fs.readFileSync(path.join(__dirname, '..', 'views', 'search.ejs'), 'utf8');

  test('uses the full page width', () => {
    expect(header).toContain('<nav class="navbar site-navbar fixed-top">');
    expect(header).toContain('<div class="container-fluid d-block">');
    expect(header).not.toContain('site-navbar fixed-top container col-lg-8');
    expect(styles).toContain('.site-navbar > .container-fluid > .site-navbar-main');
    expect(styles).not.toContain('.site-navbar > .site-navbar-main');
  });

  test('keeps one offcanvas hamburger outside breakpoint-specific actions', () => {
    expect(header.match(/class="[^"]*top-nav-menu-toggle[^"]*"/g)).toHaveLength(1);
    expect(header).toContain('<div class="col-auto d-flex align-items-center site-navbar-menu-toggle">');
    expect(header).toContain('data-bs-target="#offcanvas-topnav"');
  });

	test('uses a desktop-only second header row for the full-width command search', () => {
		expect(header).toContain('class="col-12 d-none d-md-flex site-navbar-search-row"');
		expect(header).toContain('Search Hadith or Quran + Tafsir');
		expect(header).not.toContain('command-search-nav-item');
		expect(header).toContain('command-search-compact-item');
		expect(styles).toContain('--site-header-search-height: 3.25rem;');
		expect(styles).toContain('--site-header-shrink-height: var(--site-header-primary-shrink-height);');
		expect(styles).toContain('min-height: var(--site-header-height);');
		expect(styles).toContain('.site-navbar-search-row');
		expect(styles).toContain('.site-navbar.shrink .command-search-compact-item');
		expect(styles).toMatch(/\.site-navbar\.shrink \.site-navbar-search-row \{\s*display: none !important;/);
		expect(styles).toMatch(/\.top-nav-desktop-actions \{\s*column-gap: 1\.15rem;/);
		expect(styles).toMatch(/@media \(max-width: 1199\.98px\) and \(min-width: 768px\)[\s\S]*?\.top-nav-desktop-actions \{\s*column-gap: 0\.75rem;/);
		expect(styles).toContain('margin-top: max(5rem, calc(var(--site-fixed-header-height, 0px) + 0.75rem));');
	});

	test('uses one command search dialog from desktop and mobile without a rail search form', () => {
		expect(header.match(/data-command-search-open/g)).toHaveLength(3);
		expect(header).toContain("include('global_search_dialog.ejs'");
		expect(header).not.toContain('search-click-toggle');
		expect(header).not.toMatch(/<div class="offcanvas-body">\s*<form[^>]*>/);
		expect(searchDialog).toContain('id="global-search-dialog"');
		expect(searchDialog).toContain('data-command-search-mode="hadith"');
		expect(searchDialog).toContain('data-command-search-mode="quran"');
		expect(searchDialog).toContain("include('menu_icon.ejs', { type: 'hadith'");
		expect(searchDialog).toContain("include('menu_icon.ejs', { type: 'quran'");
		expect(searchDialog).not.toContain('bi-journal-text');
		expect(searchDialog).not.toContain('command-search-submit');
		expect(searchDialog).not.toContain('bi-arrow-right');
		expect(searchDialog).toContain('Quran + Tafsir');
		expect(searchDialog.match(/command-search-mode-icon/g)).toHaveLength(4);
		expect(styles).toContain('.command-search-mode-icon .app-menu-icon');
		expect(styles).toContain('color: inherit !important;');
		expect(styles).toContain('background-color: currentColor;');
		expect(styles).toContain("mask: url('/static/img/quran-icon.svg') center / contain no-repeat;");
		expect(styles).toContain('border: 1px solid var(--c-accent);');
		expect(styles).toContain('.command-search-trigger');
		expect(styles).toContain('.command-search-dialog::backdrop');
		expect(scripts).toContain("event.key.toLowerCase() === 'k'");
		expect(scripts).toContain("event.metaKey || event.ctrlKey");
	});

	test('filters command autocomplete and renders removable selected-book pills', () => {
		expect(searchDialog).toContain('data-command-search-filter-search="hadith"');
		expect(searchDialog).toContain('data-command-search-filter-search="quran"');
		expect(searchDialog).toContain('name="tafsir"');
		expect(searchDialog).toContain('data-command-search-pills');
		expect(scripts).toContain("input[name=tafsir]:checked:not(:disabled)");
		expect(scripts).toContain("[data-command-filter]:checked:not(:disabled)");
		expect(searchRoutes).toContain("bookFilters.indexOf('quran') >= 0 ? ['quran', 'commentaries'] : ['commentaries']");
	});

	test('removes legacy page search and Quran navigation controls in favor of the shared command search', () => {
		expect(hadithHome).not.toContain('id="search-bar"');
		expect(searchResults).not.toContain('id="search-bar"');
		expect(searchResults).not.toContain('search-filter-toggle');
		expect(searchResults).toContain('search-results-filter-pills command-search-pills');
		expect(searchResults).toContain('command-search-pill badge rounded-pill');
		expect(searchResults).toContain('data-search-filter-remove');
		expect(searchResults).toContain('class="search-results-summary"');
		expect(searchResults).toContain('<%= displayResultCount %> results found');
		expect(searchResults).not.toContain('Found <%= displayResultCount %> results in');
		expect(searchResults).toMatch(/if \(!isSearchResultsPage\) \{ %>\s*<%- include\('sub-views\/bookNav\.ejs'\); %>/);
		expect(styles).toMatch(/\.search-results-summary \{[\s\S]*?justify-content: space-between;/);
		expect(styles).toMatch(/\.search-results-filter-pills \{\s*flex: 1 1 auto;\s*justify-content: flex-start;/);
		expect(styles).toMatch(/\.search-results-count \{[\s\S]*?text-align: right;/);
		[quranToc, quranStudy, tafsirPassage, translationPassage].forEach(function (template) {
			expect(template).not.toContain('quran-passage-search');
			expect(template).not.toContain('quran-passage-surah');
			expect(template).not.toContain('quran-passage-ayah');
			expect(template).not.toContain('data-quran-passage-navigator');
		});
	});

	test('preselects the current Hadith, Tafsir, or translation context', () => {
		expect(header).toContain("requestPath !== '/' && pageBook");
		expect(header).toContain("quranSearchContext: quranSearchContext");
		expect(header).toContain('page.context.fromSearch === true');
		expect(header).toContain('hadithSearchBookAliases: hadithSearchBookAliases');
		expect(header).toContain('quranSearchBookFilters: quranSearchBookFilters');
		expect(header).toContain('quranSearchCommentaryAliases: quranSearchCommentaryAliases');
		expect(searchDialog).toContain('selectedCommandHadithAliases.indexOf(book.alias) >= 0');
		expect(searchDialog).toContain('selectedCommandQuranBookFilters.indexOf(\'quran\') >= 0');
		expect(searchDialog).toContain('selectedCommandCommentaryAliases.indexOf(tafsir.alias) >= 0');
		expect(searchDialog).toContain('data-command-search-results-context=');
		expect(scripts).toContain("dialog.dataset.commandSearchResultsContext !== '1'");
		expect(searchDialog).toContain('data-quran-search-context=');
		expect(searchDialog).toContain('data-command-commentary-kind="translation"');
		expect(searchDialog).toContain('All Tafsir &amp; translations');
		expect(scripts).toContain("context === 'study'");
		expect(scripts).toContain('storedQuranSelectedTranslationAlias()');
		expect(scripts).toContain("input[name=tafsir]:checked:not(:disabled)");
		expect(scripts).toContain("params.push({ name: 'b', value: 'tafsir' });");
		expect(searchRoutes).toContain('Tafsir.visibleTafsirsSync().concat(Tafsir.visibleTranslationsSync())');
		expect(searchLibrary).toContain("type: isTranslation ? 'Translation' : 'Tafsir'");
		expect(searchLibrary).toContain('translationAutocompleteUrl(doc)');
	});

	test('retains Mushaf, Study, or the active tafsir for Quran autocomplete destinations', () => {
		expect(header).toContain("['mushaf', 'study', 'tafsir']");
		expect(searchDialog).toContain('data-quran-tafsir-base=');
		expect(scripts).toContain("returnMode === 'mushaf'");
		expect(scripts).toContain("returnMode === 'tafsir' && item.type === 'Ayah'");
		expect(scripts).toContain('`/quran/tafsir/${encodeURIComponent(tafsirMode)}`');
	});

	test('renames only the Quran Sections menu label to Passages', () => {
	  expect(header).toContain("isQuranToc ? 'Show passages' : 'Show sections'");
	  expect(header).toContain("isQuranToc ? 'Passages' : 'Sections'");
	  expect(header).toContain('<span class="chapter-toc-current">§<%= page.context.section.h2 %></span>');
	  expect(header).toContain("<%= `§${section.h2 + (section.h3 ? `-${section.h3}` : '')}` %>");
	});

	test('fades the tafsir book carousel with reader navigation chrome', () => {
	  expect(styles).toContain('body.reader-infinite-nav-faded main.tafsir-only-page > .quran-tafsirs > .h-menu-wrap');
	  expect(styles).toMatch(/\.quran-tafsirs>\.h-menu-wrap\s*\{[^}]*transition: opacity \.22s ease, transform \.22s ease;/s);
	});

	test('keeps the tafsir book carousel below the live header height', () => {
	  expect(styles).toMatch(/\.quran-tafsirs>\.h-menu-wrap\s*\{[^}]*top: var\(--site-fixed-header-height, 4\.25rem\);/s);
	  expect(scripts).toContain('initFixedHeaderOffsetObserver();');
	  expect(scripts).toContain('fixedHeaderResizeObserver.observe(navbar);');
	  expect(scripts).toContain("fixedHeaderResizeObserver.observe(navbarMain);");
	});
});
