'use strict';
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require('path').join(__dirname, '../views/sub-views/scripts.ejs'), 'utf8');
const start = source.indexOf("$el.on('keydown', function (event) {");
const end = source.indexOf('\n\t        });', start) + '\n\t        });'.length;

test.each([
  ['Backspace', 'toc.intro_en', '', true],
  ['Delete', 'toc.intro_en', '', true],
  ['Delete', 'toc.intro_en', '  ', true],
  ['Tab', 'toc.intro_en', '', false],
  ['Delete', 'toc.intro', '', false],
  ['Delete', 'toc.intro_en', 'Existing text', false]
])('%s on %s with %j marks intentional empty translation: %s', (key, prop, text, expected) => {
  const attrs = { 'data-prop': prop };
  let handler;
  const $el = {
    on: (_event, callback) => { handler = callback; },
    attr: (name, value) => value === undefined ? attrs[name] : (attrs[name] = value),
    text: () => text,
    removeClass: jest.fn()
  };
  vm.runInNewContext(source.slice(start, end), { $el, isMarkdownElement: () => true });
  handler({ key });
  expect(attrs.editing === 'true').toBe(expected);
});
