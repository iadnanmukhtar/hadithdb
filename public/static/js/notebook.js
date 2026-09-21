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
    editor.hidden = !edit; preview.hidden = edit;
    tagEditor.hidden = !edit; document.getElementById('notebook-tag-help').hidden = !edit;
    renderNoteMetadata();
    renderNoteTags();
    const label = edit ? 'Preview' : 'Edit Markdown';
    toggle.title = label; toggle.setAttribute('aria-label', label);
    toggle.innerHTML = `<i class="bi ${edit ? 'bi-eye' : 'bi-pencil'}" aria-hidden="true"></i>`;
    if (edit) editor.focus();
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
    titleEditor.hidden = !editing;
    title.textContent = titleEditor.value.trim(); title.hidden = editing || !title.textContent;
    const dates = document.getElementById('notebook-dates');
    dates.hidden = !current?.version;
    const format = value => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'unavailable';
    dates.textContent = current?.version ? `Created: ${format(current.created_at)} · Modified: ${format(current.updated_at)}` : '';
  }
  function renderNoteTags() {
    const container = document.getElementById('notebook-note-tags');
    container.replaceChildren();
    const tags = new Set([...(current?.hashtags || []), ...tagEditor.value.split(/\s+/u).filter(Boolean).map(tag => tag.replace(/^#/, ''))]);
    for (const tag of tags) {
      const chip = document.createElement('span'); chip.className = 'notebook-tag-chip'; chip.dir = 'auto'; chip.textContent = tag; container.append(chip);
    }
    if (!tags.size && !editing) container.textContent = 'No tags';
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
    loadList(); loadTags();
  }
  async function save() {
    clearTimeout(saveTimer);
    if (saving) return saving;
    if (!current || busy) return false;
    const ownGeneration = generation;
    const operation = (async () => {
      try {
        while (ownGeneration === generation && dirty()) {
          const text = editor.value, tags = tagEditor.value, title = titleEditor.value;
          status.textContent = 'Saving…';
          let note;
          if (!text.trim() && !title.trim()) {
            if (current.version) await api('', 'DELETE', { source_key: current.source_key, version: current.version });
            note = { ...current, version: 0, markdown: text, html: '' };
          } else note = (await api('', 'PUT', { ...current, markdown: text, tags, title })).note;
          if (ownGeneration !== generation) return false;
          current = note;
          savedText = text; savedTags = tags; savedTitle = title; renderNoteTags(); renderNoteMetadata();
          deleteButton.hidden = !note.version;
          markSource(note.source_key, !!note.version);
          updateList(note);
          // Keep any text typed during the request; only advance the saved revision.
          if (!editing && editor.value === text) preview.innerHTML = note.html;
        }
        if (ownGeneration === generation) status.textContent = '';
        return ownGeneration === generation;
      } catch (err) {
        if (ownGeneration === generation) status.textContent = err.message;
        return false;
      }
    })();
    saving = operation;
    try { return await operation; } finally { if (saving === operation) saving = null; }
  }
  async function showPreview() {
    if (!editing || busy) return;
    mode(false);
    renderPreview();
    await save();
  }
  async function open(source, edit = false) {
    if (busy || saving) return;
    if (!await window.hadithAuth?.getToken()) {
      window.hadithAuth?.requireToken?.('Please sign in to take notes.');
      return;
    }
    document.querySelector('[data-quran-help-tips-close]')?.click();
    pendingSource = source;
    clearTimeout(saveTimer);
    const ownGeneration = ++generation;
    current = source; editor.value = savedText = ''; preview.innerHTML = ''; resetTags();
    mode(false); deleteButton.hidden = true;
    const link = document.getElementById('notebook-source');
    const reference = source.source_url.match(/\/([a-z][a-z0-9_-]*:\d+(?::\d+)?[a-z]?)(?:[?#]|$)/i);
    link.textContent = reference ? reference[1] : source.source_title; link.title = source.source_title; link.href = source.source_url;
    if (source.source_key === 'general') link.removeAttribute('href');
    status.textContent = 'Loading…'; setBusy(true);
    returnModal = document.querySelector('.modal.show:not(#notebook-modal)');
    if (returnModal) {
      const parent = returnModal;
      await new Promise(resolve => { parent.addEventListener('hidden.bs.modal', resolve, { once: true }); bootstrap.Modal.getOrCreateInstance(parent).hide(); });
      if (ownGeneration !== generation) return;
    }
    bootstrap.Modal.getOrCreateInstance(modal).show();
    try {
      const result = await api(`?source=${encodeURIComponent(source.source_key)}`);
      if (ownGeneration !== generation) return;
      current = result.note || source; editor.value = savedText = current.markdown; resetTags();
      pendingSource = null;
      preview.innerHTML = current.html || ''; deleteButton.hidden = !current.version;
      markSource(current.source_key, !!current.version);
      status.textContent = ''; setBusy(false); mode(edit || !current.version);
    } catch (err) {
      if (ownGeneration !== generation) return;
      status.textContent = err.message; busy = false; current = null;
    }
  }
  modal.addEventListener('hide.bs.modal', event => {
    if (busy) { event.preventDefault(); return; }
    if (current && (saving || dirty())) {
      event.preventDefault();
      save().then(ok => { if (ok) bootstrap.Modal.getInstance(modal)?.hide(); });
    }
  });
  modal.addEventListener('hidden.bs.modal', () => {
    clearTimeout(saveTimer);
    if (returnModal?.isConnected) bootstrap.Modal.getOrCreateInstance(returnModal).show();
    returnModal = null;
  });
  editor.addEventListener('input', () => {
    status.textContent = '';
    clearTimeout(saveTimer); saveTimer = setTimeout(save, 700);
  });
  function editTags() {
    if (!current || busy) return;
    mode(true);
    tagEditor.focus();
  }
  document.getElementById('notebook-tag-bar').addEventListener('click', event => {
    if (!event.target.closest('input')) editTags();
  });
  document.getElementById('notebook-note-tags').addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); editTags(); }
  });
  titleEditor.addEventListener('input', () => {
    status.textContent = ''; renderNoteMetadata(); clearTimeout(saveTimer); saveTimer = setTimeout(save, 700);
  });
  tagEditor.addEventListener('input', () => {
    status.textContent = ''; renderNoteTags(); clearTimeout(saveTimer); saveTimer = setTimeout(save, 700);
  });
  toggle.addEventListener('click', () => { if (!busy && current) editing ? showPreview() : mode(true); });
  // Clicking anywhere outside the editor returns to the rendered note.
  document.addEventListener('pointerdown', event => {
    if (modal.classList.contains('show') && editing && !editor.contains(event.target) && !titleEditor.contains(event.target) && !document.getElementById('notebook-tag-bar').contains(event.target) && !toggle.contains(event.target) && !downloadButton.contains(event.target)) showPreview();
  });
  editor.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); showPreview(); }
  });
  saveButton.addEventListener('click', save);
  deleteButton.addEventListener('click', async () => {
    if (busy || !current || !window.confirm('Delete this note?')) return;
    clearTimeout(saveTimer);
    if (saving && !await saving) return;
    const ownGeneration = generation;
    if (!current?.version) return;
    setBusy(true);
    try {
      await api('', 'DELETE', { source_key: current.source_key, version: current.version });
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
  preview.addEventListener('click', event => {
    const button = event.target.closest('[data-notebook-reference]');
    if (button && current) { expandReference(button, current, true); return; }
    if (event.target.closest('a, button, input, textarea, select, summary')) return;
    if (current && !busy) mode(true);
  });
  preview.addEventListener('keydown', event => {
    if (event.target === preview && event.key === 'Enter' && current && !busy) {
      event.preventDefault();
      mode(true);
    }
  });
  function renderList() {
    const filtering = document.getElementById('notebook-search').value.trim() || document.getElementById('notebook-tag').value.trim();
    list.replaceChildren();
    const general = notes.find(note => note.source_key === 'general') || { source_key: 'general', source_title: 'General note', source_url: '/notebook', markdown: '', html: '', version: 0 };
    const filtered = filtering ? notes : [general, ...notes.filter(note => note.source_key !== 'general')];
    for (const note of filtered) {
      const article = document.createElement('article'); article.className = 'notebook-tile' + (!note.version ? ' notebook-tile-new' : '');
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
      list.append(article);
    }
    listStatus.textContent = filtered.length ? '' : (filtering ? 'No matching notes.' : 'No notes yet.');
  }
  function checkMore() {
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
    ++generation; ++listRequest; ++statusEpoch; ++tagRequest; railTags = []; renderTagRail(); returnModal = null; pendingSource = null;
    clearTimeout(saveTimer); saving = null; current = null; editor.value = savedText = ''; preview.innerHTML = ''; resetTags();
    existing.clear(); checked.clear(); paintButtons(); scheduleStatus();
    const ayahNote = document.querySelector('[data-quran-ayah-note][data-ayah-note-ref]');
    if (ayahNote) prepareAyahNote(ayahNote);
    setBusy(false); saveButton.disabled = true; deleteButton.hidden = true;
    bootstrap.Modal.getInstance(modal)?.hide(); loadList(); loadTags();
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
})();
