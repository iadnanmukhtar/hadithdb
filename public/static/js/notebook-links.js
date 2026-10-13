/* global window, document */
(() => {
  'use strict';
  window.NotebookAttachments = { install({ api, context, save, setBusy, changed, open }) {
    const panel = document.getElementById('notebook-attachments');
    const items = document.getElementById('notebook-attached-items');
    const associated = document.getElementById('notebook-associated-notes');
    const reference = document.getElementById('notebook-attachment-reference');
    const search = document.getElementById('notebook-attachment-search');
    const results = document.getElementById('notebook-attachment-results');
    const message = document.getElementById('notebook-attachment-status');
    const picker = document.getElementById('notebook-attach-existing');
    let epoch = 0, searchRequest = 0, timer;
    const button = (label, action) => {
      const node = document.createElement('button'); node.type = 'button';
      node.className = 'btn btn-sm btn-outline-secondary'; node.textContent = label; node.dir = 'auto';
      node.addEventListener('click', action); return node;
    };
    async function update(operation) {
      if (context().busy || !context().current) return;
      const ownEpoch = epoch;
      if (!await save() || ownEpoch !== epoch) return;
      setBusy(true); message.textContent = 'Saving link…';
      try {
        const note = await operation(context().current);
        if (ownEpoch !== epoch) return;
        changed(note); render(note.source_key === context().current.source_key ? note : context().current);
        message.textContent = 'Link saved.';
      } catch (err) { if (ownEpoch === epoch) message.textContent = err.message; }
      finally { setBusy(false); }
    }
    function render(note) {
      const count = document.getElementById('notebook-attachment-count');
      count.textContent = note.attachments?.length || 0; count.hidden = !note.attachments?.length;
      items.replaceChildren();
      for (const source of note.attachments || []) {
        const row = document.createElement('div'); row.className = 'd-flex align-items-center gap-2 flex-wrap mb-1';
        const link = document.createElement('a'); link.href = source.source_url; link.textContent = source.source_title; link.dir = 'auto';
        row.append(link, button(`Unlink ${source.source_title}`, () => update(current => api('', 'PUT', { attachment_edit: true,
          ...current, attachments: (current.attachments || []).filter(entry => entry.source_key !== source.source_key)
        }).then(result => result.note)))); items.append(row);
      }
      if (!items.childElementCount) items.textContent = 'No linked items yet.';
      picker.hidden = note.source_key.startsWith('general');
    }
    async function loadAssociated(note, ownEpoch) {
      associated.replaceChildren();
      if (note.source_key.startsWith('general')) return;
      associated.textContent = 'Loading linked notes…';
      try {
        const result = await api(`/associated?source=${encodeURIComponent(note.source_key)}`);
        if (ownEpoch !== epoch) return;
        associated.replaceChildren();
        if (result.notes.length) {
          const label = document.createElement('div'); label.className = 'small text-muted'; label.textContent = 'Notes linked to this item'; associated.append(label);
          for (const entry of result.notes) associated.append(button(entry.title || entry.source_title, () => open(entry)));
        }
      } catch (err) { if (ownEpoch === epoch) { associated.textContent = err.message; associated.append(button('Retry', () => loadAssociated(note, ownEpoch))); } }
    }
    function reset(note) {
      ++epoch; ++searchRequest; clearTimeout(timer);
      panel.open = false; reference.value = ''; search.value = ''; results.replaceChildren(); associated.replaceChildren(); message.textContent = '';
      items.replaceChildren(); picker.hidden = true;
      panel.hidden = !note;
      if (note) { render(note); loadAssociated(note, epoch); }
    }
    document.getElementById('notebook-attachment-add').addEventListener('click', () => update(async current => {
      if (!current.version) throw new Error('Give this note a title and save it before linking items.');
      const { source } = await api(`/attachment?reference=${encodeURIComponent(reference.value.trim())}`);
      const result = await api('', 'PUT', { attachment_edit: true, ...current, attachments: [...(current.attachments || []).filter(entry => entry.source_key !== source.source_key), source] });
      reference.value = ''; return result.note;
    }));
    reference.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); document.getElementById('notebook-attachment-add').click(); } });
    search.addEventListener('input', () => {
      clearTimeout(timer); const request = ++searchRequest, ownEpoch = epoch;
      results.replaceChildren();
      timer = setTimeout(async () => {
        try {
          const result = await api(`/links?q=${encodeURIComponent(search.value.trim())}`);
          if (ownEpoch !== epoch || request !== searchRequest) return;
          const candidates = result.notes.filter(note => note.source_key !== context().current?.source_key);
          for (const entry of candidates) results.append(button(`Link “${entry.title}”`, () => update(async current => {
            const { note } = await api(`?source=${encodeURIComponent(entry.source_key)}`);
            if (!note) throw new Error('This note was deleted. Search again.');
            const source = { source_key: current.source_key, source_title: current.source_title, source_url: current.source_url };
            const result = await api('', 'PUT', { attachment_edit: true, ...note, attachments: [...(note.attachments || []).filter(item => item.source_key !== source.source_key), source] });
            await loadAssociated(current, epoch); return result.note;
          })));
          if (!candidates.length) results.textContent = 'No matching notes.';
        } catch (err) { if (ownEpoch === epoch && request === searchRequest) message.textContent = err.message; }
      }, 250);
    });
    search.addEventListener('focus', () => search.dispatchEvent(new Event('input')));
    return { reset, render };
  } };
})();
