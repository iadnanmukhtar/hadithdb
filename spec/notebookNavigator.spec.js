'use strict';
const fs = require('fs'), vm = require('vm');
const source = fs.readFileSync(require.resolve('../public/static/js/notebook-navigator.js'), 'utf8');
function element() {
  return { children: [], events: {}, attrs: {}, hidden: false, textContent: '',
    append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; },
    setAttribute(key, value) { this.attrs[key] = value; }, addEventListener(key, callback) { this.events[key] = callback; } };
}
function harness() {
  const ids = Object.fromEntries(['notebook-modal', 'notebook-navigator', 'notebook-navigator-items', 'notebook-navigator-status', 'notebook-navigator-more'].map(id => [id, element()]));
  let expanded = true, visible = true, current = { source_key: 'item:1' };
  const dialog = { classList: { contains: () => expanded } };
  ids['notebook-modal'].classList = { contains: () => visible };
  ids['notebook-modal'].querySelector = () => dialog;
  const document = { getElementById: id => ids[id], createElement: element, events: {}, addEventListener(key, callback) { this.events[key] = callback; } };
  const ctx = vm.createContext({ window: {}, document, MutationObserver: class { observe() {} } });
  vm.runInContext(source, ctx);
  const api = jest.fn(), open = jest.fn(async note => { current = note; });
  const controls = ctx.window.NotebookNavigator.install({ api, open, context: () => current });
  return { ids, api, open, controls, document, show: () => ids['notebook-modal'].events['shown.bs.modal'](),
    collapse: () => { expanded = false; ids['notebook-modal'].events['shown.bs.modal'](); },
    labels: () => ids['notebook-navigator-items'].children.map(li => li.children[0].children[1].textContent),
    buttons: () => ids['notebook-navigator-items'].children.map(li => li.children[0]) };
}
const note = (key, date) => ({ source_key: key, title: key, updated_at: date, version: 1 });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
test('loads only maximized notes, sorts by recency and marks the current note', async () => {
  const h = harness(); h.collapse(); expect(h.api).not.toHaveBeenCalled();
  const recent = harness(); recent.api.mockResolvedValue({ notes: [note('general', '2026-09-22'), note('item:1', '2026-10-10')], hasMore: false });
  recent.show(); await settle();
  expect(recent.labels()).toEqual(['item:1', 'general']);
  expect(recent.buttons()[0].attrs['aria-current']).toBe('page');
  await recent.buttons()[1].events.click();
  expect(recent.open).toHaveBeenCalledWith(expect.objectContaining({ source_key: 'general' }));
  expect(recent.buttons()[1].attrs['aria-current']).toBe('page');
});
test('loads older pages and reorders edits without duplicating notes', async () => {
  const h = harness(); h.api.mockResolvedValueOnce({ notes: [note('item:1', '2026-10-10')], hasMore: true });
  h.show(); await settle();
  h.api.mockResolvedValueOnce({ notes: [note('general', '2026-09-22')], hasMore: false });
  await h.ids['notebook-navigator-more'].events.click();
  expect(h.api).toHaveBeenLastCalledWith('?offset=1');
  h.controls.update(note('general', '2026-10-11'));
  expect(h.labels()).toEqual(['general', 'item:1']);
  h.controls.update({ source_key: 'general', version: 0 });
  expect(h.labels()).toEqual(['item:1']);
});
test('account changes clear private notes and discard stale requests', async () => {
  const h = harness(); let resolve;
  h.api.mockReturnValueOnce(new Promise(done => { resolve = done; })); h.show();
  h.api.mockResolvedValueOnce({ notes: [note('item:2', '2026-10-10')], hasMore: false });
  h.document.events.hadithAuthChanged();
  resolve({ notes: [note('general', '2026-09-22')], hasMore: false }); await settle();
  expect(h.labels()).toEqual(['item:2']);
});
test('failed loads expose a retry without skipping the first page', async () => {
  const h = harness(); h.api.mockRejectedValueOnce(new Error('Reconnect Drive'));
  h.show(); await settle(); expect(h.ids['notebook-navigator-status'].textContent).toBe('Reconnect Drive');
  h.api.mockResolvedValueOnce({ notes: [note('general', '2026-09-22')], hasMore: false });
  await h.ids['notebook-navigator-more'].events.click();
  expect(h.api).toHaveBeenLastCalledWith('?offset=0'); expect(h.labels()).toEqual(['general']);
});
