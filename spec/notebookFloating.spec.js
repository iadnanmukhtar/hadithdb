'use strict';
const fs = require('fs'), vm = require('vm');
const source = fs.readFileSync(require.resolve('../public/static/js/notebook.js'), 'utf8');
const functions = ['rememberFloating', 'minimizeFloating', 'restoreFloating'].map(name => source.match(new RegExp(`  (?:async )?function ${name}\\([^]*?\\n  }`))[0]).join('\n');
function harness() {
  const classes = new Set(['notebook-floating']);
  const storage = new Map();
  const ctx = vm.createContext({
    current: {source_key:'item:42',source_title:'bukhari:1',source_url:'/bukhari:1',markdown:'Private contents'},
    floatingOwner:'alice', floatingStorage:'floating', restoringFloating:false, pendingFloating:false,
    modal:{classList:{contains:name=>classes.has(name),toggle:(name,yes)=>yes?classes.add(name):classes.delete(name)}},
    restoreButton:{hidden:true,focus:jest.fn()},editor:{focus:jest.fn()},
    sessionStorage:{setItem:(key,value)=>storage.set(key,value),getItem:key=>storage.get(key)},
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
