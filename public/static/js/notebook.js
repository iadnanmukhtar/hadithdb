/* global bootstrap, quranApiPath */
(() => {
  'use strict';
  const modal = document.getElementById('notebook-modal');
  if (!modal || modal.dataset.initialized) return;
  modal.dataset.initialized = '1';
  const editor = document.getElementById('notebook-editor');
  const tagEditor = document.getElementById('notebook-tag-editor');
  const titleEditor = document.getElementById('notebook-title-editor');
  let savedTitle = '';
  let titleEditing = false, tagsEditing = false;
  let savedTags = '', railTags = [], tagRequest = 0;
  const status = document.getElementById('notebook-status');
  const preview = document.getElementById('notebook-preview');
  const toggle = document.getElementById('notebook-preview-button');
  const fullscreen = document.getElementById('notebook-fullscreen');
  fullscreen.addEventListener('click', () => {
    const expanded = modal.querySelector('.modal-dialog').classList.toggle('modal-fullscreen');
    const label = expanded ? 'Restore note size' : 'Expand note';
    fullscreen.title = label;
    fullscreen.setAttribute('aria-label', label);
    fullscreen.setAttribute('aria-pressed', String(expanded));
    fullscreen.firstElementChild.className = expanded ? 'bi bi-fullscreen-exit' : 'bi bi-arrows-fullscreen';
    bootstrap.Modal.getInstance(modal)?.handleUpdate();
  });
  const saveButton = document.getElementById('notebook-save');
  const deleteButton = document.getElementById('notebook-delete');
  const downloadButton = document.getElementById('notebook-download');
  const printButton = document.getElementById('notebook-print');
  printButton.addEventListener('click', printNote);
  async function printNote() {
    if (!current || busy || printButton.disabled) return;
    const ownGeneration = generation;
    const note = { ...current, markdown: editor.value, tags: tagEditor.value, title: titleEditor.value };
    printButton.disabled = true;
    try {
      await window.NotebookPrint.open(note, () => api('/preview', 'POST', { markdown: note.markdown }), () => ownGeneration === generation);
    } catch (err) { if (ownGeneration === generation) status.textContent = err.message; }
    finally { if (ownGeneration === generation) printButton.disabled = busy; }
  }
  const downloadAll = document.getElementById('notebook-download-all');
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  downloadButton.addEventListener('click', async () => {
    if (!current || busy) return;
    const ownGeneration = generation;
    const note = { ...current, markdown: editor.value, tags: tagEditor.value, title: titleEditor.value };
    const title = (note.title || note.source_title).replace(/[^\p{L}\p{N} _-]/gu, '-').slice(0, 80).trim() || 'Note';
    const identity = note.source_key.replace(/:/g, '-');
    downloadButton.disabled = true;
    try {
      const result = await api('/download', 'POST', note);
      if (ownGeneration !== generation) return;
      downloadBlob(new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' }), `${title} (${identity}).md`);
      if (editing) showPreview();
    } catch (err) { if (ownGeneration === generation) status.textContent = err.message; }
    finally { if (ownGeneration === generation) downloadButton.disabled = busy; }
  });
  downloadAll?.addEventListener('click', async () => {
    const ownGeneration = generation;
    downloadAll.disabled = true;
    try {
      const token = await window.hadithAuth?.getToken();
      if (!token) throw new Error('Please sign in to download your notebook.');
      const response = await fetch(quranApiPath('/notebook/download'), { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not download notebook.');
      const blob = await response.blob();
      if (ownGeneration !== generation) return;
      downloadBlob(blob, 'My Notebook.zip');
      renderList();
    } catch (err) { if (ownGeneration === generation) listStatus.textContent = err.message; }
    finally { if (ownGeneration === generation) downloadAll.disabled = false; }
  });
  const mobileFilters = document.getElementById('notebook-mobile-filter-panel');
  const tagRail = document.querySelector('.notebook-tag-rail');
  const tagRailSlot = document.querySelector('.notebook-tag-rail-slot');
  if (mobileFilters && tagRail && tagRailSlot) {
    const desktop = window.matchMedia('(min-width: 992px)');
    function positionTagFilters() {
      // Move the same controls so selected tags, search text and listeners survive resizing.
      (desktop.matches ? tagRailSlot : mobileFilters).appendChild(tagRail);
      if (desktop.matches && mobileFilters.classList.contains('show'))
        bootstrap.Collapse.getOrCreateInstance(mobileFilters, { toggle: false }).hide();
      if (typeof window.updateFixedHeaderOffset === 'function') window.updateFixedHeaderOffset();
    }
    desktop.addEventListener('change', positionTagFilters);
    positionTagFilters();
  }
  const list = document.getElementById('notebook-list');
  const listStatus = document.getElementById('notebook-list-status');
  const more = document.getElementById('notebook-more');
  const sentinel = document.getElementById('notebook-sentinel');
  let listSignedIn = false;
  let listLoading = false, hasMore = false, listFailed = false;
  let current = null, pendingSource = null, savedText = '', busy = false, generation = 0, notes = [], listRequest = 0, returnModal = null;
  let editing = false, saving = null, saveTimer, previewRequest = 0, statusTimer, statusEpoch = 0;
  const existing = new Set(), checked = new Set(), buttons = new Map();
  const installed = new WeakSet();
  const sourceSelector = '.hadith-bookmark-btn, .heading-bookmark-btn, .tafsir-bookmark-btn, [data-note-key]';
  async function api(path = '', method = 'GET', body) {
    const token = await window.hadithAuth?.getToken();
    if (!token) throw new Error('Please sign in to use your notebook.');
    const response = await fetch(quranApiPath('/notebook' + path), {
      method, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const result = await response.json();
    if (!response.ok) {
      if (result.code?.startsWith('DRIVE_')) window.notebookDrive?.required(result.code);
      throw new Error(result.error || 'Could not access your notebook.');
    }
    return result;
  }
  function setBusy(value) {
    busy = value;
    saveButton.disabled = deleteButton.disabled = toggle.disabled = editor.disabled = downloadButton.disabled = tagEditor.disabled = titleEditor.disabled = value;
    printButton.disabled = value;
  }
  function sourceFor(button) {
    const d = button.dataset;
    const key = d.noteKey || (d.tafsirBookmarkKey ? `tafsir:${d.tafsirBookmarkKey}` : d.headingId ? `heading:${d.headingId}` : `item:${d.hadithId}`);
    return { source_key: key, source_title: d.noteTitle || d.bookmarkRef || d.bookmarkTitle || d.bookmarkTitleAr || key,
      source_url: d.noteUrl || d.bookmarkUrl || location.pathname, markdown: '', version: 0 };
  }
  function paintButtons() {
    for (const [button, source] of buttons) {
      if (!button.isConnected) { buttons.delete(button); continue; }
      const filled = existing.has(sourceFor(source).source_key);
      const icon = filled ? 'bi bi-sticky-fill' : 'bi bi-sticky';
      if (button.firstElementChild.className !== icon) button.firstElementChild.className = icon;
      button.title = filled ? 'View note' : 'Add note';
      button.setAttribute('aria-label', button.title);
      button.dataset.hasNote = String(filled);
    }
  }
  function markSource(key, exists) {
    ++statusEpoch;
    exists ? existing.add(key) : existing.delete(key);
    checked.add(key);
    paintButtons();
    scheduleStatus();
  }
  function scheduleStatus() {
    clearTimeout(statusTimer);
    statusTimer = setTimeout(refreshStatus, 100);
  }
  async function refreshStatus() {
    const epoch = statusEpoch;
    if (!await window.hadithAuth?.getToken()) return;
    const keys = [...new Set([...buttons.values()].map(source => sourceFor(source).source_key))].filter(key => !checked.has(key));
    try {
      for (let offset = 0; offset < keys.length; offset += 200) {
        const batch = keys.slice(offset, offset + 200);
        const result = await api('/status', 'POST', { sources: batch });
        if (epoch !== statusEpoch) return;
        for (const key of batch) { checked.add(key); existing.delete(key); }
        for (const key of result.sources) existing.add(key);
      }
      paintButtons();
    } catch (_) { /* Keep the controls usable; retry on focus or sign-in. */ }
  }
  function installButtons(root = document) {
    const sources = [...(root.matches?.(sourceSelector) ? [root] : []), ...root.querySelectorAll(sourceSelector)];
    for (const source of sources) {
      if (installed.has(source) || source.classList.contains('personal-note-btn') || source.closest('.breadcrumbs, .toc, [data-toc-heading-rail], [data-quran-heading-toc], [data-hadith-heading-toc]')) continue;
      installed.add(source);
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'personal-note-btn btn btn-sm p-0 border-0 bg-transparent d-inline-flex align-items-center';
      button.innerHTML = '<span class="bi bi-sticky" aria-hidden="true"></span>';
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); open(sourceFor(source)); });
      buttons.set(button, source);
      const group = document.createElement('span');
      group.className = 'personal-note-actions' + (source.classList.contains('notebook-anchor') ? ' me-2' : '');
      source.before(group);
      group.append(source, button);
    }
    if (sources.length) { paintButtons(); scheduleStatus(); }
  }
  let ayahNoteRequest = 0;
  function prepareAyahNote(button) {
    // Ayah menus always use the outline icon; resolve the note only on click.
    button.disabled = false;
    button.firstElementChild.className = 'bi bi-sticky';
    button.title = 'Open note';
    if (button.dataset.noteBound) return;
    button.dataset.noteBound = '1';
    button.addEventListener('click', async event => {
      event.preventDefault(); event.stopPropagation();
      const ref = button.dataset.ayahNoteRef, ownGeneration = generation, request = ++ayahNoteRequest;
      const menu = button.closest('[role="menu"]');
      if (menu) menu.hidden = true;
      document.querySelectorAll('[data-quran-ayah-actions][aria-expanded="true"]').forEach(marker => marker.setAttribute('aria-expanded', 'false'));
      try {
        if (!await window.hadithAuth?.getToken()) {
          window.hadithAuth?.requireToken?.('Please sign in to take notes.');
          return;
        }
        const result = await api(`/ayah?reference=${encodeURIComponent(ref)}`);
        if (request !== ayahNoteRequest || ownGeneration !== generation || button.dataset.ayahNoteRef !== ref) return;
        open(result.source);
      } catch (_) {
        if (request === ayahNoteRequest) button.title = 'Could not load note. Click to retry.';
      }
    });
  }
  document.addEventListener('quranAyahNoteTarget', event => prepareAyahNote(event.detail.button));
  function mode(edit) {
    editing = edit;
    titleEditing = tagsEditing = false;
    wikiAutocomplete.close();
    editor.hidden = !edit; preview.hidden = edit;
    renderNoteMetadata();
    renderNoteTags();
    const label = edit ? 'Preview' : 'Edit Markdown';
    toggle.title = label; toggle.setAttribute('aria-label', label);
    toggle.innerHTML = `<i class="bi ${edit ? 'bi-pencil' : 'bi-eye'}" aria-hidden="true"></i>`;
    if (edit) editor.focus();
  }
  const floatButton = document.getElementById('notebook-float');
  const minimizeButton = document.getElementById('notebook-minimize');
  const restoreButton = document.getElementById('notebook-restore');
  const floatingStorage = 'notebook-floating-note';
  let changingPresentation = false, floatingOwner = null, restoringFloating = false, pendingFloating = false;
  function rememberFloating() {
    if (!current || !floatingOwner || !modal.classList.contains('notebook-floating')) return;
    try { sessionStorage.setItem(floatingStorage, JSON.stringify({ uid: floatingOwner, source: { source_key: current.source_key, source_title: current.source_title, source_url: current.source_url, markdown: '', version: 0 }, minimized: modal.classList.contains('notebook-minimized') })); } catch (_) {}
  }
  function minimizeFloating(minimized) {
    modal.classList.toggle('notebook-minimized', minimized);
    restoreButton.hidden = !minimized;
    if (minimized) restoreButton.focus();
    else editor.focus();
    rememberFloating();
  }
  function configureFloating(enabled) {
    modal.classList.toggle('notebook-floating', enabled);
    modal.classList.remove('notebook-minimized');
    modal.querySelector('.modal-dialog').classList.remove('modal-fullscreen');
    fullscreen.setAttribute('aria-pressed', 'false');
    fullscreen.hidden = enabled;
    fullscreen.title = 'Expand note';
    fullscreen.setAttribute('aria-label', 'Expand note');
    fullscreen.firstElementChild.className = 'bi bi-arrows-fullscreen';
    restoreButton.hidden = true;
    minimizeButton.hidden = !enabled;
    floatButton.setAttribute('aria-pressed', String(enabled));
    floatButton.firstElementChild.className = enabled ? 'bi bi-pin-fill' : 'bi bi-pin-angle';
    floatButton.title = enabled ? 'Return to dialog' : 'Float note while browsing';
    floatButton.setAttribute('aria-label', floatButton.title);
    bootstrap.Modal.getInstance(modal)?.dispose();
    new bootstrap.Modal(modal, { backdrop: !enabled, focus: !enabled });
  }
  async function setFloating(enabled) {
    if (changingPresentation) return;
    changingPresentation = true;
    const instance = bootstrap.Modal.getOrCreateInstance(modal);
    if (instance._isTransitioning) await new Promise(resolve => modal.addEventListener('shown.bs.modal', resolve, { once: true }));
    await new Promise(resolve => { modal.addEventListener('hidden.bs.modal', resolve, { once: true }); instance.hide(); });
    instance.dispose();
    configureFloating(enabled);
    const shown = new Promise(resolve => modal.addEventListener('shown.bs.modal', resolve, { once: true }));
    bootstrap.Modal.getOrCreateInstance(modal).show();
    await shown;
    changingPresentation = false;
    if (enabled) modal.removeAttribute('aria-modal');
    if (enabled) {
      floatingOwner = (await window.hadithAuth?.getUser())?.uid;
      rememberFloating();
    } else { try { sessionStorage.removeItem(floatingStorage); } catch (_) {} }
  }
  floatButton?.addEventListener('click', () => { if (!busy) setFloating(!modal.classList.contains('notebook-floating')); });
  minimizeButton?.addEventListener('click', () => minimizeFloating(true));
  restoreButton?.addEventListener('click', () => {
    if (pendingFloating) restoreFloating(true);
    else minimizeFloating(false);
  });
  async function restoreFloating(reveal = false) {
    if (restoringFloating || modal.classList.contains('show') || new URLSearchParams(location.search).has('note')) return;
    let stored;
    try { stored = JSON.parse(sessionStorage.getItem(floatingStorage)); } catch (_) { return; }
    if (!stored?.source || stored.uid !== (await window.hadithAuth?.getUser())?.uid) return;
    if (stored.minimized && !reveal) {
      pendingFloating = true;
      restoreButton.hidden = false;
      return;
    }
    restoringFloating = true;
    restoreButton.disabled = true;
    try {
      configureFloating(true);
      floatingOwner = stored.uid;
      await open(stored.source, true);
      if (current) {
        pendingFloating = false;
        minimizeFloating(false);
      }
    } finally { restoringFloating = false; restoreButton.disabled = false; }
  }
  function dirty() { return editor.value !== savedText || tagEditor.value !== savedTags || titleEditor.value !== savedTitle; }
  function resetTags() {
    titleEditor.value = savedTitle = current?.title || '';
    renderNoteMetadata();
    tagEditor.value = savedTags = (current?.tags || []).join(' ');
    renderNoteTags();
  }
  function renderNoteMetadata() {
    const title = document.getElementById('notebook-note-title');
    titleEditor.hidden = !titleEditing;
    title.textContent = titleEditor.value.trim() || 'Add a title'; title.hidden = titleEditing;
    const driveFile = document.getElementById('notebook-drive-file');
    driveFile.hidden = !current?.version || !current?.driveFileUrl;
    if (!driveFile.hidden) driveFile.href = current.driveFileUrl;
    else driveFile.removeAttribute('href');
    driveFile.querySelector('svg').setAttribute('aria-hidden', 'true');
    const dates = document.getElementById('notebook-dates');
    dates.hidden = !current?.version;
    const format = value => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'unavailable';
    dates.textContent = current?.version ? `Created: ${format(current.created_at)} · Modified: ${format(current.updated_at)}` : '';
  }
  function renderNoteTags() {
    const container = document.getElementById('notebook-note-tags');
    tagEditor.hidden = !tagsEditing;
    document.getElementById('notebook-tag-help').hidden = !tagsEditing;
    container.hidden = tagsEditing;
    container.classList.toggle('d-flex', !tagsEditing);
    container.replaceChildren();
    const tags = new Set([...(current?.hashtags || []), ...tagEditor.value.split(/\s+/u).filter(Boolean).map(tag => tag.replace(/^#/, ''))]);
    for (const tag of tags) {
      const chip = document.createElement('span'); chip.className = 'notebook-tag-chip'; chip.dir = 'auto'; chip.textContent = tag; container.append(chip);
    }
    if (!tags.size) container.textContent = 'Add tags';
  }
  function renderTagRail() {
    const container = document.getElementById('notebook-tags');
    if (!container) return;
    container.replaceChildren();
    const selected = document.getElementById('notebook-tag').value.trim().replace(/^#/, '');
    const normalizeTag = text => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    const matching = railTags.filter(entry => normalizeTag(entry.tag).includes(normalizeTag(selected)));
    for (const entry of matching) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'nav-link notebook-tag-option' + (entry.tag === selected ? ' active' : '');
      button.setAttribute('aria-pressed', String(entry.tag === selected));
      const label = document.createElement('span'); label.dir = 'auto'; label.textContent = entry.tag; button.append(label);
      if (entry.count !== null) { const count = document.createElement('span'); count.className = 'text-muted'; count.textContent = entry.count; button.append(count); }
      button.addEventListener('click', () => { document.getElementById('notebook-tag').value = entry.tag; renderTagRail(); loadList(); });
      container.append(button);
    }
  }
  async function loadTags() {
    if (!list) return;
    const request = ++tagRequest;
    try {
      if (!await window.hadithAuth?.getToken()) return;
      if (request !== tagRequest) return;
      const result = await api('/tags'); if (request === tagRequest) { railTags = result.tags; renderTagRail(); } }
    catch (_) { if (request === tagRequest) { railTags = []; renderTagRail(); } }
  }
  async function renderPreview() {
    const request = ++previewRequest, ownGeneration = generation, text = editor.value;
    if (current && text === current.markdown && current.html !== undefined) {
      preview.innerHTML = current.html;
      return;
    }
    // Avoid showing a stale preview while the new render is in flight.
    preview.textContent = text;
    try {
      const result = await api('/preview', 'POST', { markdown: text });
      if (request === previewRequest && ownGeneration === generation && editor.value === text) preview.innerHTML = result.html;
    } catch (err) { if (ownGeneration === generation) status.textContent = err.message; }
  }
  function updateList(note) {
    if (!list) return;
    const index = notes.findIndex(entry => entry.source_key === note.source_key);
    const previous = index >= 0 ? notes[index] : null;
    const normalize = text => String(text || '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/[ـʿʾ]/g, '').toLowerCase();
    const search = normalize(document.getElementById('notebook-search').value.trim());
    const tag = normalize(document.getElementById('notebook-tag').value.trim().replace(/^#/, ''));
    const matches = !!note.version
      && (!search || normalize(`${note.source_title}\n${note.title || ''}\n${note.markdown}`).includes(search))
      && (!tag || (note.hashtags || []).some(value => normalize(value) === tag));
    if (matches) {
      if (index >= 0) notes[index] = note;
      else notes.unshift(note);
    } else if (index >= 0) notes.splice(index, 1);
    const tile = Array.from(list.children).find(entry => entry.dataset.sourceKey === note.source_key);
    const showEmptyGeneral = note.source_key === 'general' && !search && !tag;
    if (matches || showEmptyGeneral) {
      const replacement = createNoteTile(note);
      if (tile) tile.replaceWith(replacement);
      else {
        const general = list.firstElementChild;
        if (note.source_key !== 'general' && general?.dataset.sourceKey === 'general') general.after(replacement);
        else list.prepend(replacement);
      }
    } else tile?.remove();
    listStatus.textContent = list.childElementCount ? '' : (search || tag ? 'No matching notes.' : 'No notes yet.');
    // Tag counts only need refreshing when membership changes, not on close.
    if (JSON.stringify(previous?.hashtags || []) !== JSON.stringify(note.hashtags || [])) loadTags();
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    if (!current || !dirty()) return;
    status.textContent = saving ? 'Saving…' : 'Unsaved changes';
    saveTimer = setTimeout(() => save(true), 1800);
  }
  async function save(background = false) {
    clearTimeout(saveTimer);
    if (saving) {
      const ok = await saving;
      return ok && !background && dirty() ? save() : ok;
    }
    if (!current || busy) return false;
    if ((dirty() || current.needsChecksum) && !titleEditor.value.trim()) { status.textContent = 'Enter a title for this note.'; return false; }
    const ownGeneration = generation;
    let succeeded = false;
    const operation = (async () => {
      try {
        while (ownGeneration === generation && (dirty() || current.needsChecksum)) {
          const text = editor.value, tags = tagEditor.value, title = titleEditor.value;
          status.textContent = 'Saving…';
          const note = (await api('', 'PUT', { ...current, markdown: text, tags, title })).note;
          if (ownGeneration !== generation) return false;
          current = note;
          savedText = text; savedTags = tags; savedTitle = title; renderNoteTags(); renderNoteMetadata();
          deleteButton.hidden = !note.version;
          markSource(note.source_key, !!note.version);
          updateList(note);
          // Keep any text typed during the request; only advance the saved revision.
          if (!editing && editor.value === text) preview.innerHTML = note.html;
          // Coalesce edits made during a slow Drive request into the next idle save.
          if (background) break;
        }
        succeeded = ownGeneration === generation;
        if (succeeded) status.textContent = dirty() ? 'Unsaved changes' : '';
        return ownGeneration === generation;
      } catch (err) {
        if (ownGeneration === generation) status.textContent = err.message;
        return false;
      }
    })();
    saving = operation;
    try { return await operation; } finally {
      if (saving === operation) saving = null;
      if (succeeded) {
        if (dirty()) scheduleSave();
      }
    }
  }
  function showPreview() {
    if (!editing || busy) return;
    mode(false);
    renderPreview();
    scheduleSave();
  }
  function saveAndPreview() {
    if (!current || busy) return;
    showPreview();
    return save();
  }
  function importReflection(source) {
    const text = source.reflectionMarkdown?.trim();
    if (!text) return;
    if (!editor.value.includes(text)) editor.value = [editor.value.trimEnd(), text].filter(Boolean).join('\n\n');
    if (!titleEditor.value.trim()) titleEditor.value = `Reflections on ${source.source_title}`.slice(0, 500);
    mode(true);
    scheduleSave();
  }
  document.addEventListener('notebookSaveReflection', event => {
    const source = event.detail;
    if (!source || !/^(item|heading):[1-9]\d*$/.test(source.source_key) || typeof source.reflectionMarkdown !== 'string') return;
    open(source, true);
  });
  async function open(source, edit = false) {
    if (busy || saving || changingPresentation) return;
    if (current && dirty() && !await save()) return;
    if (!await window.hadithAuth?.getToken()) {
      window.hadithAuth?.requireToken?.('Please sign in to take notes.');
      return;
    }
    document.querySelector('[data-quran-help-tips-close]')?.click();
    pendingSource = source;
    pendingFloating = false;
    restoreButton.hidden = true;
    clearTimeout(saveTimer);
    const ownGeneration = ++generation;
    current = source; editor.value = savedText = ''; preview.innerHTML = ''; resetTags();
    mode(false); deleteButton.hidden = true;
    const link = document.getElementById('notebook-source');
    const reference = source.source_url.match(/\/([a-z][a-z0-9_-]*:\d+(?::\d+)?[a-z]?)(?:[?#]|$)/i);
    link.textContent = reference ? reference[1] : source.source_title; link.title = source.source_title; link.href = source.source_url;
    if (source.source_key === 'general' || source.source_key.startsWith('general:')) link.removeAttribute('href');
    status.textContent = 'Loading…'; setBusy(true);
    returnModal = document.querySelector('.modal.show:not(#notebook-modal)');
    if (returnModal) {
      const parent = returnModal;
      await new Promise(resolve => { parent.addEventListener('hidden.bs.modal', resolve, { once: true }); bootstrap.Modal.getOrCreateInstance(parent).hide(); });
      if (ownGeneration !== generation) return;
    }
    bootstrap.Modal.getOrCreateInstance(modal).show();
    if (modal.classList.contains('notebook-floating')) modal.removeAttribute('aria-modal');
    try {
      const result = await api(`?source=${encodeURIComponent(source.source_key)}`);
      if (ownGeneration !== generation) return;
      current = result.note || source; editor.value = savedText = current.markdown; resetTags();
      pendingSource = null;
      preview.innerHTML = current.html || ''; deleteButton.hidden = !current.version;
      markSource(current.source_key, !!current.version);
      status.textContent = ''; setBusy(false); mode(edit || !current.version);
      importReflection(source);
      if (modal.classList.contains('notebook-floating')) { minimizeFloating(false); rememberFloating(); }
    } catch (err) {
      if (ownGeneration !== generation) return;
      status.textContent = err.message; busy = false; current = null;
    }
  }
  modal.addEventListener('hide.bs.modal', event => {
    if (changingPresentation) return;
    if (busy) { event.preventDefault(); return; }
    if (current && (saving || dirty())) {
      event.preventDefault();
      save().then(ok => {
        if (!ok && window.confirm('This note could not be saved. Discard your unsaved changes and close?')) {
          editor.value = savedText; tagEditor.value = savedTags; titleEditor.value = savedTitle; ok = true;
        }
        if (ok) bootstrap.Modal.getInstance(modal)?.hide();
      });
    }
  });
  modal.addEventListener('hidden.bs.modal', () => {
    if (changingPresentation) return;
    restoreButton.hidden = true;
    modal.classList.remove('notebook-minimized');
    try { sessionStorage.removeItem(floatingStorage); } catch (_) {}
    wikiAutocomplete.close();
    clearTimeout(saveTimer);
    if (returnModal?.isConnected) bootstrap.Modal.getOrCreateInstance(returnModal).show();
    returnModal = null;
  });
  editor.addEventListener('input', () => {
    scheduleSave();
  });
  function editTags() {
    if (!current || busy) return;
    mode(true);
    tagsEditing = true; renderNoteTags();
    tagEditor.focus();
  }
  document.getElementById('notebook-tag-bar').addEventListener('click', event => {
    if (!event.target.closest('input')) editTags();
  });
  document.getElementById('notebook-note-tags').addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); editTags(); }
  });
  function editTitle() {
    if (!current || busy) return;
    mode(true);
    titleEditing = true; renderNoteMetadata();
    titleEditor.focus();
  }
  const noteTitle = document.getElementById('notebook-note-title');
  noteTitle.addEventListener('click', editTitle);
  noteTitle.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); editTitle(); }
  });
  titleEditor.addEventListener('blur', () => { titleEditing = false; renderNoteMetadata(); });
  tagEditor.addEventListener('blur', () => { tagsEditing = false; renderNoteTags(); });
  for (const field of [titleEditor, tagEditor]) field.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); editor.focus();
    }
  });
  titleEditor.addEventListener('input', () => {
    renderNoteMetadata(); scheduleSave();
  });
  tagEditor.addEventListener('input', () => {
    renderNoteTags(); scheduleSave();
  });
  toggle.addEventListener('click', () => { if (!busy && current) editing ? showPreview() : mode(true); });
  const wikiAutocomplete = window.NotebookWiki.install(editor, document.getElementById('notebook-wiki-options'), query => api('/links?q=' + encodeURIComponent(query)));
  // Clicking anywhere outside the editor returns to the rendered note.
  document.addEventListener('pointerdown', event => {
    if (modal.classList.contains('show') && editing && !event.target.closest('#notebook-wiki-options, #notebook-drive-file') && !editor.contains(event.target) && !titleEditor.contains(event.target) && !document.getElementById('notebook-tag-bar').contains(event.target) && !toggle.contains(event.target) && !downloadButton.contains(event.target)) showPreview();
  });
  editor.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); showPreview(); }
  });
  saveButton.addEventListener('click', saveAndPreview);
  deleteButton.addEventListener('click', async () => {
    if (busy || !current || !window.confirm('Delete this note?')) return;
    clearTimeout(saveTimer);
    if (saving && !await saving) return;
    const ownGeneration = generation;
    if (!current?.version) return;
    setBusy(true);
    try {
      await api('', 'DELETE', { source_key: current.source_key, version: current.version, revision: current.revision });
      if (ownGeneration !== generation) return;
      current = { ...current, markdown: '', html: '', version: 0, tags: [], hashtags: [], title: '', created_at: null, updated_at: null }; resetTags();
      editor.value = savedText = ''; preview.innerHTML = ''; deleteButton.hidden = true;
      markSource(current.source_key, false); updateList(current); status.textContent = ''; mode(false);
    } catch (err) { if (ownGeneration === generation) status.textContent = err.message; }
    finally { if (ownGeneration === generation) setBusy(false); }
  });
  async function expandReference(button, note, inEditor) {
    if (busy || button.disabled) return;
    if (inEditor) { if (!await save()) return; note = current; }
    const ownGeneration = generation, targetStatus = inEditor ? status : listStatus;
    button.disabled = true; setBusy(true); targetStatus.textContent = 'Saving…';
    try {
      const result = await api('/expand', 'POST', { ...note, reference: button.dataset.notebookReference });
      if (ownGeneration !== generation) return;
      if (inEditor) {
        current = result.note; editor.value = savedText = current.markdown; resetTags();
        preview.innerHTML = current.html; mode(false); deleteButton.hidden = false;
      }
      markSource(result.note.source_key, true); updateList(result.note); targetStatus.textContent = '';
    } catch (err) { if (ownGeneration === generation) targetStatus.textContent = err.message; }
    finally { if (ownGeneration === generation) { button.disabled = false; setBusy(false); } }
  }
  function previewCaretOffset(event) {
    const caret = document.caretPositionFromPoint?.(event.clientX, event.clientY);
    const range = caret ? null : document.caretRangeFromPoint?.(event.clientX, event.clientY);
    let node = caret?.offsetNode || range?.startContainer;
    let offset = caret ? caret.offset : range?.startOffset;
    if (!node || node.nodeType !== Node.TEXT_NODE || !preview.contains(node)) {
      // Paragraph margins, blank space and some browser hit tests return an
      // element (or nothing). Resolve the nearest rendered text, never note end.
      const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
      const probe = document.createRange();
      let part, nearest = null, best = Infinity;
      const distance = rect => {
        const dy = Math.max(rect.top - event.clientY, event.clientY - rect.bottom, 0);
        const dx = Math.max(rect.left - event.clientX, event.clientX - rect.right, 0);
        return dy * 100000 + dx;
      };
      while ((part = walker.nextNode())) {
        if (!part.nodeValue.trim() || part.parentElement.closest('button, .footnote-backref')) continue;
        probe.selectNodeContents(part);
        for (const rect of probe.getClientRects()) {
          if (!rect.height) continue;
          const score = distance(rect);
          if (score < best) { best = score; nearest = part; }
        }
      }
      if (!nearest) return 0;
      node = nearest; offset = 0; best = Infinity;
      // Collapsed ranges give visual caret positions even in right-to-left text.
      for (let i = 0; i <= node.length; i++) {
        if (i && i < node.length && /[\uDC00-\uDFFF]/.test(node.nodeValue[i])) continue;
        probe.setStart(node, i); probe.collapse(true);
        for (const rect of probe.getClientRects()) {
          if (!rect.height) continue;
          const score = distance(rect);
          if (score < best) { best = score; offset = i; }
        }
      }
    }

    // Decode source escapes/entities while retaining UTF-16 textarea offsets.
    const source = editor.value, positions = [], decoder = document.createElement('textarea');
    let text = '';
    for (let i = 0; i < source.length;) {
      const start = i;
      let value = source[i++];
      if (value.charCodeAt(0) === 92 && /[!-/:-@[-`{-~]/.test(source[i] || '')) {
        value = source[i++];
      } else if (value === '&') {
        const entity = source.slice(start).match(/^&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/);
        if (entity) { decoder.innerHTML = entity[0]; value = decoder.value; i = start + entity[0].length; }
      }
      for (let j = 0; j < value.length; j++) positions.push(start);
      text += value;
    }
    positions.push(source.length);
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
    let cursor = 0, part;
    while ((part = walker.nextNode())) {
      if (part.parentElement.closest('button, .footnote-backref')) continue;
      const value = part.nodeValue;
      if (!value.trim()) {
        if (part === node) return positions[cursor];
        continue;
      }
      // Walking in document order disambiguates repeated words and paragraphs.
      let start = text.indexOf(value, cursor);
      if (start < 0) {
        // Inline code and Markdown hard breaks can normalize whitespace.
        let matched = cursor;
        for (let j = 0; j < value.length; j++) {
          const next = text.indexOf(value[j], matched);
          if (next < 0) break;
          if (part === node && j === offset) return positions[next];
          matched = next + 1;
        }
        if (part === node) return positions[matched];
        continue;
      }
      if (part === node) return positions[start + Math.min(offset, value.length)];
      cursor = start + value.length;
    }
    // Whitespace outside text nodes uses the nearest preceding source position.
    return positions[cursor];
  }
  function revealEditorCaret(offset, viewportY) {
    editor.setSelectionRange(offset, offset);
    editor.focus({ preventScroll: true });
    // A textarea exposes selection offsets but no caret rectangle. Mirror its
    // wrapping and typography to keep the clicked line at the same visible height.
    const mirror = document.createElement('div');
    const style = getComputedStyle(editor);
    for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'textAlign', 'direction', 'unicodeBidi', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) {
      mirror.style[property] = style[property];
    }
    Object.assign(mirror.style, { position: 'fixed', left: '-10000px', top: '0', visibility: 'hidden', boxSizing: 'border-box', width: `${editor.clientWidth}px`, whiteSpace: 'pre-wrap', overflowWrap: 'break-word' });
    mirror.textContent = editor.value.slice(0, offset);
    const marker = document.createElement('span');
    marker.textContent = editor.value.slice(offset, offset + 1) || '\u200b';
    mirror.append(marker);
    document.body.append(mirror);
    const caretY = marker.getBoundingClientRect().top - mirror.getBoundingClientRect().top;
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const visibleY = Math.max(0, Math.min(viewportY, editor.clientHeight - lineHeight));
    editor.scrollTop = Math.max(0, caretY - visibleY);
    mirror.remove();
  }
  let previewPointerCaret = null;
  preview.addEventListener('pointerdown', event => {
    previewPointerCaret = !editing && current && !busy && event.button === 0
      ? { offset: previewCaretOffset(event), viewportY: event.clientY - preview.getBoundingClientRect().top }
      : null;
  });
  preview.addEventListener('pointercancel', () => { previewPointerCaret = null; });
  preview.addEventListener('click', event => {
    const pointerCaret = previewPointerCaret;
    previewPointerCaret = null;
    const button = event.target.closest('[data-notebook-reference]');
    if (button && current) { expandReference(button, current, true); return; }
    if (event.target.closest('a, button, input, textarea, select, summary')) return;
    if (current && !busy) {
      const offset = pointerCaret?.offset ?? previewCaretOffset(event);
      const viewportY = pointerCaret?.viewportY ?? event.clientY - preview.getBoundingClientRect().top;
      mode(true);
      revealEditorCaret(offset, viewportY);
    }
  });
  async function openWiki(title) {
    const ownGeneration = generation;
    try {
      const result = await api('/links?title=' + encodeURIComponent(title));
      if (ownGeneration !== generation) return;
      if (current && dirty() && !await save()) return;
      if (ownGeneration !== generation) return;
      await open(result.note);
    } catch (err) { if (ownGeneration !== generation) return; if (modal.classList.contains('show')) status.textContent = err.message; else if (listStatus) listStatus.textContent = err.message; }
  }
  // Keep native new-tab links on the current Quran host's notebook route.
  function localizeWikiLinks() {
    document.querySelectorAll('[data-notebook-wiki]').forEach(link => {
      link.href = quranApiPath('/notebook').replace('/api/', '/') + '?note=' + encodeURIComponent(link.dataset.notebookWiki);
    });
  }
  new MutationObserver(localizeWikiLinks).observe(preview, { childList: true, subtree: true });
  async function openRequestedWiki() {
    const title = new URLSearchParams(location.search).get('note');
    if (title && await window.hadithAuth?.getToken()) openWiki(title);
  }
  preview.addEventListener('keydown', event => {
    if (event.target === preview && event.key === 'Enter' && current && !busy) {
      event.preventDefault();
      mode(true);
    }
  });
  document.getElementById('notebook-new')?.addEventListener('click', () => {
    open({ source_key: `general:${crypto.randomUUID()}`, source_title: 'General note', source_url: '/notebook', title: '', markdown: '', html: '', version: 0 }, true);
  });
  function createNoteTile(note) {
    const article = document.createElement('article'); article.className = 'notebook-tile' + (!note.version ? ' notebook-tile-new' : '');
    article.dataset.sourceKey = note.source_key;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'notebook-tile-open';
    button.disabled = !listSignedIn;
    if (!listSignedIn) button.setAttribute('aria-describedby', 'notebook-signin');
    button.setAttribute('aria-label', `Open note: ${note.title || note.source_title}`);
    const heading = document.createElement('span'); heading.className = 'notebook-tile-title';
    const icon = document.createElement('span'); icon.className = note.version ? 'bi bi-sticky-fill' : 'bi bi-sticky'; icon.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span'); title.dir = 'auto'; title.textContent = note.title || note.source_title;
    heading.append(icon, title);
    const rendered = document.createElement('div'); rendered.innerHTML = note.html;
    rendered.querySelectorAll('button').forEach(node => node.remove());
    rendered.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, tr, br').forEach(node => node.append(' '));
    const text = rendered.textContent.replace(/\s+/g, ' ').trim() || (note.source_key === 'general' ? 'Create a new private note.' : '');
    const excerpt = text.length > 220 ? `${text.slice(0, 220).trimEnd()}…` : text;
    const content = document.createElement('span'); content.className = 'notebook-tile-preview notebook-markdown'; content.dir = 'auto';
    const arabic = /([\p{Script_Extensions=Arabic}\u200c\u200d]+(?:[ \t]+[\p{Script_Extensions=Arabic}\u200c\u200d]+)*)/gu;
    for (const part of excerpt.split(arabic)) {
      const span = document.createElement('span'); span.textContent = part;
      if (/\p{Script_Extensions=Arabic}/u.test(part)) span.className = 'notebook-arabic';
      content.append(span);
    }
    button.append(heading, content); button.addEventListener('click', () => open(note));
    article.append(button);
    const tagBar = document.createElement('div'); tagBar.className = 'notebook-tile-tags';
    for (const tag of note.hashtags || []) {
      const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'notebook-tag-chip';
      chip.textContent = tag; chip.dir = 'auto';
      chip.addEventListener('click', () => { document.getElementById('notebook-tag').value = tag; renderTagRail(); loadList(); });
      tagBar.append(chip);
    }
    if (tagBar.childElementCount) article.append(tagBar);
    return article;
  }
  function renderList() {
    const filtering = document.getElementById('notebook-search').value.trim() || document.getElementById('notebook-tag').value.trim();
    list.replaceChildren();
    const general = notes.find(note => note.source_key === 'general') || { source_key: 'general', source_title: 'General note', source_url: '/notebook', markdown: '', html: '', version: 0 };
    const filtered = filtering ? notes : [general, ...notes.filter(note => note.source_key !== 'general')];
    for (const note of filtered) list.append(createNoteTile(note));
    listStatus.textContent = filtered.length ? '' : (filtering ? 'No matching notes.' : 'No notes yet.');
  }
  function checkMore() {
    if (modal.classList.contains('show')) return;
    if (!sentinel || listLoading || !hasMore || listFailed || !list.getClientRects().length) return;
    if (sentinel.getBoundingClientRect().top < window.innerHeight + 300) loadList(true);
  }
  async function loadList(append = false) {
    if (!list || (append && listLoading)) return;
    const request = ++listRequest;
    listLoading = true; listFailed = false; more.hidden = true; more.disabled = true;
    if (!append) { notes = []; list.replaceChildren(); hasMore = false; downloadAll.disabled = true; }
    listStatus.textContent = 'Loading…';
    try {
      const token = await window.hadithAuth?.getToken();
      if (request !== listRequest) return;
      listSignedIn = !!token;
      document.getElementById('personal-notebook').classList.toggle('notebook-signed-out', !listSignedIn);
      document.getElementById('notebook-signin').hidden = listSignedIn;
      for (const id of ['notebook-search', 'notebook-tag']) document.getElementById(id).disabled = !listSignedIn;
      if (!listSignedIn) {
        notes = []; railTags = []; hasMore = false;
        document.getElementById('notebook-search').value = '';
        document.getElementById('notebook-tag').value = '';
        downloadAll.disabled = true;
        renderTagRail(); renderList();
        return;
      }
      const params = new URLSearchParams({ offset: append ? notes.length : 0,
        q: document.getElementById('notebook-search').value.trim(), tag: document.getElementById('notebook-tag').value.trim() });
      const result = await api(`?${params}`);
      if (request !== listRequest) return;
      notes = append ? notes.concat(result.notes) : result.notes;
      hasMore = result.hasMore && result.notes.length > 0;
      downloadAll.disabled = false; renderList();
    } catch (err) {
      if (request === listRequest) { listStatus.textContent = err.message; listFailed = true; more.hidden = false; }
    } finally {
      if (request === listRequest) { listLoading = false; more.disabled = false; requestAnimationFrame(checkMore); }
    }
  }
  if (sentinel) {
    if ('IntersectionObserver' in window) new IntersectionObserver(checkMore, { rootMargin: '300px' }).observe(sentinel);
    window.addEventListener('scroll', checkMore, { passive: true });
    window.addEventListener('resize', checkMore);
  }
  document.addEventListener('hadithAuthChanged', () => {
    pendingFloating = false;
    try { sessionStorage.removeItem(floatingStorage); } catch (_) {}
    restoreButton.hidden = true;
    wikiAutocomplete.close();
    ++generation; ++listRequest; ++statusEpoch; ++tagRequest; railTags = []; renderTagRail(); returnModal = null; pendingSource = null;
    clearTimeout(saveTimer); saving = null; current = null; editor.value = savedText = ''; preview.innerHTML = ''; resetTags();
    existing.clear(); checked.clear(); paintButtons(); scheduleStatus();
    const ayahNote = document.querySelector('[data-quran-ayah-note][data-ayah-note-ref]');
    if (ayahNote) prepareAyahNote(ayahNote);
    setBusy(false); saveButton.disabled = true; deleteButton.hidden = true;
    bootstrap.Modal.getInstance(modal)?.hide(); loadList(); loadTags(); openRequestedWiki();
  });
  document.addEventListener('notebookDriveConnected', () => {
    ++statusEpoch; checked.clear(); scheduleStatus(); loadList(); loadTags();
    if (modal.classList.contains('show') && (pendingSource || (current && !dirty()))) open(pendingSource || current);
  });
  document.addEventListener('notebookDriveDisconnected', () => {
    ++statusEpoch; existing.clear(); checked.clear(); paintButtons(); loadList(); loadTags();
  });
  let searchTimer;
  for (const id of ['notebook-search', 'notebook-tag']) document.getElementById(id)?.addEventListener('input', () => {
    renderTagRail(); clearTimeout(searchTimer);
    ++listRequest; hasMore = false; listLoading = false; notes = []; list.replaceChildren();
    listStatus.textContent = 'Loading…';
    searchTimer = setTimeout(() => loadList(), 250);
  });
  more?.addEventListener('click', () => loadList(notes.length > 0));
  installButtons();
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') { paintButtons(); scheduleStatus(); continue; }
      for (const node of record.addedNodes) if (node.nodeType === 1 && !node.classList.contains('personal-note-btn')) installButtons(node);
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-hadith-id', 'data-heading-id', 'data-tafsir-bookmark-key', 'data-note-key'] });
  window.addEventListener('focus', () => { ++statusEpoch; checked.clear(); scheduleStatus(); });
  window.addEventListener('beforeunload', event => {
    if (current && (saving || dirty())) { event.preventDefault(); event.returnValue = ''; }
  });
  loadList(); loadTags();
  openRequestedWiki();
  restoreFloating();
})();
