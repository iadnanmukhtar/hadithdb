'use strict';

window.pickSharhBook = function ({ apiPath }) {
  const root = document.getElementById('sharh-add-modal');
  if (root.dataset.picking === 'true') return Promise.resolve(null);
  root.dataset.picking = 'true';
  const form = root.querySelector('form');
  const mode = root.querySelector('#sharh-add-mode');
  const search = root.querySelector('#sharh-add-search');
  const books = root.querySelector('#sharh-add-book');
  const ar = root.querySelector('#sharh-add-ar');
  const en = root.querySelector('#sharh-add-en');
  const submit = root.querySelector('[data-sharh-submit]');
  const status = root.querySelector('[data-sharh-status]');
  const modal = bootstrap.Modal.getOrCreateInstance(root);
  let result = null, sequence = 0, timer;
  form.reset();
  books.replaceChildren();
  const validate = () => {
    submit.disabled = mode.value === 'new' ? !ar.value.trim() : !books.value;
  };
  const load = async () => {
    const request = ++sequence;
    books.replaceChildren();
    validate();
    status.textContent = 'Loading books…';
    try {
      const token = window.hadithAuth && window.hadithAuth.getToken ? await window.hadithAuth.getToken() : null;
      const params = new URLSearchParams({ q: search.value.trim(), limit: '50' });
      const response = await fetch(`${apiPath('/autocomplete/sharh-titles')}?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!response.ok) throw new Error('Search failed');
      const rows = await response.json();
      if (request !== sequence) return;
      rows.forEach(book => {
        const option = new Option([book.title_en, book.title].filter(Boolean).join(' — '), String(book.book_id));
        option.dataset.title = book.title || '';
        option.dataset.titleEn = book.title_en || '';
        books.add(option);
      });
      books.selectedIndex = -1;
      status.textContent = rows.length ? 'Select a book. Search to narrow the results.' : 'No books found. Try another search or create a new book.';
      validate();
    } catch (_error) {
      if (request === sequence) status.textContent = 'Unable to load books. Type a search to try again.';
    }
  };
  const switchMode = () => {
    const isNew = mode.value === 'new';
    root.querySelector('[data-sharh-existing]').hidden = isNew;
    root.querySelector('[data-sharh-new]').hidden = !isNew;
    books.disabled = search.disabled = isNew;
    ar.disabled = en.disabled = !isNew;
    submit.textContent = isNew ? 'Create book and add explanation' : 'Add explanation';
    validate();
  };
  return new Promise(resolve => {
    mode.onchange = switchMode;
    ar.oninput = books.onchange = validate;
    search.oninput = () => {
      ++sequence;
      books.replaceChildren();
      validate();
      clearTimeout(timer);
      timer = setTimeout(load, 180);
    };
    form.onsubmit = event => {
      event.preventDefault();
      validate();
      if (submit.disabled || !form.reportValidity()) return;
      const selected = books.selectedOptions[0];
      result = mode.value === 'new'
        ? { bookId: '', title: ar.value.trim(), title_en: en.value.trim() }
        : { bookId: selected.value, title: selected.dataset.title, title_en: selected.dataset.titleEn };
      modal.hide();
    };
    root.addEventListener('shown.bs.modal', () => search.focus(), { once: true });
    root.addEventListener('hidden.bs.modal', () => {
      ++sequence;
      clearTimeout(timer);
      delete root.dataset.picking;
      resolve(result);
    }, { once: true });
    switchMode();
    modal.show();
    load();
  });
};
