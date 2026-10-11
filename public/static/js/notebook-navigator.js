/* global window */
(() => {
  'use strict';
  window.NotebookNavigator = { install({ api, open, context }) {
    const modal = document.getElementById('notebook-modal');
    const panel = document.getElementById('notebook-navigator');
    const items = document.getElementById('notebook-navigator-items');
    const status = document.getElementById('notebook-navigator-status');
    const more = document.getElementById('notebook-navigator-more');
    let notes = [], loaded = false, loading = false, hasMore = false, request = 0;
    function render() {
      items.replaceChildren();
      notes.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')) || a.source_key.localeCompare(b.source_key));
      for (const note of notes) {
        const item = document.createElement('li'), button = document.createElement('button');
        button.type = 'button'; button.dir = 'auto'; button.textContent = note.title || note.source_title;
        if (note.source_key === context()?.source_key) button.setAttribute('aria-current', 'page');
        button.addEventListener('click', async () => {
          if (note.source_key === context()?.source_key) return;
          button.disabled = true;
          try { await open(note); } finally { button.disabled = false; render(); }
        });
        item.append(button); items.append(item);
      }
      more.hidden = !hasMore; more.disabled = loading;
    }
    async function load(append = false) {
      if (loading) return;
      const ownRequest = ++request;
      loading = true; status.textContent = 'Loading…'; more.disabled = true;
      try {
        const result = await api(`?offset=${append ? notes.length : 0}`);
        if (ownRequest !== request) return;
        const combined = append ? notes.concat(result.notes) : result.notes;
        notes = [...new Map(combined.map(note => [note.source_key, note])).values()];
        loaded = true; hasMore = result.hasMore;
        status.textContent = notes.length ? '' : 'No notes yet.';
      } catch (err) {
        if (ownRequest !== request) return;
        status.textContent = err.message; hasMore = true;
      } finally {
        if (ownRequest === request) { loading = false; render(); }
      }
    }
    function visibility() {
      panel.hidden = !modal.classList.contains('show') || !modal.querySelector('.modal-dialog').classList.contains('modal-fullscreen');
      if (!panel.hidden && !loaded) load();
    }
    function reset() {
      ++request; notes = []; loaded = loading = hasMore = false;
      status.textContent = ''; render();
    }
    more.addEventListener('click', () => load(loaded));
    modal.addEventListener('shown.bs.modal', visibility);
    modal.addEventListener('hidden.bs.modal', visibility);
    new MutationObserver(visibility).observe(modal.querySelector('.modal-dialog'), { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(visibility).observe(modal, { attributes: true, attributeFilter: ['class'] });
    for (const event of ['hadithAuthChanged', 'notebookDriveDisconnected', 'notebookDriveConnected']) document.addEventListener(event, () => { reset(); visibility(); });
    return {
      select: render,
      update(note) {
        const index = notes.findIndex(entry => entry.source_key === note.source_key);
        if (!note.version) { if (index >= 0) notes.splice(index, 1); }
        else if (index >= 0) notes[index] = note;
        else if (loaded) notes.push(note);
        render();
      }
    };
  } };
})();
