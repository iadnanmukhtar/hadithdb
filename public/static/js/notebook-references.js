/* global window */
(() => {
  'use strict';
  window.NotebookReferences = {
    install(root, { search, onChange, onEdit }) {
      const chips = root.querySelector('[data-reference-chips]');
      const controls = root.querySelector('[data-reference-controls]');
      const input = root.querySelector('input');
      const results = root.querySelector('[data-reference-results]');
      const status = root.querySelector('[role="status"]');
      const add = root.querySelector('[data-reference-add]');
      let references = [], editing = false, disabled = false, request = 0, timer;
      function close() {
        ++request; clearTimeout(timer); results.replaceChildren(); results.hidden = true;
        input.setAttribute('aria-expanded', 'false'); status.textContent = '';
      }
      function render() {
        chips.replaceChildren();
        for (const reference of references) {
          const chip = document.createElement('span'); chip.className = 'notebook-reference-chip';
          const link = document.createElement('a'); link.href = reference.url; link.textContent = reference.label;
          link.dir = 'auto'; link.target = '_blank'; link.rel = 'noopener'; chip.append(link);
          if (editing) {
            const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×';
            remove.setAttribute('aria-label', `Remove reference ${reference.label}`); remove.disabled = disabled;
            remove.addEventListener('click', () => {
              if (disabled) return;
              references = references.filter(item => item.url !== reference.url);
              close(); render(); onChange(references.slice()); input.focus();
            });
            chip.append(remove);
          }
          chips.append(chip);
        }
        controls.hidden = !editing; add.hidden = editing;
        input.disabled = add.disabled = disabled;
      }
      add.addEventListener('click', () => { if (!disabled) { onEdit(); input.focus(); } });
      input.addEventListener('input', () => {
        close(); const query = input.value.trim();
        if (query.length < 2 || disabled) return;
        const ownRequest = request;
        timer = setTimeout(async () => {
          status.textContent = 'Searching…';
          try {
            const response = await search(query);
            if (ownRequest !== request || disabled) return;
            const matches = response.references.filter(item => !references.some(ref => ref.url === item.url));
            results.replaceChildren();
            for (const item of matches) {
              const button = document.createElement('button'); button.type = 'button'; button.className = 'notebook-reference-result';
              const title = document.createElement('strong'); title.dir = 'auto'; title.textContent = `${item.ref} · ${item.type || 'Reference'}`;
              const fragment = document.createElement('span'); fragment.dir = 'auto';
              // Search highlights are presentation only; strip markup before display.
              const parsed = new DOMParser().parseFromString(item.fragment || '', 'text/html');
              fragment.textContent = parsed.body.textContent || item.title || '';
              const metadata = document.createElement('small'); metadata.dir = 'auto';
              metadata.textContent = [item.metadata_ar, item.metadata_en].filter(Boolean).join(' · ');
              button.append(title, fragment, metadata);
              button.addEventListener('click', () => {
                if (disabled) return;
                if (references.length >= 50) { status.textContent = 'Attach up to 50 references.'; return; }
                references.push({ ref: item.ref, label: item.label, url: item.url });
                input.value = ''; close(); render(); onChange(references.slice()); input.focus();
              });
              results.append(button);
            }
            results.hidden = matches.length === 0;
            input.setAttribute('aria-expanded', String(matches.length > 0));
            status.textContent = matches.length ? `${matches.length} ${matches.length === 1 ? 'result' : 'results'}. Choose a reference to attach.` : 'No matching references.';
          } catch (err) { if (ownRequest === request) status.textContent = err.message; }
        }, 200);
      });
      root.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !results.hidden) { event.preventDefault(); event.stopPropagation(); close(); input.focus(); }
        if (!['ArrowDown', 'ArrowUp'].includes(event.key) || results.hidden) return;
        const buttons = Array.from(results.querySelectorAll('button'));
        const index = buttons.indexOf(document.activeElement);
        const next = event.key === 'ArrowDown' ? Math.min(index + 1, buttons.length - 1) : index - 1;
        event.preventDefault(); (buttons[next] || input).focus();
      });
      return {
        reset(value = []) { references = value.map(item => ({...item})); input.value = ''; close(); render(); },
        setEditing(value) { editing = value; if (!value) close(); render(); },
        setDisabled(value) { disabled = value; if (value) close(); render(); },
        close
      };
    }
  };
})();
