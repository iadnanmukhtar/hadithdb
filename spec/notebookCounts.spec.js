'use strict';
const fs = require('fs'), vm = require('vm');
const source = fs.readFileSync(require.resolve('../public/static/js/notebook.js'), 'utf8');
const functions = ['renderCreationCount', 'clearCreationCount', 'loadCreationCount'].map(name => source.match(new RegExp(`  (?:async )?function ${name}\\([^]*?\\n  }`))[0]).join('\n');
function harness() {
  const context = vm.createContext({ createdCount: { hidden: true, textContent: '' }, lifetimeCreated: null, statsRequest: 0, api: jest.fn() });
  vm.runInContext(functions, context); return context;
}
test('lifetime display does not decrease when an older stats response arrives', () => {
  const ctx = harness();
  ctx.renderCreationCount(0); expect(ctx.createdCount.textContent).toBe('0 notes created');
  ctx.renderCreationCount(1); expect(ctx.createdCount.textContent).toBe('1 note created');
  ctx.renderCreationCount(2); ctx.renderCreationCount(1);
  expect(ctx.createdCount.textContent).toBe('2 notes created');
  expect(ctx.createdCount.hidden).toBe(false);
  ctx.renderCreationCount(undefined); expect(ctx.createdCount.textContent).toBe('2 notes created');
});
test('sign-out clears the total and invalidates in-flight responses', async () => {
  const ctx = harness(); let resolve;
  ctx.renderCreationCount(12);
  ctx.api.mockReturnValue(new Promise(done => { resolve = done; }));
  const pending = ctx.loadCreationCount(); ctx.clearCreationCount();
  resolve({ lifetime_created: 13 }); await pending;
  expect(ctx.createdCount.hidden).toBe(true); expect(ctx.createdCount.textContent).toBe('');
  ctx.renderCreationCount(1); expect(ctx.createdCount.textContent).toBe('1 note created');
});
