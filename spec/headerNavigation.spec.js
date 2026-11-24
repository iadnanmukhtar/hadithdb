'use strict';

const fs = require('fs');
const path = require('path');

describe('shared header navigation', () => {
  const quranBar = fs.readFileSync(path.join(__dirname, '../views/sub-views/quran_bar.ejs'), 'utf8');
  const sectionMenu = fs.readFileSync(path.join(__dirname, '../views/sub-views/chapter_section_menu.ejs'), 'utf8');
  const readerLinks = fs.readFileSync(path.join(__dirname, '../public/static/js/quran-reader-links.js'), 'utf8');
  const readerBarContext = fs.readFileSync(path.join(__dirname, '../lib/QuranReaderBar.js'), 'utf8');
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
  const inlineScripts = fs.readFileSync(
    path.join(__dirname, '..', 'views', 'sub-views', 'scripts.ejs'),
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
  const mushaf = fs.readFileSync(path.join(__dirname, '..', 'views', 'quran_mushaf.ejs'), 'utf8');
  const translationPassage = fs.readFileSync(path.join(__dirname, '..', 'views', 'translation_passage.ejs'), 'utf8');
  const searchResults = fs.readFileSync(path.join(__dirname, '..', 'views', 'search.ejs'), 'utf8');
  const readerModes = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'quran_reader_modes.ejs'), 'utf8');
  const commentaryBookNav = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'quran_commentary_book_nav.ejs'), 'utf8');
  const quranTafsirs = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'quran_tafsirs.ejs'), 'utf8');
  const bookNav = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'bookNav.ejs'), 'utf8');
  const tafsirLanguageSwitch = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'tafsirCarouselLanguageSwitch.ejs'), 'utf8');

  test('groups drawer destinations by task and keeps Personal after Community', () => {
    const groups = ['Read & study', 'Memorize', 'Community', 'Personal'];
    const positions = groups.map(group => offcanvasPrimaryNav.indexOf("['" + group + "', ["));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(offcanvasPrimaryNav).toContain('data-drawer-profile');
  });

  test('uses the full page width', () => {
    expect(header).toContain('<div class="navbar site-navbar fixed-top');
    expect(header).toContain('<nav class="container-fluid d-block" aria-label="Site navigation">');
    expect(header).not.toContain('site-navbar fixed-top container col-lg-8');
    expect(styles).toContain('.site-navbar > .container-fluid > .site-navbar-main');
    expect(styles).not.toContain('.site-navbar > .site-navbar-main');
  });

  test('keeps one offcanvas hamburger outside breakpoint-specific actions', () => {
    expect(header.match(/class="[^"]*top-nav-menu-toggle[^"]*"/g)).toHaveLength(1);
    expect(header).toContain('<div class="col-auto d-flex align-items-center site-navbar-menu-toggle">');
    expect(header).toContain('data-bs-target="#offcanvas-topnav"');
  });

  test('keeps account links in the profile dropdown and mode controls in both menus', () => {
    expect(header).not.toContain('class="nav-item edit-gear"');
    expect(offcanvasPrimaryNav).not.toContain('edit-gear');
    expect(header).not.toContain('> My Settings</a>');
    expect(offcanvasPrimaryNav).not.toContain('> My Settings</a>');
    for (const source of [scripts, inlineScripts]) {
      expect(source).toContain("document.querySelectorAll('[data-profile-menu], #offcanvas-topnav .offcanvas-col1')");
      expect(source).not.toContain('authItem.after(item)');
    }
    expect(header).toContain('data-settings-href="<%= settingsHref %>"');
    expect(header).not.toMatch(/<button[^>]*id="nav-auth-mobile"/);
  });

  test('links to Quran home in the masthead and keeps Tafsir in the drawer', () => {
    expect(header).toContain("utils.quranUrl(req, '/quran')");
    expect(header).not.toContain('>Tafsir</a>');
    expect(offcanvasPrimaryNav).toContain("utils.urlFor(req, '/books?tafsir')");
    for (const label of ['Study by ayah', 'Translations', 'Mushaf', 'Practice', 'Mudhakkir review']) {
      expect(offcanvasPrimaryNav).toContain("['" + label + "',");
    }
  });

  test('renders the compact command search in the masthead', () => {
    expect(header).toContain('fixed-top ux-masthead');
    expect(header).toContain('command-search-compact-trigger');
    expect(header).not.toContain('site-navbar-search-row');
  });


	test('uses one command search dialog from desktop and mobile without a rail search form', () => {
		expect(header.match(/data-command-search-open/g)).toHaveLength(2);
		expect(header).toContain("include('global_search_dialog.ejs'");
		expect(header).not.toContain('search-click-toggle');
		expect(header).not.toMatch(/<div class="offcanvas-body">\s*<form[^>]*>/);
		expect(searchDialog).toContain('id="global-search-dialog"');
		expect(searchDialog).toContain('data-command-scope aria-label="Search scope"');
		expect(searchDialog).not.toContain('data-command-search-mode');
		expect(searchDialog).toContain('data-command-within-book');
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
		const finder = searchDialog.split('\n').find(line => line.includes("'command-search-filter-search'"));
		const html = require('ejs').render(finder, { utils: {scriptAssetVersion: () => 'test'} }, {
			filename: path.join(__dirname, '../views/sub-views/global_search_dialog.ejs')
		});
		const field = require('cheerio').load(html)('[data-rail-search]');
		expect(field.length).toBe(1);
		expect(field.find('input[type="search"]').attr('data-command-search-filter-search')).toBe('all');
		expect(field.find('button').attr('aria-label')).toBe('Clear source filter');
		expect(styles).toContain('.command-search-scope');
		expect(styles).toMatch(/\.nav-tabs \.nav-link:not\(\.active\) \{\s*color: var\(--bs-secondary-color\);/);
		expect(searchDialog).toContain('name="tafsir"');
		expect(searchDialog).toContain('data-command-search-pills');
		expect(scripts).toContain("input[name=tafsir]:checked:not(:disabled)");
		expect(scripts).toContain("[data-command-filter]:checked:not(:disabled)");
		expect(scripts).toContain("clearAll.textContent = 'Clear all'");
		expect(scripts).toContain("activePanel().querySelectorAll('[data-command-filter]:checked:not(:disabled)')");
		expect(searchRoutes).toContain("bookFilters.indexOf('quran') >= 0 ? ['quran', 'commentaries'] : ['commentaries']");
	});

	test('retains separate Hadith and Quran command-search terms for the browser session', () => {
		expect(scripts).toContain("hadith: 'hadithdb.commandSearch.term.hadith'");
		expect(scripts).toContain("quran: 'hadithdb.commandSearch.term.quran'");
		expect(scripts).toContain('storage.setItem(searchTermStorageKeys[searchMode]');
		expect(scripts).toContain('input.value = storage.getItem(searchTermStorageKeys[searchMode])');
		expect(scripts).toMatch(/function openDialog\(trigger\) \{[\s\S]*?restoreSearchTerm\(mode\);[\s\S]*?dialog\.showModal\(\);/);
		expect(scripts).toMatch(/scopePicker.addEventListener\('change'[\s\S]*?storeSearchTerm\(mode\)/);
	});

	test('removes legacy page search and Quran navigation controls in favor of the shared command search', () => {
		expect(hadithHome).not.toContain('id="search-bar"');
		expect(searchResults).not.toContain('id="search-bar"');
		expect(searchResults).not.toContain('search-filter-toggle');
		expect(searchResults).toContain('search-results-filter-pills command-search-pills');
		expect(searchResults).toContain('ux-pill ux-pill-removable');
		expect(searchResults).toContain('data-search-filter-remove');
		expect(searchResults).toContain('data-search-filter-clear');
		expect(scripts).toContain("url.searchParams.delete('b')");
		expect(scripts).toContain("url.searchParams.delete('tafsir')");
		expect(searchResults).toContain('class="ux-text-action" data-search-filter-clear');
		expect(searchResults).toContain('class="search-results-summary"');
		expect(searchResults).toContain('<%= displayResultCount %> results found');
		expect(searchResults).not.toContain('Found <%= displayResultCount %> results in');
		expect(searchResults).toMatch(/if \(!isSearchResultsPage && !sirahDetailItem && !detailHadithItem\) \{ %>\s*<%- include\('sub-views\/bookNav\.ejs'\); %>/);
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

	test('offers the current book as an explicit shortcut and restores filters on results', () => {
		expect(header).toContain('contextualSearchBookAlias: contextualSearchBookAlias');
		expect(searchDialog).toContain('data-command-within-book');
		expect(scripts).toContain('field.checked = field === contextField');
		expect(scripts).toContain('field.checked = field.defaultChecked');
		expect(scripts).toContain("form.dataset.searchCollection = mode");
	});

	test('retains Mushaf, Study, or the active tafsir for Quran autocomplete destinations', () => {
		expect(header).toContain("['mushaf', 'study', 'tafsir']");
		expect(searchDialog).toContain('data-quran-tafsir-base=');
		expect(scripts).toContain("returnMode === 'mushaf'");
		expect(scripts).toContain("var mushafRef = (item.ref || '').toString().match(/^quran:(\\d+):(\\d+(?:-\\d+)?)/);");
		expect(scripts).toContain("var ayahQuery = mushafRef ? `?ayah=${mushafRef[1]}:${mushafRef[2]}` : '';");
		expect(scripts).toContain('return quranUrl(`/quran/page/${mushafPage}${ayahQuery}`)');
		expect(scripts).not.toMatch(/returnMode === 'mushaf'\)\s*url \+=/);
		expect(searchRoutes).toContain('Search.a_withQuranMushafPages(suggestions)');
		expect(scripts).toContain("returnMode === 'tafsir' && item.type === 'Ayah'");
		expect(scripts).toContain('`/quran/tafsir/${encodeURIComponent(tafsirMode)}`');
	});

	test('uses the shared Quran context paths for every mode', () => {
		expect(header).toContain("include('quran_bar.ejs'");
		for (const mode of ['passage', 'tafsir', 'mushaf', 'memorize', 'review']) expect(quranBar).toContain(`quranBar.paths.${mode}`);
		expect(scripts).toContain('window.QuranReaderLinks.paths(');
	});

	test('shows the same Quran bar independently of chapter sections', () => {
		expect(header).toContain("if (showQuranModes) {");
		expect(header).toContain("include('quran_bar.ejs'");
		expect(quranBar).not.toContain('sections.length');
	});

	test('uses canonical Mushaf page destinations or the exact ayah resolver', () => {
		const removedLegacyQuery = '?' + 'mushaf';
		for (const content of [header, scripts, inlineScripts, mushaf, readerLinks]) expect(content).not.toContain(removedLegacyQuery);
		expect(readerLinks).toContain("'/quran/page/' + page + '?ayah=' + ref");
		expect(readerLinks).toContain("'/quran/navigate?ref=' + ref");
	});

	test('links Mushaf footer headings and subheadings to their H2 section', () => {
		const mushaf = fs.readFileSync(path.join(__dirname, '..', 'views', 'quran_mushaf.ejs'), 'utf8');
		expect(mushaf).toContain('utils.quranStudySectionPath(passage)');
		expect(mushaf).toContain('utils.quranStudySectionPath({ surah: subsection.surah, section: subsection.section })');
	});

	test('retains the selected Study translation independently of Tafsir scope', () => {
		expect(readerBarContext).toContain('quranPreferredTranslationAlias');
		expect(readerBarContext).toContain("commentary.type === 'trans'");
		expect(readerLinks).toContain("studyBase + '/quran:' + ref");
		expect(readerLinks).toContain("tafsirBase + '/quran:' + ref");
	});

	test('compacts Quran section menus on mobile', () => {
		expect(quranBar).toContain('quran-mode-nav');
		expect(readerModes).toContain('class="quran-mode-picker ux-view-option"');
		expect(readerModes).toContain('data-quran-script-label');
	});

	test('keeps Mushaf disk caches separate for each resolved Quran script', () => {
		expect(scripts).toContain("var QURAN_SCRIPT_COOKIE = 'quranScript';");
		expect(scripts).toContain("setHadithCookie(QURAN_SCRIPT_COOKIE, script, window.HADITH_SESSION_MAX_AGE);");
		expect(scripts).toContain("var script = storeQuranScriptCookie(settings && settings.quran && settings.quran.script || 'uthmani');");
		expect(searchRoutes).toContain("filename += `__script-${quranMushafScript(req)}`;");
		expect(searchRoutes).toContain("return ['uthmani', 'indo-pak', 'warsh'].includes(script) ? script : 'uthmani';");
	});

	test('uses a single consistent reader-mode group with Tafsir after Study', () => {
		expect(readerModes).not.toContain('commentaryReaderMode');
		const html = require('ejs').render(readerModes, {
			readerMode: 'tafsir', passageHref: '/study', mushafHref: '/mushaf', tafsirHref: '/tafsir',
			req: {}, utils: { quranUrl: (_, url) => url }
		});
		const $ = require('cheerio').load(html);
		expect($('[data-quran-reader-mode-link]').map((_, el) => $(el).attr('data-quran-reader-mode-link')).get())
			.toEqual(['passage', 'tafsir', 'mushaf', 'memorize', 'review']);
		expect(scripts).toContain('getLastVisitedQuranTafsirSlug()');
	});

	test('removes Quran Passages while retaining the Hadith Sections menu', () => {
		expect(quranBar).not.toContain('Passages');
		expect(quranBar).not.toContain('toc2');
		expect(sectionMenu).toContain('<span>Sections</span>');
		expect(sectionMenu).toContain('href="#toc2"');
	});

	test('fades the tafsir book carousel with reader navigation chrome', () => {
	  expect(styles).toContain('body.reader-infinite-nav-faded main.tafsir-only-page > .quran-commentary-passage-carousel');
	  expect(styles).toMatch(/\.tafsir-only-page > \.quran-commentary-passage-carousel\s*\{[^}]*transition: opacity \.22s ease, transform \.22s ease;/s);
	});

	test('keeps a passage-linked tafsir carousel at the top below the live header height', () => {
	  expect(tafsirPassage.indexOf("include('sub-views/quran_commentary_book_nav.ejs'")).toBeLessThan(tafsirPassage.indexOf("include('sub-views/commentary_surah_heading.ejs'"));
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
	  for (const template of [commentaryBookNav, bookNav]) {
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

	test('does not show hover descriptions in the Hadith book carousel', () => {
	  expect(bookNav).not.toContain('book-carousel-tooltip');
	  expect(bookNav).not.toContain('data-book-tooltip');
	  expect(bookNav).not.toContain('bookTooltip');
	});

	test('uses the homepage shelf while retaining the reader carousel', () => {
	  expect(bookNav).toContain("include('home_library_shelf.ejs'");
	  expect(bookNav).toContain("include('bookCarouselFilter')");
	});
});
