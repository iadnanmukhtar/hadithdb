(function () {
  'use strict';
  var rail = document.getElementById('quran-navigation-rail');
  if (!rail) return;
  var content = rail.querySelector('.quran-navigation-content');
  var status = rail.querySelector('[role="status"]');
  var tabs = Array.from(rail.querySelectorAll('[data-navigation-tab]'));
  var picker = document.querySelector('.quran-mode-picker');
  if (picker) {
    function showCurrentMode() {
      picker.selectedIndex = Array.from(picker.options).findIndex(option => option.defaultSelected);
    }
    picker.hidden = false;
    picker.addEventListener('change', function () {
      var link = document.querySelector('[data-quran-reader-mode-link="' + picker.value + '"]');
      showCurrentMode();
      if (link) location.assign(link.href);
    });
    window.addEventListener('pageshow', showCurrentMode);
  }
  var data, loading, tab = 'surah', surah = 1, currentRef = '', currentPage = 0, currentJuz = 0;

  function normalize(value) {
    return String(value || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/[ى]/g, 'ي').replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x660)).replace(/[\u06f0-\u06f9]/g, d => String(d.charCodeAt(0) - 0x6f0))
      .replace(/[^a-z0-9\u0621-\u063a\u0641-\u064a]/g, '').replace(/([aeiou])\1+/g, '$1');
  }
  function context(trigger) {
    currentJuz = 0;
    var bar = document.querySelector('[data-quran-bar]');
    var clickedPage = trigger && trigger.closest('[data-quran-mushaf-page]');
    if (bar && typeof window.updateQuranReaderModeHrefs === 'function') window.updateQuranReaderModeHrefs(clickedPage || bar.quranReaderMarker || document.querySelector('main'), clickedPage && window.quranReaderModeFirstRef(clickedPage));
    var markers = Array.from(document.querySelectorAll('[data-quran-mushaf-page], main[data-reader-quran-ref], .quran-passage-section'));
    var marker = clickedPage || markers.find(node => { var box = node.getBoundingClientRect(); return box.bottom > 180 && box.top < window.innerHeight; }) || document.querySelector('main');
    currentRef = typeof window.quranReaderModeFirstRef === 'function' ? window.quranReaderModeFirstRef(marker) : '';
    var ayah = marker && (marker.querySelector('.ayah-selected[data-quran-ref]') || marker.querySelector('[data-quran-ref]'));
    currentRef = bar && bar.getAttribute('data-quran-current-ref') || currentRef;
    currentRef = currentRef || ayah && ayah.getAttribute('data-quran-ref') || (new URLSearchParams(window.location.search)).get('ayah') || '';
    var match = currentRef.match(/^(\d+):(\d+)/);
    surah = match ? Number(match[1]) : Number((window.location.pathname.match(/\/quran\/(?:[A-Za-z_-]+\/)?(\d+)(?:\/|$)/) || [])[1]) || 1;
    currentPage = Number(bar && bar.getAttribute('data-quran-current-page')) || Number(marker && marker.getAttribute('data-quran-mushaf-page')) || Number((window.location.pathname.match(/\/quran\/page\/(\d+)/) || [])[1]) || 0;
  }
  function href(ref, page) {
    var url = new URL(rail.dataset.navigationJump, window.location.origin);
    url.searchParams.set(page ? 'page' : 'ref', page || ref);
    url.searchParams.set('mode', rail.dataset.navigationMode);
    if (tab !== 'ayah') url.searchParams.set('destination', 'passage');
    if (rail.dataset.navigationBook) url.searchParams.set('book', rail.dataset.navigationBook);
    var query = new URLSearchParams(window.location.search);
    ['memorize', 'ayat'].forEach(key => { if (query.has(key)) url.searchParams.set(key, ''); });
    if (query.has('script')) url.searchParams.set('script', query.get('script'));
    return url.href;
  }
  function link(label, destination, active, arabic) {
    var a = document.createElement('a');
    a.className = 'quran-navigation-item'; a.href = destination;
    var name = document.createElement('span'); name.textContent = label; a.append(name);
    if (arabic) { var ar = document.createElement('span'); ar.lang = 'ar'; ar.dir = 'rtl'; ar.textContent = arabic; a.append(ar); }
    if (active) { a.classList.add('is-current'); a.setAttribute('aria-current', 'location'); }
    return a;
  }
  function column(label, items, groups = []) {
    var col = document.createElement('div'); col.className = 'quran-navigation-column';
    var input = document.createElement('input'); input.type = 'search'; input.placeholder = label === 'Search Ayah' ? 'Ayah' : label; input.setAttribute('aria-label', label);
    var filter = document.createElement('div'); filter.className = 'ux-rail-search quran-navigation-filter';
    var icon = document.createElement('span'); icon.className = 'bi bi-funnel'; icon.setAttribute('aria-hidden', 'true');
    var clear = document.createElement('button'); clear.type = 'button'; clear.setAttribute('aria-label', 'Clear ' + label.toLowerCase());
    clear.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';
    function clearSearch() { input.value = ''; input.dispatchEvent(new Event('input')); input.focus(); }
    clear.addEventListener('click', clearSearch);
    filter.append(icon, input, clear);
    var list = document.createElement('nav'); list.className = 'quran-navigation-list ux-menu-list'; list.setAttribute('aria-label', label.replace('Search ', ''));
    var empty = document.createElement('p'); empty.className = 'ux-rail-status p-2'; empty.textContent = 'No matches'; empty.hidden = items.length > 0;
    if (groups.length) list.append(...groups);
    else list.append(...items);
    list.append(empty);
    input.addEventListener('input', function () {
      var term = normalize(input.value), count = 0;
      items.forEach(item => {
        const names = groups.length && /^\d+$/.test(term) ? [item.textContent] : item.navigationSearchNames || [item.textContent];
        item.hidden = !names.some(name => normalize(name).includes(term));
        if (!item.hidden) count++;
      });
      groups.forEach(group => { group.hidden = !group.querySelector('a:not([hidden])'); });
      empty.hidden = count > 0;
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && input.value) { event.stopPropagation(); event.preventDefault(); clearSearch(); return; }
      if (event.key === 'Enter') { var first = items.find(item => !item.hidden); if (first) { event.preventDefault(); first.click(); } }
      if (event.key === 'ArrowDown') { var first = items.find(item => !item.hidden); if (first) { event.preventDefault(); first.focus(); } }
    });
    col.append(filter, list); return col;
  }
  function centerCurrent() {
    content.querySelectorAll('.quran-navigation-list').forEach(list => {
      var active = list.querySelector('.is-current');
      if (active && !active.hidden) list.scrollTop += active.getBoundingClientRect().top - list.getBoundingClientRect().top - (list.clientHeight - active.offsetHeight) / 2;
    });
  }
  function render() {
    if (!data) return;
    content.replaceChildren(); content.classList.toggle('has-ayahs', tab === 'ayah');
    content.setAttribute('aria-labelledby', 'quran-navigation-tab-' + tab);
    tabs.forEach(button => { var selected = button.dataset.navigationTab === tab; button.classList.toggle('active', selected); button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; });
    if (tab === 'surah' || tab === 'ayah') {
      content.append(column('Search Surah', data.surahs.map(s => {
        var a = link(s.num + '. ' + s.name, href(s.num + ':1'), s.num === surah, s.arabic);
        a.navigationSearchNames = [String(s.num), s.name, s.arabic].concat(s.aliases || []);
        if (tab === 'ayah') {
          a.setAttribute('role', 'button'); a.setAttribute('aria-label', 'Select ' + s.name + ' ayahs');
          a.addEventListener('click', event => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault(); surah = s.num;
            content.querySelectorAll('.quran-navigation-column:first-child .quran-navigation-item').forEach(item => { item.classList.remove('is-current'); item.removeAttribute('aria-current'); });
            a.classList.add('is-current'); a.setAttribute('aria-current', 'location'); renderAyahs();
          });
          a.addEventListener('keydown', event => { if (event.key === ' ') { event.preventDefault(); a.click(); } });
        }
        return a;
      })));
      if (tab === 'ayah') renderAyahs();
    } else if (tab === 'juz' || tab === 'manzil') {
      var rows = data[tab] || [], label = tab === 'manzil' ? 'Manzil' : 'Juz';
      var activeSubdivision = rows.filter(row => { var p = row.ref.split(':').map(Number), c = currentRef.split(':').map(Number); return p[0] < c[0] || p[0] === c[0] && p[1] <= c[1]; }).pop();
      content.append(column('Search ' + label, rows.map(row => link(label + ' ' + row.num, href(row.ref), tab === 'juz' && currentJuz ? row.num === currentJuz : row === activeSubdivision, row.title))));
    } else {
      content.append(pageColumn());
    }
    centerCurrent();
  }
  function pageColumn() {
    const pages = Array.from({length: data.pages}, (_, index) => {
      const page = index + 1;
      return link('Page ' + page, href('', page), page === currentPage);
    });
    const divisions = data.juz || [];
    if (!divisions.length || divisions[0].startPage !== 1 || !divisions.every((juz, i) =>
      Number.isInteger(juz.startPage) && juz.startPage <= pages.length && (!i || juz.startPage > divisions[i - 1].startPage)
    )) return column('Search Page', pages);

    const groups = divisions.map((juz, index) => {
      const group = document.createElement('section');
      const heading = document.createElement('h3');
      heading.className = 'quran-page-group-title';
      heading.id = 'quran-page-juz-' + juz.num;
      group.setAttribute('aria-labelledby', heading.id);
      const label = 'Juz ' + juz.num;
      const name = document.createElement('span');
      name.lang = 'ar'; name.dir = 'rtl'; name.textContent = juz.title;
      heading.append(label, name);
      const grid = document.createElement('div');
      grid.className = 'quran-page-grid';
      const next = divisions[index + 1];
      const end = next ? next.startPage - 1 : pages.length;
      for (const page of pages.slice(juz.startPage - 1, end)) {
        page.navigationSearchNames = [page.textContent, label, juz.title];
        grid.append(page);
      }
      group.append(heading, grid);
      return group;
    });
    return column('Search Page', pages, groups);
  }
  function renderAyahs() {
    var old = content.querySelectorAll('.quran-navigation-column')[1]; if (old) old.remove();
    var selected = data.surahs.find(s => s.num === surah); if (!selected) return;
    var col = column('Search Ayah', Array.from({length: selected.ayahs}, (_, i) => link(String(i + 1), href(surah + ':' + (i + 1)), currentRef === surah + ':' + (i + 1))));
    col.classList.add('quran-navigation-ayahs'); content.append(col); centerCurrent();
  }
  tabs.forEach((button, index) => {
    button.addEventListener('click', () => { tab = button.dataset.navigationTab; render(); });
    button.addEventListener('keydown', event => {
      var next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); tabs[next].click(); tabs[next].focus(); }
    });
  });
  rail.addEventListener('show.bs.offcanvas', function (event) {
    var trigger = event.relatedTarget;
    context(trigger);
    tab = trigger && ['page', 'juz'].includes(trigger.dataset.navigationOpenTab) ? trigger.dataset.navigationOpenTab : 'surah';
    if (trigger && trigger.dataset.navigationOpenTab) {
      if (trigger.dataset.navigationPage) currentPage = Number(trigger.dataset.navigationPage);
      if (trigger.dataset.navigationJuz) currentJuz = Number(trigger.dataset.navigationJuz);
      if (trigger.dataset.navigationSurah) {
        surah = Number(trigger.dataset.navigationSurah);
        if (Number(currentRef.split(':')[0]) !== surah) currentRef = surah + ':1';
      }
    }
    if (data) return render();
    if (loading) return;
    status.textContent = 'Loading Quran navigation…';
    loading = fetch(rail.dataset.navigationUrl, {headers: {'Accept':'application/json'}})
      .then(response => { if (!response.ok) throw new Error('Navigation unavailable'); return response.json(); })
      .then(result => { data = result; status.textContent = ''; render(); })
      .catch(() => {
        status.textContent = 'Could not load navigation. ';
        var retry = document.createElement('button'); retry.className = 'ux-text-action'; retry.textContent = 'Retry';
        retry.addEventListener('click', () => rail.dispatchEvent(new Event('show.bs.offcanvas'))); status.append(retry);
      }).finally(() => { loading = null; });
  });
  rail.addEventListener('shown.bs.offcanvas', centerCurrent);
  window.addEventListener('resize', function () { if (rail.classList.contains('show')) centerCurrent(); });
}());
