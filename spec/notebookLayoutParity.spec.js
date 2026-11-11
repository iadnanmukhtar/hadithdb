'use strict';
const fs=require('fs'),path=require('path'),ejs=require('ejs'),{chromium}=require('playwright');
const Notebook=require('../lib/UserNotebook'),Frontmatter=require('../lib/NotebookFrontmatter');
const sample='# List spacing\n\nAn introduction.\n\n- First bullet\n- Second bullet\n\n- **Third bullet** with العربية\n- Parent bullet\n  - Nested bullet\n  - Another nested bullet\n\n## Ordered list\n\n1. First\n\n2. Second\n\n> A quotation\n>\n> -# Supporting text\n\nClosing paragraph.';
let browser,server,origin;
beforeAll(async()=>{
 server=require('http').createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname.startsWith('/static/')){res.setHeader('Content-Type',pathname.endsWith('.css')?'text/css':'font/woff2');res.end(fs.readFileSync(path.join(__dirname,'../public',pathname)));}
 else{res.setHeader('Content-Type','text/html');res.end('<!doctype html>');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true});});
afterAll(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
test('preview, formatted editing and print share compact list geometry',async()=>{
 const markdown=process.env.NOTE_PARITY_SOURCE?fs.readFileSync(process.env.NOTE_PARITY_SOURCE,'utf8'):sample;
 const body=Frontmatter.parse(markdown).body,html=Notebook.render(markdown);
 const page=await browser.newPage({viewport:{width:1000,height:1000}});
 try{
  await page.goto(origin+'/notebook');
  const modal=await ejs.renderFile('views/sub-views/notebook_modal.ejs',{utils:{scriptAssetVersion:()=>''}});
  const modalStyles=[...modal.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
  await page.setContent(`<style>html{font-size:16px}body{margin:0}p{margin-top:0;margin-bottom:1rem}</style><div id="notebook-surface"><section id="notebook-preview" class="notebook-markdown">${html}</section><textarea data-short-editor id="editor"></textarea></div>`);
  for(const css of ['style','community','markdown-content'])await page.addStyleTag({path:'public/static/css/'+css+'.css'});
  await page.addStyleTag({content:modalStyles+'\nhtml{font-size:16px!important}#notebook-surface{display:block;width:752px;margin:auto}#notebook-preview,.community-rich-input{box-sizing:border-box;width:752px!important;max-height:none!important;overflow:visible!important;height:auto!important}'});
  await page.addScriptTag({path:'node_modules/marked/lib/marked.umd.js'});
  for(const js of ['notebook-shortcuts','notebook-wiki','community-parallel-text','community-short-editor','notebook-print'])await page.addScriptTag({path:'public/static/js/'+js+'.js'});
  await page.exposeFunction('previewMarkdown',text=>Notebook.render(text));
  await page.evaluate(body=>{const source=document.querySelector('#editor');source.value=body;CommunityShortEditor.setPreviewRenderer(source,previewMarkdown);CommunityShortEditor.get(source).toFormatted();},body);
  await page.evaluate(()=>document.fonts.ready);
  const measure=el=>[...el.querySelectorAll('li')].map(li=>({text:li.textContent.replace(/\s+/g,' ').trim(),height:li.getBoundingClientRect().height,pMargin:li.querySelector(':scope > p')?getComputedStyle(li.querySelector(':scope > p')).marginBottom:'0px'}));
  const preview=await page.locator('#notebook-preview').evaluate(measure),editing=await page.locator('.community-rich-input').evaluate(measure);
  expect(editing.length).toBe(preview.length);
  for(let i=0;i<preview.length;i++){
   expect(preview[i].pMargin).toBe('0px');expect(editing[i].pMargin).toBe('0px');
   expect(Math.abs(preview[i].height-editing[i].height)).toBeLessThan(1);
  }
  await page.locator('.community-short-editor').evaluate(el=>el.hidden=true);
  await page.screenshot({path:'/tmp/note-parity-preview.png'});
  await page.locator('#notebook-preview').evaluate(el=>el.hidden=true);
  await page.locator('.community-short-editor').evaluate(el=>el.hidden=false);
  await page.screenshot({path:'/tmp/note-parity-editing.png'});
  await page.evaluate(()=>{const open=window.open.bind(window);window.open=(...args)=>{const popup=open(...args);popup.print=()=>{popup.didPrint=true;};return popup;};});
  const pending=page.context().waitForEvent('page');
  const printed=page.evaluate(({html,title})=>NotebookPrint.open({title},async()=>({html}),()=>true),{html,title:Frontmatter.parse(markdown).attributes.title || 'Notebook layout verification'});
  const popup=await pending;
  await printed;
  await popup.waitForFunction(()=>window.didPrint);
  const print=await popup.locator('article').evaluate(measure);
  const typography=el=>{const style=getComputedStyle(el);return {font:style.fontSize,line:style.lineHeight,color:style.color,link:el.querySelector('a')?getComputedStyle(el.querySelector('a')).color:null};};
  expect(await popup.locator('article').evaluate(typography)).toEqual(await page.locator('.community-rich-input').evaluate(typography));
  expect(print.length).toBe(preview.length);
  for(let i=0;i<preview.length;i++){
   expect(print[i].pMargin).toBe('0px');expect(Math.abs(preview[i].height-print[i].height)).toBeLessThan(1);
  }
  await popup.pdf({path:'/tmp/note-parity.pdf',format:'A4',printBackground:true,preferCSSPageSize:true});
  console.log(`Verified ${preview.length} list items across preview, editing and PDF layout`);
 }finally{await page.context().close();}
},30000);
