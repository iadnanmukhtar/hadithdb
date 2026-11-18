'use strict';
const fs=require('fs'),path=require('path'),ejs=require('ejs');
const {JSDOM,VirtualConsole}=require('jsdom');
const template=path.join(__dirname,'../views/sub-views/book_toc_editor.ejs');
const script=fs.readFileSync(path.join(__dirname,'../public/static/js/book-toc-editor.js'),'utf8');
const render=(editMode=true,virtual=0)=>ejs.render(fs.readFileSync(template,'utf8'),{site:{editMode},book:{id:7,alias:'example',type:'hadith',virtual},utils:{staticAssetUrl:x=>x}});
const headings=[{id:1,level:1,h1:1,title_en:'First'},{id:2,level:2,h1:1,h2:1,title_en:'Section'},{id:3,level:3,h1:1,h2:1,h3:1,title_en:'Subsection'},{id:4,level:1,h1:2,title_en:'Second'}];
const table=()=>`<table id="toc"><tbody>${headings.map(h=>`<tr data-toc-edit-id="${h.id}" data-toc-edit-level="${h.level}" data-toc-edit-h1="${h.h1}" data-toc-edit-h2="${h.h2||''}"><td>${h.h1}</td><td><a data-prop="toc.title_en">${h.title_en}</a></td><td lang="ar">عنوان</td></tr>`).join('')}</tbody></table>`;
const flush=()=>new Promise(resolve=>setTimeout(resolve,10));
let dom;
afterEach(()=>dom?.window.close());
async function setup(virtual=0) {
 dom=new JSDOM(render(true,virtual)+table(),{runScripts:'outside-only',url:'http://localhost',virtualConsole:new VirtualConsole()});
 const state={book:{id:7,alias:'example',virtual},revision:'r1',headings,items:[{id:10,tocId:2,num:'12',ordinal:1,num0:12},{id:11,tocId:2,num:'13',ordinal:2,num0:13}]};
 dom.window.hadithAuth={getToken:async()=>'admin-token'};
 dom.window.fetch=jest.fn(async(url,options)=>({ok:true,text:async()=>JSON.stringify(options.method==='GET'?state:{code:200})}));
 dom.window.eval(script);
 return {window:dom.window,$:s=>dom.window.document.querySelector(s),state};
}
function post(window) {return JSON.parse(window.fetch.mock.calls.find(([,options])=>options.method==='POST')[1].body);}
test('controls are absent outside admin edit mode',()=>{expect(render(false).trim()).toBe('');});
test('actions appear alongside each existing title and H1 creation is inline at the end',async()=>{
 const {$}=await setup();
 expect($('details')).toBeNull();expect($('[data-toc-heading]')).toBeNull();
 for(const h of headings) expect($(`[data-toc-edit-id="${h.id}"] [data-toc-action="delete"]`)).not.toBeNull();
 expect($('[data-toc-inline="add-root"] input[name="title_en"]').placeholder).toBe('New chapter heading');
 expect($('[data-toc-edit-id="1"] [data-toc-action="heading-up"]').disabled).toBe(true);
 expect($('[data-toc-edit-id="4"] [data-toc-action="heading-up"]').disabled).toBe(false);
});
test.each([[1,2],[2,3]])('plus on heading %s opens an inline H%s form under its subtree',async(id,level)=>{
 const {window,$}=await setup();$(`[data-toc-edit-id="${id}"] [data-toc-action="add-child"]`).click();await flush();
 const tr=$(`[data-toc-inline="add-${id}"]`),form=tr.querySelector('form');
 expect(tr.previousElementSibling.dataset.tocEditId).toBe('3');
 expect(form.dataset.tocAdd).toBe(String(level));expect(form.querySelector('select')).toBeNull();
 form.elements.title_en.value='New heading';form.dispatchEvent(new window.Event('submit',{cancelable:true}));await flush();
 expect(post(window)).toMatchObject({action:'add',level,parentId:String(id),title_en:'New heading',revision:'r1'});
});
test('arrows act on their own heading without a separate selector',async()=>{
 const {window,$}=await setup();$('[data-toc-edit-id="4"] [data-toc-action="heading-up"]').click();await flush();
 expect(post(window)).toEqual({action:'moveHeading',id:'4',direction:'up',revision:'r1'});
});
test('trash confirms deletion of its own heading',async()=>{
 const {window,$}=await setup();window.confirm=jest.fn(()=>true);
 $('[data-toc-edit-id="3"] [data-toc-action="delete"]').click();await flush();
 expect(window.confirm).toHaveBeenCalled();expect(post(window)).toMatchObject({action:'delete',id:'3'});
});
test('contextual items can move to another heading',async()=>{
 const {window,$}=await setup();$('[data-toc-edit-id="2"] [data-toc-action="items"]').click();await flush();
 const item=$('[data-toc-item="10"]'),select=item.querySelector('select');select.value='4';select.dispatchEvent(new window.Event('change'));
 item.querySelector('[data-toc-action="assign"]').click();await flush();
 expect(post(window)).toEqual({action:'assign',id:10,headingId:'4',revision:'r1'});
});
test('virtual books hide heading and item ordering but retain delete/add/reassignment',async()=>{
 const {$}=await setup(1);
 expect($('[data-toc-action="heading-up"]')).toBeNull();expect($('[data-toc-action="add-child"]')).not.toBeNull();
 $('[data-toc-edit-id="2"] [data-toc-action="items"]').click();await flush();
 expect($('[data-toc-action="item-up"]')).toBeNull();expect($('[data-toc-action="assign"]')).not.toBeNull();
});
test('a failed save retains entered titles and reports its error beside the form',async()=>{
 const {window,$}=await setup();$('[data-toc-edit-id="1"] [data-toc-action="add-child"]').click();await flush();
 window.fetch.mockImplementation(async()=>({ok:false,text:async()=>JSON.stringify({message:'The TOC changed'})}));
 const tr=$('[data-toc-inline="add-1"]'),form=tr.querySelector('form');form.elements.title_en.value='New heading';
 form.dispatchEvent(new window.Event('submit',{cancelable:true}));await flush();
 expect(form.elements.title_en.value).toBe('New heading');expect(tr.querySelector('[data-toc-status]').textContent).toBe('The TOC changed');
 expect(form.elements.title_en.disabled).toBe(false);
});
test('large heading item lists render bounded pages and support reference filtering',async()=>{
 const {window,$,state}=await setup();state.items=Array.from({length:60},(_,i)=>({id:i+10,tocId:2,num:String(i+1),ordinal:i}));
 $('[data-toc-edit-id="2"] [data-toc-action="items"]').click();await flush();
 expect(dom.window.document.querySelectorAll('[data-toc-item]')).toHaveLength(25);
 $('[data-toc-action="next-items"]').click();expect($('[data-toc-item]').dataset.tocItem).toBe('35');
 const search=$('[data-toc-inline="items-2"] input');search.value='60';search.dispatchEvent(new window.Event('input'));
 expect(dom.window.document.querySelectorAll('[data-toc-item]')).toHaveLength(1);
});
