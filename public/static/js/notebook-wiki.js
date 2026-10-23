(function (root) {
  'use strict';
  function context(text, cursor) {
    const match = /\[\[([^\[\]|\r\n]*)$/.exec(text.slice(0, cursor));
    if (!match || [...match[1].trim()].length < 2 || match[1].length > 500) return null;
    const start = cursor - match[0].length;
    // Escaped wiki syntax is literal Markdown.
    const escapes = /\\*$/.exec(text.slice(0, start))[0].length;
    return escapes % 2 ? null : { start, query: match[1].trim(), cursor };
  }
  function replacement(text, ctx, title) {
    const tail = /^([^\[\]\r\n]*)\]\]/.exec(text.slice(ctx.cursor));
    const alias = tail?.[1].includes('|') ? tail[1].slice(tail[1].indexOf('|')) : '';
    return { text: `[[${title}${alias}]]`, start: ctx.start, end: ctx.cursor + (tail ? tail[0].length : 0) };
  }
  function caretRect(editor) {
    // Textareas do not expose a caret rectangle. Mirror the complete text so
    // wrapping and mixed Arabic/English direction agree with the editor.
    const mirror = document.createElement('div'), style = getComputedStyle(editor);
    for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'textAlign', 'direction', 'unicodeBidi', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) {
      mirror.style[property] = style[property];
    }
    Object.assign(mirror.style, { position: 'fixed', left: '-10000px', top: '0', visibility: 'hidden', boxSizing: 'border-box', width: `${editor.clientWidth}px`, whiteSpace: 'pre-wrap', overflowWrap: 'break-word' });
    mirror.textContent = editor.value.slice(0, editor.selectionStart);
    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    mirror.append(marker, editor.value.slice(editor.selectionStart)); document.body.append(mirror);
    const caret = marker.getBoundingClientRect(), origin = mirror.getBoundingClientRect(), box = editor.getBoundingClientRect();
    const rect = { left: box.left + editor.clientLeft + caret.left - origin.left - editor.scrollLeft,
      top: box.top + editor.clientTop + caret.top - origin.top - editor.scrollTop,
      bottom: box.top + editor.clientTop + caret.bottom - origin.top - editor.scrollTop };
    mirror.remove(); return rect;
  }
  function install(editor, popup, search) {
    let request = 0, timer, choices = [], selected = 0, ctx;
    function close() {
      ++request; clearTimeout(timer); choices = []; ctx = null; popup.hidden = true; popup.replaceChildren();
      editor.setAttribute('aria-expanded', 'false'); editor.removeAttribute('aria-activedescendant');
    }
    function position() {
      if (popup.hidden) return;
      const caret = caretRect(editor), box = editor.getBoundingClientRect();
      if (caret.bottom < box.top || caret.top > box.bottom) return close();
      const parent = popup.offsetParent, origin = parent.getBoundingClientRect();
      const leftEdge = Math.max(box.left, 0), rightEdge = Math.min(box.right, window.innerWidth);
      const width = Math.min(360, rightEdge - leftEdge);
      popup.style.width = `${width}px`;
      const bottomEdge = Math.min(origin.bottom, window.innerHeight);
      const below = bottomEdge - caret.bottom - 4, above = caret.top - Math.max(origin.top, 0) - 4;
      const flip = below < Math.min(popup.scrollHeight, 96) && above > below;
      popup.style.maxHeight = `${Math.max(0, Math.min(192, flip ? above : below))}px`;
      const top = flip ? caret.top - popup.offsetHeight - 4 : caret.bottom + 4;
      popup.style.left = `${Math.max(leftEdge, Math.min(caret.left, rightEdge - width)) - origin.left - parent.clientLeft + parent.scrollLeft}px`;
      popup.style.top = `${top - origin.top - parent.clientTop + parent.scrollTop}px`;
    }
    function highlight() {
      [...popup.children].forEach((option, index) => option.setAttribute('aria-selected', String(index === selected)));
      const option = popup.children[selected];
      if (option) {
        editor.setAttribute('aria-activedescendant', option.id);
        if (option.offsetTop < popup.scrollTop) popup.scrollTop = option.offsetTop;
        else if (option.offsetTop + option.offsetHeight > popup.scrollTop + popup.clientHeight) popup.scrollTop = option.offsetTop + option.offsetHeight - popup.clientHeight;
      }
    }
    function choose(index) {
      if (!ctx || !choices[index] || editor.selectionStart !== ctx.cursor) return close();
      const edit = replacement(editor.value, ctx, choices[index].title);
      editor.setRangeText(edit.text, edit.start, edit.end, 'end'); close(); editor.focus();
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function update() {
      close();
      if (editor.hidden || editor.selectionStart !== editor.selectionEnd) return;
      ctx = context(editor.value, editor.selectionStart);
      if (!ctx) return;
      const own = request, original = editor.value;
      timer = setTimeout(async () => {
        try {
          const result = await search(ctx.query);
          if (own !== request || editor.value !== original || editor.hidden) return;
          choices = result.notes; selected = 0;
          if (!choices.length) return close();
          popup.replaceChildren(...choices.map((note, index) => {
            const option = document.createElement('div'); option.id = `notebook-wiki-option-${index}`;
            option.setAttribute('role', 'option'); option.dir = 'auto'; option.textContent = note.title;
            option.addEventListener('pointerdown', event => { event.preventDefault(); choose(index); });
            return option;
          }));
          popup.hidden = false; position(); editor.setAttribute('aria-expanded', 'true'); highlight();
        } catch (_) { if (own === request) close(); }
      }, 180);
    }
    editor.addEventListener('input', update);
    editor.addEventListener('click', update);
    editor.addEventListener('keydown', event => {
      if (popup.hidden || event.isComposing) return;
      if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.key === 'Escape') return close();
        if (event.key === 'Enter' || event.key === 'Tab') return choose(selected);
        selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length; highlight();
      } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) close();
    });
    editor.addEventListener('blur', close);
    window.addEventListener('scroll', event => { if (!popup.contains(event.target)) position(); }, true);
    window.addEventListener('resize', position);
    new ResizeObserver(position).observe(editor);
    return { close };
  }
  if (typeof module === 'object' && module.exports) module.exports = { context, replacement };
  else root.NotebookWiki = { install };
})(typeof window === 'undefined' ? null : window);
