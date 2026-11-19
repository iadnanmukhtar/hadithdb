(() => {
  const input = document.getElementById('settings-filter');
  const groups = document.getElementById('settings-groups');
  const clear = document.querySelector('[data-settings-filter-clear]');
  const status = document.querySelector('[data-settings-filter-status]');
  const entries = [...groups.querySelectorAll('.settings-beta-group')].map(group => {
    const heading = group.querySelector('h2');
    return { group, heading, link: document.querySelector(`.settings-beta-index a[href="#${heading.id}"]`), rows: group.querySelectorAll('.settings-beta-row') };
  });
  const catalogs = '[data-tafsir-setting-row], [data-translation-setting-row], .reciter-setting-row';
  const normalize = text => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const keywords = {
    audio: 'audio recitation playback',
    script: 'mushaf font typeface',
    theme: 'notebook color colour background',
    session: 'memorize memorise hifz spaced repetition',
    drive: 'backup storage sync',
    email: 'mail alerts subscriptions'
  };
  const original = new Map();
  function expand(element) {
    if (!original.has(element)) {
      original.set(element, element.matches('details') ? element.open : element.classList.contains('show'));
    }
    setExpanded(element, true);
  }
  function setExpanded(element, open) {
    if (element.matches('details')) {
      element.open = open;
    } else {
      element.classList.toggle('show', open);
      document.getElementById(element.id)?.parentElement.querySelector('[aria-controls]')?.setAttribute('aria-expanded', String(open));
    }
  }
  function filter() {
    const query = normalize(input.value);
    const terms = query.split(' ').filter(Boolean);
    const matches = text => terms.every(term => text.includes(term));
    for (const [element, open] of original) setExpanded(element, open);
    original.clear();
    let count = 0;
    for (const { group, heading, link, rows } of entries) {
      let groupCount = 0;
      for (const row of rows) {
        const summary = row.querySelector('summary');
        const key = summary.querySelector('[data-setting-summary]').dataset.settingSummary;
        const headingText = normalize([heading.textContent, summary.querySelector('strong').textContent, keywords[key] || ''].join(' '));
        const matchesHeading = matches(headingText);
        const items = [...row.querySelectorAll(catalogs)];
        const itemHits = items.filter(item => !matchesHeading && matches(headingText + ' ' + normalize(item.textContent)));
        for (const item of items) item.classList.toggle('settings-filter-miss', itemHits.length > 0 && !itemHits.includes(item));
        const found = matchesHeading || matches(headingText + ' ' + normalize(row.textContent));
        row.hidden = !found;
        if (!found) continue;
        groupCount++;
        if (query && (!matchesHeading || itemHits.length)) {
          expand(row);
          for (const details of row.querySelectorAll('details')) {
            if (matches(headingText + ' ' + normalize(details.textContent))) expand(details);
          }
          for (const area of row.querySelectorAll('.collapse')) {
            if (itemHits.some(item => area.contains(item))) expand(area);
          }
        }
      }
      group.hidden = link.hidden = groupCount === 0;
      count += groupCount;
    }
    clear.hidden = !input.value;
    const message = !input.value.trim() ? '' : count ? `${count} matching setting${count === 1 ? '' : 's'}` : 'No matching settings. Try a different search.';
    if (status.textContent !== message) status.textContent = message;
  }
  function reset() {
    input.value = '';
    filter();
    input.focus();
  }
  input.addEventListener('input', filter);
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape' && input.value) {
      event.preventDefault();
      reset();
    }
  });
  clear.addEventListener('click', reset);
  // Catalogs and saved summaries can arrive after the reader starts typing.
  new MutationObserver(() => { if (input.value.trim()) filter(); })
    .observe(groups, { childList: true, subtree: true, characterData: true });
})();
