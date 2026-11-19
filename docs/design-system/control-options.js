const treatments = [
  ['inset-mode', 'Inset selector + text action', 'A white selected segment sits on a quiet track. “Enable all” reads as a lightweight action beside it.'],
  ['tab-mode', 'Underline tabs + tinted button', 'An underline marks the active view. A soft blue fill makes the bulk action easier to spot.'],
  ['select-mode', 'View menu + outlined button', 'A compact menu shows the current view. A thin border gives the bulk action a clear target.']
];

for (const [style, title, description] of treatments) {
  const demo = document.querySelector('#control-demo').content.firstElementChild.cloneNode(true);
  demo.className = style;
  demo.querySelector('h3').textContent = title;
  demo.querySelector('.rationale').textContent = description;
  const bulk = demo.querySelector('.bulk');
  const switches = [...demo.querySelectorAll('[role="switch"]')];
  const mode = demo.querySelector('.mode');
  if (style === 'inset-mode') {
    bulk.classList.add('ux-text-action');
    mode.classList.add('ux-view-selector');
    mode.querySelectorAll('button').forEach(button => button.classList.add('ux-view-option'));
  }
  function setView(value) {
    demo.querySelector('.reciters').classList.toggle('full', value === 'full');
    for (const button of mode.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(value === button.dataset.mode));
    }
  }
  if (style === 'select-mode') {
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Reciter view');
    select.add(new Option('Tile view', 'tile'));
    select.add(new Option('Full view', 'full'));
    select.addEventListener('change', () => setView(select.value));
    mode.replaceChildren(select);
  } else {
    for (const button of mode.querySelectorAll('button')) {
      button.addEventListener('click', () => setView(button.dataset.mode));
    }
  }
  function updateCount() {
    const enabled = switches.filter(input => input.checked).length;
    bulk.disabled = enabled === switches.length;
    demo.querySelector('[role="status"]').textContent = enabled + ' of ' + switches.length + ' enabled';
  }
  bulk.addEventListener('click', () => {
    switches.forEach(input => { input.checked = true; });
    updateCount();
  });
  switches.forEach(input => input.addEventListener('change', updateCount));
  updateCount();
  document.querySelector('#control-demos').append(demo);
}
