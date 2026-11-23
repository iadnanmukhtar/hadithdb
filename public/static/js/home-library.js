(() => {
  const shelf = document.querySelector('[data-library-shelf]');
  if (!shelf) return;
  const tabs = shelf.querySelector('.library-shelf-tabs');
  const buttons = [...tabs.querySelectorAll('button')];
  const books = [...shelf.querySelectorAll('.library-volume')];
  const field = shelf.querySelector('input[type="search"]');
  const normalize = window.normalizeContentFilterText;
  const byAlias = new Map(books.map(book => [book.dataset.alias, book]));
  const collections = new Map(buttons.map(button => [
    button.dataset.shelfView, new Set(button.dataset.titles.split(' ').map(alias => byAlias.get(alias)))
  ]));
  const searchable = books.map(book => normalize(book.dataset.search));
  let selected = buttons[0]?.dataset.shelfView || 'all';

  function render() {
    const term = normalize(field.value);
    const view = term ? 'all' : selected;
    const volumes = collections.get(view);
    if (shelf.dataset.view !== view) {
      const directory = shelf.querySelector('.library-volumes');
      if (volumes) directory.prepend(...volumes);
      else directory.append(...books);
      shelf.dataset.layout = ['beginner', 'twelve'].includes(view) ? 'covers' : 'directory';
      shelf.dataset.view = view;
    }
    let count = 0;
    books.forEach((book, i) => {
      book.hidden = (volumes && !volumes.has(book)) || !searchable[i].includes(term);
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
