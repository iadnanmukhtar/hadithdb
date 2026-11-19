const byId = id => document.getElementById(id);
const make = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
const screenPath = (page, size) => 'screens/' + page.key + '-' + size + '.jpg';

function imageCard(page, size, compact = false) {
  const button = make('button');
  button.className = 'shot';
  button.type = 'button';
  const image = make('img');
  image.src = screenPath(page, size);
  image.alt = '';
  image.loading = 'lazy';
  const label = make('span', page.name);
  label.append(make('small', compact ? page.path : page.path + (page.status >= 400 ? ' · HTTP ' + page.status : '')));
  button.append(image, label);
  button.addEventListener('click', () => {
    const dialog = byId('zoom');
    dialog.querySelector('h3').textContent = page.name;
    const full = dialog.querySelector('img');
    full.src = image.src;
    full.alt = page.name + ' at ' + (size === 'small' ? '390' : '1360') + ' pixels wide';
    dialog.querySelector('p').textContent = page.path + (page.final !== page.path ? ' → ' + page.final : '') + ' · ' + page.title;
    dialog.showModal();
  });
  return button;
}

function selectPattern(index) {
  const pattern = patterns[index];
  for (const [i, button] of [...byId('patterns-list').children].entries()) {
    button.setAttribute('aria-pressed', String(index === i));
  }
  const detail = byId('detail');
  const title = make('h3', pattern.name);
  title.className = 'spec-title';
  const demo = make('div');
  demo.className = 'demo';
  demo.innerHTML = '<div class="eyebrow">Proposed specimen</div><div class="sample">' + pattern.sample + '</div>';
  const modeControls = [...demo.querySelectorAll('[data-mode]')];
  if (modeControls.length) {
    const context = demo.querySelector('.mode-context');
    function changeMode(mode) {
      for (const button of modeControls) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
      if (mode === 'tafsir') {
        context.innerHTML = '<label>Commentary<select><option>al-Tafsir al-Mukhtasar</option><option>Tafsir Ibn Kathir</option></select></label>';
      } else {
        context.textContent = mode === 'mushaf' ? 'Mushaf page 42 · Selected ayah 2:255' : 'Selected passage · Al-Baqarah 2:255';
      }
    }
    for (const button of modeControls) button.addEventListener('click', () => changeMode(button.dataset.mode));
    changeMode('tafsir');
  }
  for (const button of demo.querySelectorAll('[data-toggle]')) {
    const initial = button.textContent;
    button.addEventListener('click', () => {
      const active = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(active));
      button.textContent = active ? button.dataset.toggle : initial;
    });
  }
  const notes = make('dl');
  for (const [name, value] of [['Observed',pattern.observed],['Standard',pattern.standard],['Verify',pattern.check]]) {
    notes.append(make('dt',name),make('dd',value));
  }
  const source = make('a', pattern.source.split('/').pop() + '.ejs');
  source.href = '../../views/sub-views/' + pattern.source + '.ejs';
  const definition = make('dd');
  definition.append(source);
  notes.append(make('dt','Template'),definition);
  const comparison = make('div');
  comparison.className = 'evidence';
  for (const key of pattern.evidence) comparison.append(imageCard(pages.find(page => page.key === key), byId('viewport').value, true));
  detail.replaceChildren(title,demo,notes,comparison);
}
let selected = 0;
patterns.forEach((pattern,index) => {
  const button = make('button',pattern.name);
  button.addEventListener('click', () => { selected = index; selectPattern(index); });
  byId('patterns-list').append(button);
});
for (const name of new Set(pages.map(page => page.group))) byId('family').append(make('option',name));
function renderGallery() {
  const family = byId('family').value;
  const size = byId('viewport').value;
  const query = byId('query').value.trim().toLowerCase();
  const filtered = pages.filter(page =>
    (family === 'All families' || page.group === family) &&
    [page.name,page.path,page.title,page.final,page.group].join(' ').toLowerCase().includes(query)
  );
  byId('count').textContent = filtered.length + ' of ' + pages.length + ' captures';
  byId('gallery').className = size === 'small' ? 'mobile' : '';
  byId('gallery').replaceChildren(...filtered.map(page => imageCard(page,size)));
  if (!filtered.length) byId('gallery').append(make('p','No matching captures. Clear the search or choose another family.'));
}
byId('query').addEventListener('input',renderGallery);
byId('family').addEventListener('change',renderGallery);
byId('viewport').addEventListener('change',() => {renderGallery(); selectPattern(selected);});
byId('zoom').addEventListener('click',event => {if(event.target === byId('zoom')) byId('zoom').close();});
selectPattern(selected);
renderGallery();
