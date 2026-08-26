'use strict';

const fs = require('fs');
const path = require('path');

describe('shared header navigation', () => {
  const header = fs.readFileSync(
    path.join(__dirname, '..', 'views', 'sub-views', 'header.ejs'),
    'utf8'
  );
  const offcanvasPrimaryNav = fs.readFileSync(
    path.join(__dirname, '..', 'views', 'sub-views', 'offcanvas_primary_nav.ejs'),
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
  const readerModes = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'quran_reader_modes.ejs'), 'utf8');
  const commentaryBookNav = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'quran_commentary_book_nav.ejs'), 'utf8');
  const quranTafsirs = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'quran_tafsirs.ejs'), 'utf8');
  const tafsirBookNav = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'tafsirBookNav.ejs'), 'utf8');
  const bookNav = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'bookNav.ejs'), 'utf8');
  const tafsirLanguageSwitch = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'tafsirCarouselLanguageSwitch.ejs'), 'utf8');

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

  test('promotes Tafsir and keeps the requested Quran submenu order', () => {
    const quranLabels = ['Quran', 'Translations', 'Study', 'Mushaf', 'Practice', 'Mudhakkir'];
    const desktopQuranMenu = header.match(/<ul class="dropdown-menu">([\s\S]*?)<\/ul>/)[1];

    expect(desktopQuranMenu).not.toContain('> Tafsir</a>');
    expect(header).toContain('activeNavAttrs(isQuranArea && !isQuranTafsirArea)');
    expect(header).toContain('href="<%= utils.quranUrl(req, \'/quran/tafsir\') %>">Tafsir</a>');
    expect(offcanvasPrimaryNav).not.toMatch(/nav-link ps-4[^\n]*\/quran\/tafsir/);

    for (const menu of [desktopQuranMenu, offcanvasPrimaryNav]) {
      quranLabels.slice(1).reduce((lastPosition, label) => {
        const position = menu.indexOf(`> ${label}</a>`);
        expect(position).toBeGreaterThan(lastPosition);
        return position;
      }, menu.indexOf("label: 'Quran'"));
    }
  });

	test('uses a desktop-only second header row for the full-width command search', () => {
		expect(header).toContain('class="col-12 d-none d-md-flex site-navbar-search-row"');
		expect(header).toContain('Search Hadith or Quran + Tafsir');
		expect(header.indexOf('<nav class="row g-0 chapter-toc">')).toBeLessThan(header.indexOf('class="col-12 d-none d-md-flex site-navbar-search-row"'));
		expect(header).not.toContain('command-search-nav-item');
		expect(header).toContain('command-search-compact-item');
		expect(styles).toContain('--site-header-search-height: 3.25rem;');
		expect(styles).toContain('--site-header-shrink-height: var(--site-header-primary-shrink-height);');
		expect(styles).toMatch(/\.site-navbar > \.container-fluid > \.site-navbar-main \{\s*height: auto;\s*min-height: var\(--site-header-primary-height\);/);
		expect(styles).toContain('.site-navbar-search-row');
		expect(styles).toMatch(/\.command-search-shortcut \{[\s\S]*?background: var\(--c-accent\);[\s\S]*?color: var\(--c-white\);/);
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
		expect(searchDialog).toContain('class="nav nav-tabs book-catalog-tabs command-search-mode-switch"');
		expect(searchDialog.match(/class="nav-link command-search-mode"/g)).toHaveLength(2);
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
		expect(styles).toMatch(/\.command-search-dialog \{[\s\S]*?overflow: visible;/);
		expect(styles).toMatch(/\.command-search-shell \{[\s\S]*?overflow-y: auto;/);
		expect(styles).toContain('.command-search-dialog > .ui-autocomplete.search-autocomplete-menu');
		expect(scripts).toContain("event.key.toLowerCase() === 'k'");
		expect(scripts).toContain("event.metaKey || event.ctrlKey");
		expect(scripts).toContain("$input.closest('[data-command-search-dialog]')");
	});

	test('filters command autocomplete and renders removable selected-book pills', () => {
		expect(searchDialog).toContain('data-command-search-filter-search="hadith"');
		expect(searchDialog).toContain('data-command-search-filter-search="quran"');
		expect(searchDialog.match(/class="page-content-filter input-group command-search-filter-find"/g)).toHaveLength(2);
		expect(searchDialog.match(/class="input-group-text bi bi-filter"/g)).toHaveLength(2);
		expect(styles).toContain('.page-content-filter .input-group-text');
		expect(styles).toContain('.nav-tabs .nav-link:not(.active)');
		expect(styles).toContain('.command-search-dialog .command-search-mode-switch .nav-link:not(.active)');
		expect(styles).toMatch(/\.command-search-filter-find > \.input-group-text,[\s\S]*?font-size: 0\.82rem;/);
		expect(styles).toMatch(/\.page-content-filter \{[\s\S]*?border: 1px solid var\(--bs-border-color\);/);
		expect(styles).toMatch(/\.page-content-filter \.input-group-text \{[\s\S]*?border: 0;[\s\S]*?color: var\(--bs-secondary-color\);/);
		expect(styles).toMatch(/\.page-content-filter \.form-control,[\s\S]*?border: 0;[\s\S]*?box-shadow: none;/);
		expect(styles).toMatch(/\.nav-tabs \.nav-link:not\(\.active\) \{\s*color: var\(--bs-secondary-color\);/);
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
		expect(scripts).toContain("var mushafRef = (item.ref || '').toString().match(/^quran:(\\d+):(\\d+)/);");
		expect(scripts).toContain("var ayahQuery = mushafRef ? `?ayah=${mushafRef[1]}:${mushafRef[2]}` : '';");
		expect(scripts).toContain('return quranUrl(`/quran/page/${mushafPage}${ayahQuery}`)');
		expect(scripts).not.toMatch(/returnMode === 'mushaf'\)\s*url \+=/);
		expect(searchRoutes).toContain('Search.a_withQuranMushafPages(suggestions)');
		expect(scripts).toContain("returnMode === 'tafsir' && item.type === 'Ayah'");
		expect(scripts).toContain('`/quran/tafsir/${encodeURIComponent(tafsirMode)}`');
	});

	test('keeps Study, Mushaf, and Practice section-menu links on the active Quran page', () => {
		expect(header).toContain('var quranMappedMushafHref = utils.quranUrl(req, `/quran/page/${quranMappedPage || 1}`);');
		expect(header).toContain('mushafHref: quranMappedMushafHref');
		expect(header).toContain('memorizeHref: `${quranMappedMushafHref}?memorize`');
		expect(readerModes).toContain("locals.mushafHref || utils.quranUrl(req, '/quran/page')");
		expect(readerModes).not.toContain('`${utils.quranUrl(req, req.path)}?mushaf`');
		expect(scripts).toContain("['passage', 'ayat', 'tafsir', 'mushaf', 'memorize', 'review'].forEach");
		expect(scripts).toContain('updateQuranReaderModeHrefs(pageElement)');
	});

	test('compacts Quran section menus on mobile', () => {
		expect(header).toContain("chapter-toc<%= isQuranToc ? ' quran-section-menu' : '' %>");
		expect(header).toContain('chapter-toc quran-section-menu');
		expect(styles).toMatch(/@media \(max-width: 576px\)[\s\S]*?\.quran-section-menu \.chapter-toc-toggle,[\s\S]*?display: none;/);
		expect(readerModes).toContain('data-quran-script-short-label');
		expect(scripts).toContain("return { uthmani: 'Uth', 'indo-pak': 'Ind', warsh: 'War' }");
		expect(styles).toMatch(/@media \(max-width: 576px\)[\s\S]*?\.quran-reader-modes \.quran-script-label-short \{\s*display: inline;/);
	});

	test('keeps Mushaf disk caches separate for each resolved Quran script', () => {
		expect(scripts).toContain("var QURAN_SCRIPT_COOKIE = 'quranScript';");
		expect(scripts).toContain("setHadithCookie(QURAN_SCRIPT_COOKIE, script, window.HADITH_SESSION_MAX_AGE);");
		expect(scripts).toContain("var script = storeQuranScriptCookie(settings && settings.quran && settings.quran.script || 'uthmani');");
		expect(searchRoutes).toContain("filename += `__script-${quranMushafScript(req)}`;");
		expect(searchRoutes).toContain("return ['uthmani', 'indo-pak', 'warsh'].includes(script) ? script : 'uthmani';");
	});

	test('shows Tafsir after Study in every Quran reader-mode group', () => {
		const [commentaryModes, standardModes] = readerModes.split('<% } else { %>');
		expect(readerModes).toContain("var commentaryReaderMode = ['translation', 'trans'].indexOf(locals.readerMode) >= 0;");
		for (const modeGroup of [commentaryModes, standardModes]) {
			expect(modeGroup.indexOf('data-quran-reader-mode-link="passage"')).toBeGreaterThanOrEqual(0);
			expect(modeGroup.indexOf('data-quran-reader-mode-link="tafsir"')).toBeGreaterThan(modeGroup.indexOf('data-quran-reader-mode-link="passage"'));
			expect(modeGroup.indexOf('data-quran-reader-mode-link="mushaf"')).toBeGreaterThan(modeGroup.indexOf('data-quran-reader-mode-link="tafsir"'));
		}
		expect(readerModes.match(/data-quran-reader-mode-link="tafsir"/g)).toHaveLength(2);
		expect(scripts).toContain("lastVisited: 'hadithdb_quran_last_visited_tafsir'");
		expect(scripts).toContain("var defaultQuranTafsirAlias = 'mokhtasar';");
		expect(scripts).toContain('|| defaultQuranTafsirAlias;');
		expect(scripts).toContain("target.setAttribute('data-quran-reader-first-ref', firstRef)");
		expect(scripts).toContain("source.querySelector('.quran-passage-section .ayah[data-quran-ref]')");
		expect(scripts).toContain("source.querySelector('[data-quran-mushaf-page]')");
		expect(scripts).toContain('quranReaderTafsirHref(quranReaderModeFirstRef(marker))');
	});

	test('renames only the Quran Sections menu label to Passages', () => {
	  expect(header).toContain("isQuranToc ? 'Show passages' : 'Show sections'");
	  expect(header).toContain("isQuranToc ? 'Passages' : 'Sections'");
	  expect(header).toContain('<span class="chapter-toc-current">§<%= page.context.section.h2 %></span>');
	  expect(header).toContain("<%= `§${section.h2 + (section.h3 ? `-${section.h3}` : '')}` %>");
	});

	test('fades the tafsir book carousel with reader navigation chrome', () => {
	  expect(styles).toContain('body.reader-infinite-nav-faded main.tafsir-only-page > .quran-commentary-passage-carousel');
	  expect(styles).toMatch(/\.tafsir-only-page > \.quran-commentary-passage-carousel\s*\{[^}]*transition: opacity \.22s ease, transform \.22s ease;/s);
	});

	test('keeps a passage-linked tafsir carousel at the top below the live header height', () => {
	  expect(tafsirPassage.indexOf("include('sub-views/quran_commentary_book_nav.ejs'")).toBeLessThan(tafsirPassage.indexOf('<heading class="row major">'));
	  expect(tafsirPassage).toContain('quranCommentaryPassage: { surah: surah.num, ayah: tafsirEntryStart, endAyah: tafsirEntryEnd }');
	  expect(commentaryBookNav).toContain("Tafsir.passageUrl(book, commentaryNavPassageSurah, commentaryNavPassageAyah, endAyah)");
	  expect(commentaryBookNav).toContain("' quran-commentary-passage-carousel'");
	  expect(commentaryBookNav).toContain('data-commentary-slug="<%= commentaryNavSlug(book) %>"');
	  expect(quranTafsirs).toContain("dedicatedTafsirPage ? ' d-none' : ''");
	  expect(styles).toMatch(/\.tafsir-only-page > \.quran-commentary-passage-carousel\s*\{[^}]*position: sticky;[^}]*top: var\(--site-fixed-header-height, 4\.25rem\);/s);
	  expect(scripts).toContain('updateTafsirPassageCarouselRef(quranRef);');
	  expect(scripts).toContain("var isPassageCarousel = carousel.attr('data-commentary-passage-carousel') === '1';");
	  expect(scripts).toContain('initFixedHeaderOffsetObserver();');
	  expect(scripts).toContain('fixedHeaderResizeObserver.observe(navbar);');
	  expect(scripts).toContain("fixedHeaderResizeObserver.observe(navbarMain);");
	});

	test('filters tafsir carousels by English or Arabic-only without hover descriptions', () => {
	  for (const template of [commentaryBookNav, tafsirBookNav, bookNav]) {
	    expect(template.indexOf("include('tafsirCarouselLanguageSwitch')")).toBeLessThan(template.indexOf("include('bookCarouselFilter')"));
	    expect(template).toContain('data-tafsir-carousel-language=');
	    expect(template).not.toContain('tafsir-book-tooltip');
	    expect(template).not.toContain('data-tafsir-tooltip');
	  }
	  expect(quranTafsirs.indexOf("include('tafsirCarouselLanguageSwitch')")).toBeLessThan(quranTafsirs.indexOf("include('bookCarouselFilter')"));
	  expect(quranTafsirs).toContain('data-selected-tafsir-carousel-language=');
	  expect(commentaryBookNav).toContain('data-current-commentary-carousel-language=');
	  expect(quranTafsirs).not.toContain('quran-tafsir-language-toggle');
	  expect(tafsirLanguageSwitch).toContain('>En</button>');
	  expect(tafsirLanguageSwitch).not.toContain('title=');
	  expect(scripts).toContain(".text(isArabic ? 'Ar' : 'En')");
	  expect(scripts).toContain("[data-tafsir-carousel-language]:not([data-tafsir-carousel-language-switch])");
	  expect(scripts).toContain("book.lang === 'ar' && catalogBookIsBilingual(book)");
	  expect(scripts).toContain('var initialLanguage = selectedCatalogBook');
	  expect(scripts).toContain('getStoredQuranTafsirAlias() || defaultQuranTafsirAlias');
	  expect(scripts).toContain('var defaultBook = books.find');
	  expect(scripts).toContain('var initialLanguage = selectedLanguage || currentItem.attr');
	  expect(styles).toContain('.btn-group.h-menu > .tafsir-carousel-language-switch + .book-carousel-filter');
	});
});
