(() => {
  'use strict';
  window.NotebookShare = {
    install({ context, api, save }) {
      const button = document.getElementById('notebook-share');
      const panel = document.getElementById('notebook-share-panel');
      const enable = document.getElementById('notebook-share-enable');
      const active = document.getElementById('notebook-share-active');
      const url = document.getElementById('notebook-share-url');
      const open = document.getElementById('notebook-share-open');
      const copy = document.getElementById('notebook-share-copy');
      const revoke = document.getElementById('notebook-share-revoke');
      const status = document.getElementById('notebook-share-status');
      const publish = document.createElement('button');
      publish.type = 'button'; publish.className = 'btn btn-sm btn-outline-dark mt-2';
      publish.textContent = 'Create a Community post';
      const publicationHelp = document.createElement('p'); publicationHelp.className = 'small text-muted mt-2 mb-0';
      publicationHelp.textContent = 'Copy this saved note into a separate publication draft. Review it before publishing. Your notebook stays private.';
      panel.append(publish, publicationHelp);
      let epoch = 0, pending = false;
      function reset() {
        ++epoch; pending = false; publish.disabled = false; panel.hidden = true; button.setAttribute('aria-expanded', 'false');
        active.hidden = true; enable.hidden = false; enable.disabled = false; revoke.disabled = false;
        url.value = ''; open.removeAttribute('href'); status.textContent = '';
      }
      function render(result) {
        const shared = !!result.token;
        active.hidden = !shared; enable.hidden = shared;
        url.value = shared ? new URL(quranApiPath('/notebook/shared/' + result.token).replace('/api/', '/'), location.origin).href : '';
        if (shared) open.href = url.value; else open.removeAttribute('href');
      }
      async function perform(action) {
        const own = context();
        if (!own.current || own.busy || pending) return;
        const request = ++epoch, source = own.current.source_key;
        const isCurrent = () => request === epoch && context().generation === own.generation;
        pending = true; enable.disabled = revoke.disabled = true; status.textContent = 'Loading…';
        try {
          if (action === 'enable') {
            if (!await save()) { if (isCurrent()) status.textContent = 'Save the note successfully before sharing it.'; return; }
            if (!isCurrent()) return;
          }
          const result = action === 'load' ? await api('/share?source=' + encodeURIComponent(source))
            : await api('/share', action === 'enable' ? 'POST' : 'DELETE', { source_key: source });
          if (!isCurrent()) return;
          render(result);
          status.textContent = action === 'revoke' ? 'Sharing stopped. The old link no longer opens this note.'
            : result.token ? 'Public link is active. Saved changes appear at this link.' : 'This note is private.';
        } catch (err) { if (isCurrent()) status.textContent = err.message; }
        finally { if (request === epoch) { pending = false; enable.disabled = revoke.disabled = false; } }
      }
      button.addEventListener('click', () => {
        if (!context().current || context().busy || pending) return;
        if (!panel.hidden) return reset();
        panel.hidden = false; button.setAttribute('aria-expanded', 'true'); perform('load');
      });
      publish.addEventListener('click', async () => {
        const own = context();
        if (!own.current || own.busy || pending) return;
        const request = ++epoch, source = own.current.source_key;
        pending = true; publish.disabled = true;
        try {
          if (!await save()) { status.textContent = 'Save this note before creating a publication draft.'; return; }
          if (request !== epoch || context().generation !== own.generation) return;
          window.location.assign('/community/write?source=' + encodeURIComponent(source));
        } catch (err) { if (request === epoch) status.textContent = err.message; }
        finally { if (request === epoch) { pending = false; publish.disabled = false; } }
      });
      enable.addEventListener('click', () => perform('enable'));
      revoke.addEventListener('click', () => perform('revoke'));
      copy.addEventListener('click', async () => {
        const request = epoch;
        try {
          await navigator.clipboard.writeText(url.value);
          if (request === epoch) status.textContent = 'Link copied.';
        } catch (_) {
          if (request !== epoch) return;
          url.focus(); url.select(); status.textContent = 'Copy the selected link with Cmd+C or Ctrl+C.';
        }
      });
      return { reset };
    }
  };
})();
