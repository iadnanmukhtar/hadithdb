/* global jsyaml */
(() => {
  'use strict';
  const systemFields = ['hadithunlocked', 'source_key', 'source_title', 'source_url', 'version', 'revision', 'cksum', 'content_checksum', 'created_at', 'updated_at', 'user_uid', 'driveFileUrl', 'editor_frontmatter', 'needsChecksum', 'lifetime_created', 'reference', 'links_explicit', 'hashtags', '_id', '_etag'];
  const dump = value => jsyaml.safeDump(value, { schema: jsyaml.JSON_SCHEMA, noRefs: true, lineWidth: -1, noCompatMode: true });
  function fields(raw) {
    const value = jsyaml.safeLoad(raw, { schema: jsyaml.JSON_SCHEMA }) ?? {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Use named YAML fields.');
    for (const key of systemFields) if (Object.hasOwn(value, key)) throw Error(`${key} is system metadata and cannot be edited.`);
    if (Object.hasOwn(value, 'title') && typeof value.title !== 'string' && value.title !== null) throw Error('Title must be text.');
    if (Object.hasOwn(value, 'tags') && (!Array.isArray(value.tags) || !value.tags.every(tag => typeof tag === 'string'))) throw Error('Tags must be a YAML list of text values.');
    if (Object.hasOwn(value, 'attachments')) {
      if (Object.hasOwn(value, 'links') && JSON.stringify(value.links) !== JSON.stringify(value.attachments)) throw Error('Use one links list; links and legacy attachments disagree.');
      if (!Object.hasOwn(value, 'links')) value.links = value.attachments;
      delete value.attachments;
    }
    return value;
  }
  function split(text) {
    if (!/^---\r?\n/.test(text)) return { body: text, fields: {}, raw: '', header: '' };
    const match = /^---\r?\n([\s\S]*?)^---(?:\r?\n|$)/m.exec(text);
    if (!match) throw Error('Close YAML frontmatter with a line containing ---.');
    return { body: text.slice(match[0].length), fields: fields(match[1]), raw: match[1], header: match[0] };
  }
  window.NotebookFrontmatterEditor = { install({ editor, titleEditor, tagEditor, context, changed, render }) {
    const button = document.getElementById('notebook-frontmatter');
    const panel = document.getElementById('notebook-frontmatter-panel');
    const input = document.getElementById('notebook-frontmatter-editor');
    const status = document.getElementById('notebook-frontmatter-status');
    let linksEdited = false, displayedLinks;
    const tags = () => [...new Set(tagEditor.value.split(/\s+/u).filter(Boolean).map(tag => tag.replace(/^#/, '')))];
    function attachments() {
      const note = context().current || {};
      const origin = !note.links_explicit && note.source_key && !note.source_key.startsWith('general') && note.source_url
        ? [{ source_key: note.source_key, source_title: note.source_title, source_url: note.source_url }] : [];
      return [...new Map([...origin, ...(note.attachments || [])].map(entry => [entry.source_key, entry])).values()].map(entry => {
        const path = new URL(entry.source_url, 'https://notebook.local').pathname;
        return /^\/(?:quran:\d+:\d+|[a-z][a-z0-9_-]*:\d+[a-z]?)$/i.test(path) ? path.slice(1) : entry;
      });
    }
    function values(data) {
      const saved = split(context().current?.markdown || '').fields;
      let linked = Object.hasOwn(data.fields, 'links') ? data.fields.links
        : Object.hasOwn(saved, 'links') ? [] : attachments();
      // Before migration, YAML held only the additional links. Show the original
      // and added items together, without undoing an intentional user edit.
      if (!context().current?.links_explicit && !linksEdited && JSON.stringify(data.fields.links) === JSON.stringify(saved.links))
        linked = [...new Map([...attachments(), ...(Array.isArray(linked) ? linked : [])].map(entry => [JSON.stringify(entry), entry])).values()];
      return { ...data.fields, title: titleEditor.value, tags: tags(), links: linked };
    }
    function visible(show) {
      panel.hidden = !show; button.setAttribute('aria-expanded', String(show));
      const label = show ? 'Hide frontmatter' : 'Show frontmatter'; button.title = label; button.setAttribute('aria-label', label);
    }
    function refresh() {
      try {
        const data = split(editor.value);
        const value = values(data); input.value = dump(value); displayedLinks = JSON.stringify(value.links); status.textContent = '';
      } catch (err) { status.textContent = err.reason || err.message; }
    }
    function valid() {
      try { split(editor.value); return true; }
      catch (err) { status.textContent = err.reason || err.message; return false; }
    }
    function fromControls() {
      if (!context().current || context().busy) return;
      try {
        const data = split(editor.value);
        const value = values(data);
        const raw = dump(value); displayedLinks = JSON.stringify(value.links);
        editor.value = `---\n${raw}---\n${data.body}`;
        input.value = raw; status.textContent = ''; changed();
      } catch (err) { status.textContent = err.reason || err.message; }
    }
    function fromMarkdown() {
      try {
        const data = split(editor.value);
        linksEdited = linksEdited || JSON.stringify(data.fields.links) !== JSON.stringify(split(context().current?.markdown || '').fields.links);
        if (Object.hasOwn(data.fields, 'title')) titleEditor.value = data.fields.title || '';
        if (Object.hasOwn(data.fields, 'tags')) tagEditor.value = data.fields.tags.join(' ');
        render(); refresh();
      } catch (err) { status.textContent = err.reason || err.message; }
    }
    input.addEventListener('input', () => {
      if (!context().current || context().busy) return;
      // Keep invalid YAML in the draft too, so saving cannot discard it silently.
      let body;
      try { body = split(editor.value).body; }
      catch (_) {
        const match = /^---\r?\n[\s\S]*?^---(?:\r?\n|$)/m.exec(editor.value);
        body = match ? editor.value.slice(match[0].length) : editor.value;
      }
      editor.value = `---\n${input.value.replace(/\n?$/, '\n')}---\n${body}`;
      try {
        const data = fields(input.value);
        linksEdited = linksEdited || JSON.stringify(data.links) !== displayedLinks;
        if (Object.hasOwn(data, 'title')) titleEditor.value = data.title || '';
        if (Object.hasOwn(data, 'tags')) tagEditor.value = data.tags.join(' ');
        render(); status.textContent = '';
      } catch (err) { status.textContent = err.reason || err.message; }
      changed();
    });
    titleEditor.addEventListener('input', fromControls);
    tagEditor.addEventListener('input', fromControls);
    editor.addEventListener('input', fromMarkdown);
    button.addEventListener('click', () => {
      if (!context().current || context().busy) return;
      if (panel.hidden) { refresh(); visible(true); input.focus(); } else visible(false);
    });
    return { refresh, valid, linksEdited: () => linksEdited, reset() { linksEdited = false; displayedLinks = undefined; visible(false); input.value = ''; status.textContent = ''; }, setBusy(value) { input.disabled = button.disabled = value; } };
  } };
})();
