'use strict';
const fs = require('fs'), vm = require('vm');
const source = fs.readFileSync(require.resolve('../public/static/js/notebook.js'), 'utf8');
const functions = ['persistFloating', 'clearFloating', 'rememberFloating', 'minimizeFloating', 'restoreFloating'].map(name => source.match(new RegExp(`  (?:async )?function ${name}\\([^]*?\\n  }`))[0]).join('\n');
function harness() {
  const classes = new Set(['notebook-floating']);
  const storage = new Map();
  const ctx = vm.createContext({
    current: {source_key:'item:42',source_title:'bukhari:1',source_url:'/bukhari:1',markdown:'Private contents'},
    floatingOwner:'alice', floatingStorage:'floating', restoringFloating:false, pendingFloating:false,
    floatingWrite:Promise.resolve(), floatingRevision:0, api:jest.fn(async()=>({uid:'alice'})),
    modal:{classList:{contains:name=>classes.has(name),toggle:(name,yes)=>yes?classes.add(name):classes.delete(name)}},
    restoreButton:{hidden:true,focus:jest.fn()},editor:{focus:jest.fn()},
    sessionStorage:{setItem:(key,value)=>storage.set(key,value),getItem:key=>storage.get(key),removeItem:key=>storage.delete(key)},
    window:{hadithAuth:{getUser:async()=>({uid:'alice'})}},location:{search:''},URLSearchParams,
    open:jest.fn(async()=>{}), configureFloating:jest.fn()
  });
  vm.runInContext(functions,ctx);
  return {ctx,storage,classes};
}
test('minimize and restore preserve the active note without saving its contents in browser storage',()=>{
  const {ctx,storage,classes}=harness();
  ctx.minimizeFloating(true);
  expect(classes.has('notebook-minimized')).toBe(true);
  expect(ctx.restoreButton.hidden).toBe(false);
  expect(JSON.parse(storage.get('floating'))).toMatchObject({uid:'alice',minimized:true,source:{source_key:'item:42',markdown:''}});
  expect(storage.get('floating')).not.toContain('Private contents');
  ctx.minimizeFloating(false);
  expect(ctx.restoreButton.hidden).toBe(true);
  expect(ctx.current.markdown).toBe('Private contents');
});
test('navigation keeps a minimized note unloaded until explicitly restored',async()=>{
  const {ctx}=harness(); ctx.minimizeFloating(true);
  await ctx.restoreFloating();
  expect(ctx.open).not.toHaveBeenCalled();
  expect(ctx.configureFloating).not.toHaveBeenCalled();
  expect(ctx.restoreButton.hidden).toBe(false);
  expect(ctx.pendingFloating).toBe(true);
  await ctx.restoreFloating(true);
  expect(ctx.open).toHaveBeenCalledWith(expect.objectContaining({source_key:'item:42'}),true);
  expect(ctx.configureFloating).toHaveBeenCalledWith(true);
  expect(ctx.restoreButton.hidden).toBe(true);
  expect(ctx.pendingFloating).toBe(false);
});
test('a different account cannot restore the previous account floating note',async()=>{
  const {ctx}=harness(); ctx.rememberFloating();
  ctx.window.hadithAuth.getUser=async()=>({uid:'bob'});
  await ctx.restoreFloating();
  expect(ctx.open).not.toHaveBeenCalled();
});

test.each([true, false])('a fresh domain restores account state (minimized=%s) without local storage', async minimized => {
  const {ctx, storage} = harness();
  ctx.api.mockResolvedValue({uid:'alice', floating:{source:{source_key:'item:99',source_title:'muslim:1',source_url:'/muslim:1'},minimized}});
  await ctx.restoreFloating();
  if (minimized) {
    expect(ctx.open).not.toHaveBeenCalled();
    expect(ctx.restoreButton.hidden).toBe(false);
  } else expect(ctx.open).toHaveBeenCalledWith(expect.objectContaining({source_key:'item:99'}),true);
});
test('a cleared account state overrides an old domain session', async () => {
  const {ctx} = harness(); ctx.rememberFloating(); await ctx.floatingWrite;
  ctx.api.mockResolvedValue({uid:'alice',floating:null});
  await ctx.restoreFloating();
  expect(ctx.open).not.toHaveBeenCalled();
});
test('pin, minimize and close writes are ordered and never contain note text', async () => {
  const {ctx} = harness();
  ctx.rememberFloating(); ctx.minimizeFloating(true); ctx.clearFloating();
  await ctx.floatingWrite;
  expect(ctx.api.mock.calls.map(call=>call[2].floating?.minimized)).toEqual([false,true,undefined]);
  expect(ctx.api).toHaveBeenLastCalledWith('/floating','PUT',{floating:null});
  expect(JSON.stringify(ctx.api.mock.calls)).not.toContain('Private contents');
});
test('a late restore cannot reopen a note after a local presentation change', async () => {
  const {ctx} = harness(); let resolve;
  ctx.api.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  const restoring = ctx.restoreFloating();
  while (!resolve) await new Promise(r=>setImmediate(r));
  ctx.floatingRevision++;
  resolve({uid:'alice',floating:{source:{source_key:'item:99'},minimized:false}});
  await restoring;
  expect(ctx.open).not.toHaveBeenCalled();
});
