(() => {
  const shelf = document.querySelector('[data-library-shelf]');
  if (!shelf) return;
  const tabs = shelf.querySelector('.library-shelf-tabs');
  const buttons = [...tabs.querySelectorAll('button')];
  const books = [...shelf.querySelectorAll('[data-book-group]')];
  const field = shelf.querySelector('input[type="search"]');
  const normalize = window.normalizeContentFilterText;
  const featured = books.filter(book => book.dataset.bookGroup === 'six')
    .sort((a, b) => Number(a.dataset.shelfOrder) - Number(b.dataset.shelfOrder));
  const searchable = books.map(book => normalize(book.dataset.search));
  let selected = buttons[0].dataset.shelfView;

  function render() {
    const term = normalize(field.value);
    const view = term ? 'all' : selected;
    if (shelf.dataset.view !== view) {
      const directory = shelf.querySelector('.library-volumes');
      if (view === 'six') directory.prepend(...featured);
      else directory.append(...books);
      shelf.dataset.view = view;
    }
    let count = 0;
    books.forEach((book, i) => {
      book.hidden = (view !== 'all' && book.dataset.bookGroup !== view) || !searchable[i].includes(term);
      if (!book.hidden) count++;
    });
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.shelfView === view)));
    shelf.querySelector('.library-empty').hidden = count !== 0;
    shelf.querySelector('[data-shelf-status]').textContent = count + (count === 1 ? ' book' : ' books');
  }
  for (const button of buttons) button.addEventListener('click', () => {
    selected = button.dataset.shelfView;
    field.value = '';
    render();
  });
  field.addEventListener('input', render);
  render();
  tabs.hidden = false;
  shelf.querySelector('.library-shelf-tools').hidden = false;
})();
