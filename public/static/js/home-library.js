(() => {
  document.querySelectorAll('[data-library-shelf]').forEach(initializeShelf);

  const filter = document.getElementById('quran-library-filter');
  if (filter) {
    const results = document.getElementById('quran-library-results');
    const panels = document.getElementById('quran-library-panels');
    const tabs = filter.closest('header').querySelector('[role="tablist"]');
    const books = Array.from(results.querySelectorAll('.library-volume'), link => ({
      link, text: window.normalizeContentFilterText(link.dataset.search)
    }));
    function filterBooks() {
      const term = window.normalizeContentFilterText(filter.value);
      panels.hidden = Boolean(term);
      results.hidden = !term;
      let count = 0;
      for (const {link, text} of books) {
        link.hidden = !text.includes(term);
        if (!link.hidden) count++;
      }
      results.querySelector('.library-empty').hidden = count > 0;
    }
    filter.addEventListener('input', filterBooks);
    function restoreTabs() {
      filter.value = '';
      filterBooks();
    }
    tabs.addEventListener('click', restoreTabs);
    tabs.addEventListener('shown.bs.tab', restoreTabs);
    filter.closest('.library-shelf-tools').hidden = false;
    filterBooks();
  }

  function initializeShelf(shelf) {
    const directory = shelf.querySelector('.library-volumes');
    const controls = shelf.querySelector('.library-deck-controls');
    const [previous, next] = controls.querySelectorAll('button');
    const status = controls.querySelector('[role="status"]');
    let deck = [];
    let current = -1;

    function selectBook(index) {
      if (index === current) return;
      current = index;
      deck.forEach((book, i) => {
        book.dataset.position = i < index ? 'before' : i > index ? 'after' : 'center';
        book.tabIndex = i === index ? 0 : -1;
      });
      previous.disabled = index === 0;
      next.disabled = index === deck.length - 1;
      status.textContent = (index + 1) + ' / ' + deck.length;
      status.setAttribute('aria-label', deck[index].querySelector('.volume-name').textContent.trim() + ', book ' + (index + 1) + ' of ' + deck.length);
    }

    function centerBook(index) {
      if (index < 0 || index >= deck.length) return;
      const book = deck[index];
      directory.scrollLeft = book.offsetLeft + (book.offsetWidth - directory.clientWidth) / 2;
      selectBook(index);
    }

    function configureDeck(volumes) {
      const enabled = shelf.dataset.layout === 'covers';
      shelf.toggleAttribute('data-deck', enabled);
      controls.hidden = !enabled;
      deck = enabled ? [...volumes] : [];
      current = -1;
      for (const book of directory.querySelectorAll('.library-volume')) {
        delete book.dataset.position;
        book.removeAttribute('tabindex');
      }
      if (enabled) centerBook(0);
      else directory.scrollLeft = 0;
    }

    directory.addEventListener('scroll', () => {
      // A hidden shelf has no usable geometry for picking its nearest cover.
      if (!deck.length || !directory.clientWidth) return;
      const center = directory.scrollLeft + directory.clientWidth / 2;
      const distance = book => Math.abs(book.offsetLeft + book.offsetWidth / 2 - center);
      selectBook(deck.reduce((nearest, book, i) => distance(book) < distance(deck[nearest]) ? i : nearest, 0));
    }, { passive: true });
    previous.addEventListener('click', () => centerBook(current - 1));
    next.addEventListener('click', () => centerBook(current + 1));
    directory.addEventListener('click', event => {
      const index = deck.indexOf(event.target.closest('.library-volume'));
      if (index < 0 || index === current || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      centerBook(index);
      deck[index].focus({ preventScroll: true });
    });
    directory.addEventListener('keydown', event => {
      if (!deck.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const destinations = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: deck.length - 1 };
      centerBook(destinations[event.key]);
      deck[current].focus({ preventScroll: true });
    });

    if (shelf.dataset.layout === 'covers') {
      configureDeck(directory.querySelectorAll('.library-volume'));
      return;
    }
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
      const changed = shelf.dataset.view !== view;
      if (changed) {
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
      if (changed) configureDeck(volumes);
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
  }
})();
