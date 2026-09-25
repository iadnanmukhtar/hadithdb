(function (root) {
  'use strict';
  function wrapped(text, marker) {
    if (text.length <= marker.length * 2 || !text.startsWith(marker) || !text.endsWith(marker)) return false;
    if (marker === '*') return /^\*+/.exec(text)[0].length % 2 === 1 && /\*+$/.exec(text)[0].length % 2 === 1;
    return true;
  }
  function replacement(value, start, end, marker) {
    if (start === end) return null;
    const selected = value.slice(start, end);
    const leading = /^\s*/.exec(selected)[0].length, trailing = /\s*$/.exec(selected)[0].length;
    if (leading === selected.length) return null;
    start += leading; end -= trailing;
    const text = value.slice(start, end);
    const before = value.slice(0, start), after = value.slice(end);
    const surrounded = before.endsWith(marker) && after.startsWith(marker) &&
      (marker !== '*' || (/\*+$/.exec(before)[0].length % 2 === 1 && /^\*+/.exec(after)[0].length % 2 === 1));
    if (surrounded) return { start: start - marker.length, end: end + marker.length, text, selectStart: start - marker.length, selectEnd: end - marker.length };
    if (marker === '__' && /<u>$/i.test(before) && /^<\/u>/i.test(after))
      return { start: start - 3, end: end + 4, text, selectStart: start - 3, selectEnd: end - 3 };
    // Format each nonblank line so selections across paragraphs stay valid Markdown.
    const lines = text.split('\n');
    const remove = lines.filter(line => line.trim()).every(line => wrapped(line.trim(), marker));
    const changed = lines.map(line => line.replace(/^(\s*)(.*?)(\s*)$/, (_, left, body, right) =>
      body ? left + (remove ? body.slice(marker.length, -marker.length) : marker + body + marker) + right : line)).join('\n');
    const inset = remove || lines.length > 1 ? 0 : marker.length;
    return { start, end, text: changed, selectStart: start + inset, selectEnd: start + changed.length - inset };
  }
  function install(editor, enabled, closeSuggestions) {
    editor.addEventListener('keydown', event => {
      if (!enabled() || editor.disabled || editor.readOnly || event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey)) return;
      // Keep letter shortcuts available when an Arabic keyboard layout is active.
      const key = /^[a-z]$/i.test(event.key) ? event.key.toLowerCase() : event.code.replace(/^Key/, '').toLowerCase();
      const marker = event.shiftKey ? { h: '==', x: '~~' }[key] : { b: '**', i: '*', u: '__' }[key];
      if (!marker) return;
      event.preventDefault(); event.stopPropagation();
      const edit = replacement(editor.value, editor.selectionStart, editor.selectionEnd, marker);
      if (!edit) return;
      closeSuggestions();
      const direction = editor.selectionDirection, scrollTop = editor.scrollTop, scrollLeft = editor.scrollLeft;
      editor.setSelectionRange(edit.start, edit.end);
      // insertText preserves native Undo/Redo; setRangeText is the fallback.
      if (!document.execCommand?.('insertText', false, edit.text)) editor.setRangeText(edit.text, edit.start, edit.end, 'end');
      editor.setSelectionRange(edit.selectStart, edit.selectEnd, direction);
      editor.scrollTop = scrollTop; editor.scrollLeft = scrollLeft;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  if (typeof module === 'object' && module.exports) module.exports = { replacement };
  else root.NotebookShortcuts = { install };
})(typeof window === 'undefined' ? null : window);
