// Organize by user intent so implementations with different selectors appear together.
const controlGroups = {
  'Reading and study': ['Bookmark', 'Playback', 'Practice controls', 'Notes', 'Source pickers', 'Book details', 'Text display', 'Reading text', 'References'],
  'Community and feedback': ['Share', 'Like', 'Reflections', 'Follow', 'Author identity', 'Status and counts'],
  'Navigation and discovery': ['Search fields', 'Filters', 'Mode switches', 'Content navigation', 'Previous and next', 'Disclosures', 'Dropdowns and dialogs', 'Overflow menus'],
  'Actions and editing': ['Primary actions', 'Secondary actions', 'Close and dismiss', 'Form fields', 'Formatting', 'Draft actions'],
  'Composite components': ['Toolbars', 'Cards and previews', 'Text and metadata']
};

const reviewNotes = {
  Bookmark: 'The same outline bookmark has different element sizes on reports, tafsir passages and Mushaf pages. Standardize its target and keep the saved item type in its label.',
  Share: 'Compare both the glyph and its name. The hadith report supplies its title where the ayah and Community controls identify the Share action. Keep the content title in the share payload and name the control for the action.',
  Playback: 'The play triangle recurs at three scopes. Keep the visual size predictable and retain the scope in the label so readers know whether they will hear an ayah, a subsection or a page.',
  Reflections: 'The count appears on a link, a dialog button and a disclosure. Keep the chat icon and count recognizable, and name the action according to what opens.',
  Like: 'The feed includes a reaction count rendered as a span. The reader uses a button. Give an interactive reaction an identifiable pressed state and distinguish a read-only count.',
  Follow: 'Compare the light outline on the image cover with the contributor rail on white. A shared Follow control needs a foreground and border variant for each surface.',
  'Search fields': 'Compare the catalog’s short filter, the results sidebar and the full-width notebook field. Keep local filtering distinguishable from opening a site-wide search.',
  'Book details': 'The catalog uses a compact icon button. Readers expose a work title as the target. Both need to identify which work the details describe.',
  'Mode switches': 'Compare how the current choice is marked in the reader, the catalog, Community and Settings. Preserve the difference between navigating to another page and changing a local view.',
  Notes: 'Adding a note on an existing item, creating a standalone note and inserting a saved note are separate operations. The label should identify the destination.',
  Disclosures: 'Compare the small settings toggle with a full-width thread summary. Give the whole labeled row a coherent activation area and expose its expanded state.',
  'Primary actions': 'Publish commits content, the feed prompt opens an editor and the MCP link navigates. Reserve prominent styling for the primary task in each context.',
  'Previous and next': 'A chevron can move one ayah, one surah or one entry. Include the unit in the control name and retain it when the visible label collapses.',
  Toolbars: 'Compare action order, spacing and grouping before standardizing individual icons. Formatting changes the selection, while a reader toolbar acts on a passage.',
  'Cards and previews': 'Compare the title destination, image, metadata and secondary actions. Keep the shared card structure while allowing fields to vary by content type.'
};

const routeIndex = new Map(pages.map(page => [page.key,page]));
const controlFamily = byId('audit-family');
const controlSearch = byId('audit-search');
const familyNames = new Set(controls.map(control => control.family));
for (const [category,families] of Object.entries(controlGroups)) {
  const group = document.createElement('optgroup');
  group.label = category;
  for (const family of families.filter(name => familyNames.has(name))) group.append(new Option(family,family));
  controlFamily.append(group);
}
const initialFamily = new URLSearchParams(location.search).get('control');
controlFamily.value = familyNames.has(initialFamily) ? initialFamily : 'Bookmark';

function displayCapture(title, path, caption) {
  const dialog = byId('zoom');
  dialog.querySelector('h3').textContent = title;
  const image = dialog.querySelector('img');
  image.src = path;
  image.alt = title;
  dialog.querySelector('p').textContent = caption;
  dialog.showModal();
}

