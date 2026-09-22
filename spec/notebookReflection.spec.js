'use strict';
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../public/static/js/notebook.js'), 'utf8');
const importFunction = source.match(/  function importReflection\([^]*?\n  }/)[0];
function importInto(markdown, title, text) {
  const ctx = vm.createContext({ editor: { value: markdown }, titleEditor: { value: title }, mode: jest.fn(), scheduleSave: jest.fn() });
  vm.runInContext(importFunction, ctx);
  ctx.importReflection({ source_title: 'quran:2:255', reflectionMarkdown: text });
  return ctx;
}
test('copies reflection Markdown into a new titled note and schedules saving', () => {
  const ctx = importInto('', '', '**My reflection**\n\nالنص');
  expect(ctx.editor.value).toBe('**My reflection**\n\nالنص');
  expect(ctx.titleEditor.value).toBe('Reflections on quran:2:255');
  expect(ctx.mode).toHaveBeenCalledWith(true);
  expect(ctx.scheduleSave).toHaveBeenCalled();
});
test('appends to existing notes without overwriting their title or contents', () => {
  const ctx = importInto('Existing note', 'My title', 'My reflection');
  expect(ctx.editor.value).toBe('Existing note\n\nMy reflection');
  expect(ctx.titleEditor.value).toBe('My title');
});
test('repeated imports do not duplicate the reflection', () => {
  const ctx = importInto('Existing note\n\nMy reflection', 'My title', 'My reflection');
  expect(ctx.editor.value).toBe('Existing note\n\nMy reflection');
});
test('empty reflections do not change a note', () => {
  const ctx = importInto('Existing note', 'My title', ' ');
  expect(ctx.editor.value).toBe('Existing note');
  expect(ctx.scheduleSave).not.toHaveBeenCalled();
});
test('reflection widget renders a valid script with owner-only save controls', async () => {
  const html = await require('ejs').renderFile(require.resolve('../views/sub-views/comment_widget.ejs'), { widgetId: 'test-reflections', targetId: 42, ref: 'bukhari:1' });
  for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  expect(html).toContain("!deleted && c.canEdit && container.dataset.endpoint === '/comments'");
  expect(html).toContain("targetType === 'toc' ? 'heading' : 'item'");
  expect(html).toContain('reflectionMarkdown: comment.text');
});
