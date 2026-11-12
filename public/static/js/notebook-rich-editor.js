(() => {
  'use strict';
  const source = document.getElementById('notebook-editor');
  const preview = document.getElementById('notebook-preview');
  const toolbar = document.getElementById('notebook-format-toolbar');
  if (!source || !preview || !toolbar) return;
  const surface = window.CommunityShortEditor?.get(source) || window.CommunityShortEditor?.install(source);
  if (!surface) return;
  window.NotebookSections?.install(surface.rich);
  window.NotebookSections?.install(preview);
  window.CommunityFormatting.install(source, toolbar, document.getElementById('notebook-format-style'));
  const viewport = document.createElement('div');
  viewport.className = 'notebook-numbered-surface';
  surface.shell.before(viewport);
  viewport.append(surface.shell, preview);
  const gutter = document.createElement('div');
  gutter.className = 'notebook-line-numbers';
  gutter.setAttribute('aria-hidden', 'true');
  viewport.append(gutter);
  const modeControl = document.getElementById('notebook-mode-control');
  modeControl.append(surface.shell.querySelector('.community-short-tools'));
  let editing = false, frame;
  function updateLines() {
    frame = null;
    const active = editing ? (surface.mode === 'rich' ? surface.rich : source) : preview;
    if (!active.getClientRects().length) return;
    let measured = active, mirror;
    if (active === source) {
      // Mirror wrapping, direction and typography without inserting numbers into Markdown.
      mirror = document.createElement('div');
      const style = getComputedStyle(source);
      for (const key of ['font','lineHeight','letterSpacing','padding','boxSizing','whiteSpace','overflowWrap','wordBreak','textAlign','direction','unicodeBidi']) mirror.style[key] = style[key];
      Object.assign(mirror.style, { position: 'fixed', left: '-10000px', top: '0', width: source.clientWidth + 'px', height: 'auto', visibility: 'hidden', whiteSpace: 'pre-wrap' });
      source.value.split('\n').forEach(line => { const row = document.createElement('div'); row.textContent = line || '\u200b'; mirror.append(row); });
      document.body.append(mirror); measured = mirror;
    }
    const origin = measured.getBoundingClientRect().top;
    const tops = [];
    if (mirror) {
      // One marker per source line, including blank lines; wrapping only changes
      // the height of that line's mirror row.
      for (const row of mirror.children) tops.push(row.getBoundingClientRect().top - origin);
    } else {
      // Rendered logical lines start at a block boundary or an explicit break.
      // Inline formatting and soft wrapping do not create additional numbers.
      const walker = document.createTreeWalker(measured, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      let block = null, needsNumber = true;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName === 'BR') needsNumber = true;
          continue;
        }
        if (!node.textContent.trim()) continue;
        if (node.parentElement.closest('.footnote-backref, .community-footnote-label, button')) continue;
        const parent = node.parentElement.closest('.notebook-rich-line, p, li, h1, h2, h3, h4, h5, h6, pre, td, th, div');
        if (parent !== block) { block = parent; needsNumber = true; }
        const pre = node.parentElement.closest('pre');
        const parts = pre ? node.textContent.split('\n') : [node.textContent];
        let position = 0;
        for (let index = 0; index < parts.length; index++) {
          if (needsNumber || index) {
            const range = document.createRange();
            range.setStart(node, position); range.setEnd(node, Math.min(node.length, position + Math.max(1, parts[index].length)));
            const rect = range.getClientRects()[0];
            if (rect?.height) tops.push(rect.top - origin);
          }
          needsNumber = false; position += parts[index].length + 1;
        }
      }
    }
    const offset = active.getBoundingClientRect().top - viewport.getBoundingClientRect().top - (mirror ? active.scrollTop : 0);
    const labels = tops.map((top, i) => {
      const label = document.createElement('span'); label.textContent = i + 1;
      label.style.top = (top + offset) + 'px'; return label;
    });
    gutter.replaceChildren(...labels); mirror?.remove();
  }
  function scheduleLines() { if (!frame) frame = requestAnimationFrame(updateLines); }
  window.NotebookRichEditor = {
    renderAdvanced: markdown => window.CommunityShortEditor.renderAdvanced(markdown,source),
    setPreviewRenderer(renderer) { window.CommunityShortEditor.setPreviewRenderer(source,renderer); },
    setEditing(value) {
      editing = value; surface.shell.hidden = !value; toolbar.hidden = !value; modeControl.hidden = !value;
      if (value) surface.toFormatted();
      scheduleLines();
    }
  };
  for (const element of [source, preview, surface.rich]) element.addEventListener('scroll', scheduleLines, { passive: true });
  source.addEventListener('input', scheduleLines);
  new MutationObserver(records => { if (records.some(record => !gutter.contains(record.target))) scheduleLines(); }).observe(viewport, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  if (window.ResizeObserver) new ResizeObserver(scheduleLines).observe(viewport);
  window.NotebookRichEditor.setEditing(false);
})();
