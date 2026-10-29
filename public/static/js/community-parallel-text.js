(() => {
  'use strict';
  const arabic = 'نص عربي هنا';
  function separator(line) {
    let fence = 0;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '\\') { i++; continue; }
      if (line[i] === '`') {
        let end = i;
        while (line[end] === '`') end++;
        const length = end - i;
        if (!fence) fence = length; else if (fence === length) fence = 0;
        i = end - 1;
      } else if (!fence && line.slice(i, i + 2) === '||') return i;
    }
    return -1;
  }
  function replacement(value, position) {
    const start = position ? value.lastIndexOf('\n', position - 1) + 1 : 0;
    const next = value.indexOf('\n', position), end = next < 0 ? value.length : next;
    const line = value.slice(start, end), split = separator(line);
    if (split >= 0) return {start, end, text:line, selectStart:start + split + 2, selectEnd:end};
    const left = line.trim() ? line : 'English text here';
    const text = left + ' || ' + arabic;
    return {start, end, text, selectStart:start + left.length + 4, selectEnd:start + text.length};
  }
  window.CommunityParallelText = {replacement};
})();
