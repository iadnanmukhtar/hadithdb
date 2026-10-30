const fs=require('fs');
const {JSDOM}=require('jsdom');
const script=fs.readFileSync('public/static/js/community-article-toc.js','utf8');
function setup(html){const dom=new JSDOM('<div data-article-body>'+html+'</div><aside class="community-aside"><section id="community-contributors">Contributors</section></aside>',{url:'https://example.test/article',runScripts:'outside-only',pretendToBeVisual:true});return dom;}
test('uses heading hierarchy and unique links while preserving authored anchors',()=>{
 const dom=setup('<nav><h2>Contents</h2></nav><h2 id="intro">Introduction</h2><h3>العربية</h3><h2>Introduction</h2><h2>Introduction</h2>');try{
 dom.window.eval(script);const d=dom.window.document,links=[...d.querySelectorAll('nav.community-article-toc a')];
 expect(links.map(a=>a.textContent)).toEqual(['Introduction','العربية','Introduction','Introduction']);
 expect(new Set(links.map(a=>a.hash)).size).toBe(4);expect(links[0].hash).toBe('#intro');expect(links[1].parentNode.style.getPropertyValue('--toc-depth')).toBe('1');expect(d.querySelector('#community-contributors')).toBeNull();
 }finally{dom.window.close();}
});
test('leaves contributors intact without article headings',()=>{const dom=setup('<p>Reflection</p><nav><h2>Contents</h2></nav>');try{dom.window.eval(script);expect(dom.window.document.querySelector('#community-contributors').textContent).toBe('Contributors');expect(dom.window.document.querySelector('.community-article-toc')).toBeNull();}finally{dom.window.close();}});
test('tracks the current heading as the document scrolls',async()=>{
 const dom=setup('<h2>First</h2><h2>Second</h2>');try{
 const w=dom.window,headings=w.document.querySelectorAll('[data-article-body] h2');let second=500;
 headings[0].getBoundingClientRect=()=>({top:-100});headings[1].getBoundingClientRect=()=>({top:second});
 w.eval(script);expect(w.document.querySelector('[aria-current]').textContent).toBe('First');second=20;w.dispatchEvent(new w.Event('scroll'));await new Promise(r=>w.setTimeout(r,30));expect(w.document.querySelector('[aria-current]').textContent).toBe('Second');
 }finally{dom.window.close();}
});
