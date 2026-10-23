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
  function lineParts(line) {
    const quote = /^[ \t]*(?:>[ \t]?)+/.exec(line)?.[0] || '';
    const rest = line.slice(quote.length);
    const list = /^([ \t]*)([-+*]|\d{1,9}[.)])([ \t]+)(\[[ xX]\][ \t]+)?/.exec(rest);
    return { quote, rest, list };
  }
  function literalContext(value, position) {
    let fence = null, frontmatter = false;
    const lines = value.slice(0, position).split('\n');
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (index === 0 && line === '---') { frontmatter = true; continue; }
      if (frontmatter) { if (/^(---|\.\.\.)\s*$/.test(line)) frontmatter = false; continue; }
      const match = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(lineParts(line).rest);
      if (!match) continue;
      if (!fence) fence = match[1];
      else if (match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) fence = null;
    }
    return frontmatter || !!fence;
  }
  function continueLine(value, start, end) {
    const lineStart = start ? value.lastIndexOf('\n', start - 1) + 1 : 0;
    const nextBreak = value.indexOf('\n', start), lineEnd = nextBreak < 0 ? value.length : nextBreak;
    if (end > lineEnd || literalContext(value, lineStart)) return null;
    const line = value.slice(lineStart, lineEnd), { quote, rest, list } = lineParts(line);
    let prefix = quote;
    if (list) {
      const [marker, indent, bullet, space, task] = list;
      if (start < lineStart + quote.length + marker.length) return null;
      if (!rest.slice(marker.length).trim()) {
        return { start: lineStart, end: lineEnd, text: quote, selectStart: lineStart + quote.length, selectEnd: lineStart + quote.length };
      }
      const next = /^\d/.test(bullet) ? `${Number(bullet.slice(0, -1)) + 1}${bullet.slice(-1)}` : bullet;
      prefix += indent + next + space + (task ? '[ ] ' : '');
    } else {
      if (!quote || start < lineStart + quote.length) return null;
      if (!rest.trim()) return { start: lineStart, end: lineEnd, text: '', selectStart: lineStart, selectEnd: lineStart };
    }
    const text = '\n' + prefix;
    return { start, end, text, selectStart: start + text.length, selectEnd: start + text.length };
  }
  function indentLines(value, start, end, unindent) {
    const first = start ? value.lastIndexOf('\n', start - 1) + 1 : 0;
    // A selection ending at the next line's start does not include that line.
    const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
    const nextBreak = value.indexOf('\n', last), finish = nextBreak < 0 ? value.length : nextBreak;
    if (literalContext(value, first)) return null;
    const lines = value.slice(first, finish).split('\n');
    if (!lines.some(line => lineParts(line).list) || !lines.every(line => !line.trim() || lineParts(line).list || /^[ \t]+\S/.test(lineParts(line).rest))) return null;
    let offset = first;
    const changes = lines.map(line => {
      const { quote, rest } = lineParts(line);
      const removed = unindent ? (/^(?: {1,2}|\t)/.exec(rest)?.[0].length || 0) : 0;
      const change = { position: offset + quote.length, removed, inserted: unindent || !line.trim() ? '' : '  ' };
      offset += line.length + 1;
      return change;
    });
    const mapPosition = position => position + changes.reduce((delta, change) => {
      if (position < change.position) return delta;
      return delta + change.inserted.length - Math.min(change.removed, position - change.position);
    }, 0);
    return { start: first, end: finish,
      text: lines.map((line, index) => {
        const { quote, rest } = lineParts(line), change = changes[index];
        return quote + change.inserted + rest.slice(change.removed);
      }).join('\n'),
      selectStart: mapPosition(start), selectEnd: mapPosition(end) };
  }
  function install(editor, enabled, closeSuggestions) {
    editor.addEventListener('keydown', event => {
      if (event.defaultPrevented || !enabled() || editor.disabled || editor.readOnly || event.isComposing || event.altKey) return;
      let edit;
      if (!(event.metaKey || event.ctrlKey)) {
        if (event.key === 'Enter' && !event.shiftKey) edit = continueLine(editor.value, editor.selectionStart, editor.selectionEnd);
        else if (event.key === 'Tab') edit = indentLines(editor.value, editor.selectionStart, editor.selectionEnd, event.shiftKey);
      } else {
        // Keep letter shortcuts available when an Arabic keyboard layout is active.
        const key = /^[a-z]$/i.test(event.key) ? event.key.toLowerCase() : event.code.replace(/^Key/, '').toLowerCase();
        const marker = event.shiftKey ? { h: '==', x: '~~' }[key] : { b: '**', i: '*', u: '__' }[key];
        if (marker) edit = replacement(editor.value, editor.selectionStart, editor.selectionEnd, marker);
      }
      if (!edit) return;
      event.preventDefault(); event.stopPropagation();
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
  if (typeof module === 'object' && module.exports) module.exports = { replacement, continueLine, indentLines };
  else root.NotebookShortcuts = { install };
})(typeof window === 'undefined' ? null : window);
