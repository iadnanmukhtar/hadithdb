'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');

const views = path.resolve(__dirname, '../views');
const documents = fs.readdirSync(views).filter(name => name.endsWith('.ejs') &&
  /<!doctype html>/i.test(fs.readFileSync(path.join(views, name), 'utf8')) &&
  !/_(feed|rss)\.ejs$/.test(name));

test.each(documents)('%s compiles and uses the app shell or standalone note stylesheet', name => {
  const filename = path.join(views, name);
  const source = fs.readFileSync(filename, 'utf8');
  expect(() => ejs.compile(source, { filename })).not.toThrow();
  if (name === 'notebook_shared.ejs') {
    expect(source).toContain('/static/css/ux-foundations.css');
    expect(source).toContain('no-referrer');
  } else {
    for (const component of ['head', 'header', 'footer'])
      expect(source).toContain(`include('sub-views/${component}.ejs'`);
  }
});

test('every admin manager opener resolves to a named dialog with a close control', async () => {
  const settings = global.settings;
  global.settings = { site: {} };
  try {
    const html = await ejs.renderFile(path.join(views, 'admin.ejs'), {}, { includer: () => ({ template: ' ' }) });
    const document = new JSDOM(html).window.document;
    const buttons = document.querySelectorAll('[data-bs-toggle="modal"]');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      const dialog = document.querySelector(button.dataset.bsTarget);
      expect(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent.trim()).toBeTruthy();
      expect(dialog.querySelector('button.btn-close[data-bs-dismiss="modal"]').getAttribute('aria-label')).toBe('Close');
    }
  } finally {
    global.settings = settings;
  }
});

test('admin updates reject the retired translation request field before database access', async () => {
  const route = require('../routes/update').stack.find(layer => layer.route?.path === '/:id/:prop').route;
  const handler = route.stack.at(-1).handle;
  const previous = global.query;
  global.query = jest.fn();
  try {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handler({ user: { uid: 'fixture' }, params: { id: '1', prop: 'hadith.requested' }, body: { value: '1' } }, res);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(global.query).not.toHaveBeenCalled();
  } finally {
    global.query = previous;
  }
});
