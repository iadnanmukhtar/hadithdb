'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../public/static/js/script.js'), 'utf8');
const start = source.indexOf('function prepareInlineContentEditor(');
const end = source.indexOf('function initReadOnlyInlineEditorGuards(', start);
const context = {};
vm.runInNewContext(source.slice(start, end), context);

function field(initial = {}) {
  const attrs = { ...initial };
  const listeners = new Map();
  return {
    attrs,
    getAttribute: name => attrs[name] ?? null,
    hasAttribute: name => Object.hasOwn(attrs, name),
    setAttribute: (name, value) => { attrs[name] = value; },
    removeAttribute: name => { delete attrs[name]; },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: type => listeners.delete(type),
    dispatch(type, button = 0) { listeners.get(type)?.({ type, button }); }
  };
}

test.each(['pointerdown', 'focus'])('activates on %s while avoiding startup activation', type => {
  const el = field();
  context.prepareInlineContentEditor(el);
  expect(el.attrs.contenteditable).toBeUndefined();
  expect(el.attrs.tabindex).toBe('0');
  el.dispatch(type);
  expect(el.attrs.contenteditable).toBe('true');
  expect(el.attrs.tabindex).toBeUndefined();
});

test('preserves explicit tab order and ignores secondary clicks', () => {
  const el = field({ tabindex: '-1', contenteditable: 'false' });
  context.prepareInlineContentEditor(el);
  el.dispatch('pointerdown', 2);
  expect(el.attrs.contenteditable).toBe('false');
  el.dispatch('focus');
  expect(el.attrs).toEqual({ tabindex: '-1', contenteditable: 'true' });
});

test('does not disturb an already active editor', () => {
  const el = field({ contenteditable: 'true' });
  context.prepareInlineContentEditor(el);
  expect(el.attrs).toEqual({ contenteditable: 'true' });
});