function controlCard(control, size) {
  const page = routeIndex.get(control.page);
  const capture = control[size];
  const file = 'controls/' + control.id + '-' + size + '.png';
  const card = make('article');
  card.className = 'control-card';
  const crop = make('button');
  crop.type = 'button';
  crop.className = 'control-crop';
  crop.setAttribute('aria-label','Inspect ' + control.variant + ' on ' + page.name);
  const image = make('img');
  image.src = file;
  image.alt = '';
  image.loading = 'lazy';
  crop.append(image);
  const dimensions = capture.width + ' × ' + capture.height + ' px';
  crop.addEventListener('click',() => displayCapture(control.variant,file,page.name + ' · ' + page.path + ' · ' + dimensions));
  const contents = make('div');
  contents.className = 'control-caption';
  const title = make('h4',control.variant);
  const context = make('button',page.name);
  context.type = 'button';
  context.className = 'context-link';
  context.title = 'View page capture for ' + page.path;
  context.addEventListener('click',() => displayCapture(page.name,screenPath(page,size === 'phone' ? 'small' : 'wide'),page.path));
  const metrics = make('p',dimensions + '  ·  ' + capture.tag + (capture.state ? '  ·  ' + capture.state : ''));
  metrics.className = 'control-metrics';
  const implementation = make('details');
  implementation.append(make('summary','Inspect element'),make('code',control.selector),make('p','Route · ' + page.path));
  if (capture.label) implementation.append(make('p','Label or text · ' + capture.label));
  implementation.append(make('p','Font · ' + capture.font + ' / Corner radius · ' + capture.radius));
  if (control.sources?.length) {
    const links = make('p','Template matches · ');
    for (const [index,path] of control.sources.entries()) {
      if (index) links.append(' · ');
      const link = make('a',path.split('/').pop());
      link.href = '../../views/' + path;
      links.append(link);
    }
    implementation.append(links);
  }
  contents.append(title,context,metrics,implementation);
  card.append(crop,contents);
  return card;
}

function renderControls() {
  const size = document.querySelector('input[name="audit-size"]:checked').value;
  const query = controlSearch.value.trim().toLowerCase();
  const result = byId('audit-results');
  result.replaceChildren();
  const records = controls.filter(control => {
    const page = routeIndex.get(control.page);
    return control[size] && (!controlFamily.value || control.family === controlFamily.value)
      && [control.family,control.variant,page.name,page.path,control.selector,control[size].label].join(' ').toLowerCase().includes(query);
  });
  byId('audit-count').textContent = records.length + ' examples · ' + (size === 'desktop' ? '1360 × 900 viewport' : '390 × 844 viewport');
  if (!records.length) result.append(make('p','No matching controls at this viewport.'));
  for (const family of Object.values(controlGroups).flat()) {
    const items = records.filter(item => item.family === family);
    if (!items.length) continue;
    const heading = make('h3',family);
    const group = make('div');
    group.className = 'control-family';
    group.append(heading);
    if (reviewNotes[family]) group.append(make('p',reviewNotes[family]));
    const grid = make('div');
    grid.className = 'control-grid';
    grid.append(...items.map(item => controlCard(item,size)));
    group.append(grid);
    result.append(group);
  }
}
for (const shortcut of document.querySelectorAll('[data-compare]')) {
  shortcut.addEventListener('click',() => {
    controlFamily.value = shortcut.dataset.compare;
    controlSearch.value = '';
    renderControls();
  });
}
controlFamily.addEventListener('change',() => { controlSearch.value = ''; renderControls(); });
controlSearch.addEventListener('input',() => { if (controlSearch.value.trim()) controlFamily.value = ''; renderControls(); });
for (const radio of document.querySelectorAll('[name="audit-size"]')) radio.addEventListener('change',renderControls);
const captureCount = controls.reduce((n,c) => n + Number(Boolean(c.desktop)) + Number(Boolean(c.phone)),0);
byId('audit-scope').textContent = controls.length + ' component examples across ' + familyNames.size + ' control families, with ' + captureCount + ' rendered crops. Repeated records and identical routes are sampled. Some controls appear at only one width.';
renderControls();
