/* Compact shared presentation for all book catalogs. Reader URLs and filter data stay on the original cards. */
(function () {
  'use strict';
  var page = document.querySelector('.book-catalog-page');
  if (!page) return;
  // Move tabs from older cached catalogs into the same header slot as freshly rendered pages.
  var cachedTabs = page.querySelector('.book-catalog-tabs');
  var header = document.querySelector('.site-navbar');
  if (cachedTabs && header && !header.querySelector('.book-catalog-navigation')) {
    var navigation = document.createElement('nav');
    navigation.className = 'row g-0 chapter-toc book-catalog-navigation';
    navigation.setAttribute('aria-label', 'Book collections');
    var toolbar = document.createElement('div');
    toolbar.className = 'col-12 chapter-toc-toolbar';
    cachedTabs.classList.remove('mb-3');
    toolbar.append(cachedTabs); navigation.append(toolbar);
    header.insertBefore(navigation, header.querySelector('.site-navbar-search-row'));
  }
  if (page.querySelector('._e') || typeof HTMLDialogElement === 'undefined') return;

  var sizeLabels = { sm: 'S', md: 'M', lg: 'L' };
  var sizeNames = { sm: 'Small', md: 'Medium', lg: 'Large' };
  var activeSize = '';
  var sizeOf = function (card) {
    var size = card.dataset.bookCatalogSize;
    if (!size) {
      var indicator = card.querySelector('.tafsir-size-indicator, .hadith-size-indicator');
      var match = indicator && indicator.className.match(/(?:tafsir|hadith)-size-indicator-(sm|md|lg)\b/);
      size = match ? match[1] : '';
    }
    return sizeLabels[size] ? size : '';
  };
  window.bookCatalogMatchesSize = function (card) { return !activeSize || sizeOf(card) === activeSize; };
  // Cached catalog HTML may still contain the older search/category handlers.
  // Apply size after those handlers so all filter dimensions continue to intersect.
  var enforceSizeFilter = function () {
    if (!activeSize) return;
    page.querySelectorAll('.tafsir-book-row').forEach(function (card) {
      if (!window.bookCatalogMatchesSize(card)) card.classList.add('d-none');
    });
    var visibleScope = page.querySelector('.book-catalog-tab-pane.active') || page;
    var hasMatches = Array.from(visibleScope.querySelectorAll('.tafsir-book-row')).some(function (card) {
      return !card.classList.contains('d-none');
    });
    var empty = page.querySelector('.book-catalog-filter-empty, .tafsir-book-filter-empty, .translation-book-filter-empty');
    if (empty) empty.classList.toggle('d-none', hasMatches);
  };
  page.addEventListener('input', enforceSizeFilter);
  page.addEventListener('click', function (event) {
    if (event.target.closest('[data-book-catalog-group-filter], [data-book-catalog-language-filter], [data-tafsir-group-filter], [data-tafsir-language-filter]')) enforceSizeFilter();
  });
  document.addEventListener('shown.bs.tab', enforceSizeFilter);
  var search = page.querySelector('input[type="search"]');
  if (search) {
    var sizeFilters = document.createElement('div');
    sizeFilters.className = 'book-catalog-size-filters';
    sizeFilters.setAttribute('role', 'group');
    sizeFilters.setAttribute('aria-label', 'Filter books by size');
    var setSize = function (size) {
      activeSize = size;
      page.dataset.bookCatalogActiveSize = size;
      sizeFilters.querySelectorAll('button').forEach(function (candidate) {
        var selected = candidate.dataset.bookCatalogSizeFilter === size;
        candidate.classList.toggle('active', selected);
        candidate.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
      search.dispatchEvent(new Event('input', { bubbles: true }));
    };
    ['sm', 'md', 'lg'].forEach(function (size) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-outline-primary';
      button.dataset.bookCatalogSizeFilter = size;
      button.textContent = sizeLabels[size];
      button.setAttribute('aria-label', sizeNames[size] + ' books');
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', function () {
        setSize(activeSize === size ? '' : size);
      });
      sizeFilters.append(button);
    });
    var filterBar = page.querySelector('.h-menu');
    var allFilter = page.querySelector('[data-book-catalog-group-filter=""], [data-tafsir-group-filter=""]');
    if (allFilter) {
      allFilter.after(sizeFilters);
      allFilter.addEventListener('click', function () { setSize(''); });
    } else if (filterBar) filterBar.append(sizeFilters);
    else {
      sizeFilters.classList.add('mb-3');
      search.parentElement.after(sizeFilters);
    }
  }

  var groups = new Map();
  page.querySelectorAll('[data-book-catalog-group-filter], [data-tafsir-group-filter]').forEach(function (button) {
    var id = button.dataset.bookCatalogGroupFilter || button.dataset.tafsirGroupFilter;
    if (id) groups.set(id, button.textContent.trim());
  });

  var dialog = document.createElement('dialog');
  dialog.className = 'book-catalog-dialog';
  dialog.setAttribute('aria-labelledby', 'book-catalog-dialog-title');
  dialog.innerHTML = '<div class="book-catalog-dialog-header"><h2 id="book-catalog-dialog-title">Book details</h2><button type="button" class="btn-close" aria-label="Close book details"></button></div><div class="book-catalog-dialog-body"></div>';
  document.body.append(dialog);
  var body = dialog.querySelector('.book-catalog-dialog-body');
  var current = null;
  var opener = null;
  dialog.querySelector('button').addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('click', function (event) {
    var rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  dialog.addEventListener('close', function () {
    if (current) { current.card.append(current.details); current.details.hidden = true; }
    current = null;
    document.body.classList.remove('book-catalog-dialog-open');
    if (opener) opener.focus({ preventScroll: true });
  });

  page.querySelectorAll('.tafsir-book-list').forEach(function (list) {
    var pane = list.closest('.book-catalog-tab-pane');
    var context = pane ? pane.id : window.location.pathname;
    var type = list.dataset.bookCatalogType || (/mushaf/.test(context) ? 'Mushaf'
      : /sharh/.test(context) ? 'Sharḥ' : /tafsir/.test(context) ? 'Tafsir'
      : /translations/.test(context) ? 'Translation' : /sirah|history/.test(context) ? 'History & Sirah' : 'Hadith');
    var cards = Array.from(list.querySelectorAll('.tafsir-book-row'));
    var hasCategories = cards.some(function (card) {
      return (card.dataset.bookCatalogGroups || card.dataset.tafsirBookGroups || '').split(/\s+/).some(function (id) { return groups.has(id); });
    });
    var sections = new Map();
    cards.forEach(function (card) {
      var details = card.querySelector('.tafsir-book-row-main');
      if (!details) return;
      var size = sizeOf(card);
      card.dataset.bookCatalogSize = size;
      if (size && !details.querySelector('.tafsir-size-indicator, .hadith-size-indicator')) {
        var title = details.querySelector('.tafsir-book-title-line:not([lang="ar"])');
        if (title) {
          var indicator = document.createElement('span');
          indicator.className = 'tafsir-size-indicator tafsir-size-tooltip tafsir-size-indicator-' + size;
          indicator.title = sizeNames[size] + ' book';
          indicator.dataset.tafsirSizeTooltip = indicator.title;
          indicator.setAttribute('role', 'img');
          indicator.setAttribute('aria-label', indicator.title);
          title.append(indicator);
        }
      }
      var summary = document.createElement('div');
      summary.className = 'book-catalog-summary';
      var ids = (card.dataset.bookCatalogGroups || card.dataset.tafsirBookGroups || '').split(/\s+/).filter(Boolean);
      ['.tafsir-book-title-pair', '.tafsir-book-meta'].forEach(function (selector) {
        var source = details.querySelector(selector);
        if (!source) return;
        var copy = source.cloneNode(true);
        copy.querySelectorAll('[id]').forEach(function (node) { node.removeAttribute('id'); });
        copy.querySelectorAll('.book-language-badge').forEach(function (node) { node.remove(); });
        // Cards use short author names; full names and dates stay in the original modal metadata.
        if (selector === '.tafsir-book-meta') {
          var englishAuthor = source.querySelector(':scope > div:not([lang="ar"]) > span');
          var arabicAuthor = source.querySelector(':scope > [lang="ar"] > span');
          var authorEn = card.dataset.bookAuthorShortEn || (englishAuthor ? englishAuthor.textContent.trim() : '');
          var authorAr = card.dataset.bookAuthorShortAr || (arabicAuthor ? arabicAuthor.textContent.trim() : '');
          if (authorEn || authorAr) {
            copy.replaceChildren();
            if (authorEn) {
              var en = document.createElement('div'); en.textContent = authorEn; copy.append(en);
            }
            if (authorAr) {
              var ar = document.createElement('div'); ar.lang = 'ar'; ar.dir = 'rtl'; ar.textContent = authorAr; copy.append(ar);
            }
          } else Array.from(copy.children).slice(2).forEach(function (node) { node.remove(); });
        }
        summary.append(copy);
      });
      var classifications = document.createElement('div');
      classifications.className = 'book-catalog-classifications';
      classifications.setAttribute('aria-label', 'Book classifications');
      [type].concat(ids.map(function (id) { return groups.get(id); }).filter(Boolean)).forEach(function (label, index) {
        var pill = document.createElement('span');
        pill.className = 'book-catalog-pill' + (index === 0 ? ' book-catalog-type-pill' : '');
        pill.textContent = label;
        classifications.append(pill);
      });
      var languageBadge = details.querySelector('.book-language-badge');
      var language = languageBadge ? languageBadge.textContent.trim()
        : (card.dataset.bookCatalogLanguage || card.dataset.tafsirLanguage || '').trim().toUpperCase().replace(/\s+/g, '-');
      if (language) {
        var languagePill = document.createElement('span');
        languagePill.className = 'book-catalog-pill book-catalog-language-pill';
        languagePill.textContent = language;
        languagePill.setAttribute('aria-label', 'Language: ' + language);
        classifications.insertBefore(languagePill, classifications.children[1] || null);
      }
      summary.append(classifications);
      var detailClassifications = classifications.cloneNode(true);
      var detailTitles = details.querySelector('.tafsir-book-title-pair');
      if (detailTitles) detailTitles.after(detailClassifications);
      else details.prepend(detailClassifications);
      if (languageBadge) languageBadge.remove();
      var button = document.createElement('button');
      button.type = 'button'; button.className = 'book-catalog-details-button';
      button.innerHTML = '<span class="bi bi-info-circle" aria-hidden="true"></span>';
      button.title = 'Book details';
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-label', 'Book details: ' + (summary.querySelector('a') || summary).textContent.trim());
      button.addEventListener('click', function () {
        current = { card: card, details: details }; opener = button;
        details.hidden = false;
        details.querySelectorAll('.toc-book-description-summary').forEach(function (node) { node.hidden = true; });
        details.querySelectorAll('.toc-book-description-full').forEach(function (node) { node.classList.remove('d-none'); });
        body.replaceChildren(details);
        document.body.classList.add('book-catalog-dialog-open');
        dialog.showModal(); body.scrollTop = 0;
      });
      var titles = summary.querySelector('.tafsir-book-title-pair');
      if (titles) titles.insertBefore(button, titles.children[1] || null);
      else summary.prepend(button);
      var death = Number(card.dataset.bookDeath);
      var legacyDeath = details.querySelector('.tafsir-book-meta');
      var deathMatch = legacyDeath && legacyDeath.textContent.match(/\bd\.\s*(\d+)\s*(AH|CE)?/);
      if (!death && deathMatch) death = Number(deathMatch[1]);
      if (death > 0) {
        var deathLine = document.createElement('div');
        deathLine.className = 'book-catalog-death';
        deathLine.textContent = 'd. ' + death + ' ' + (type === 'Translation' ? 'CE' : 'AH');
        summary.append(deathLine);
      }
      card.prepend(summary); details.hidden = true;
      var id = ids.find(function (candidate) { return groups.has(candidate); }) || '';
      if (!sections.has(id)) {
        var section = document.createElement('section');
        section.className = 'book-catalog-category';
        if (hasCategories) {
          var label = groups.get(id) || 'Other books';
          var heading = document.createElement('h2');
          heading.className = 'book-catalog-category-title';
          heading.textContent = label; section.append(heading);
        }
        var grid = document.createElement('div'); grid.className = 'book-catalog-grid'; section.append(grid);
        sections.set(id, section);
      }
      sections.get(id).querySelector('.book-catalog-grid').append(card);
    });
    // Follow the configured category order while retaining book order within each group.
    Array.from(groups.keys()).concat(['']).forEach(function (id) { if (sections.has(id)) list.append(sections.get(id)); });
    var update = function () {
      sections.forEach(function (section) {
        section.hidden = !Array.from(section.querySelectorAll('.tafsir-book-row')).some(function (card) { return !card.classList.contains('d-none'); });
      });
    };
    new MutationObserver(update).observe(list, { subtree: true, attributes: true, attributeFilter: ['class'] });
    update();
  });
  page.classList.add('book-catalog-compact');
})();
