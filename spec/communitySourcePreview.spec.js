'use strict';
const Source=require('../lib/CommunitySourcePreview');
const Media=require('../lib/CommunityMedia');
let previous,fetchSource;
beforeEach(()=>{
 fetchSource=jest.spyOn(Media,'fetchHtml').mockRejectedValue(Error('Offline source preview'));
 previous={settings:global.settings,books:global.books,surahs:global.surahs,query:global.query};
 global.settings={site:{url:'https://hadithunlocked.com',quranUrl:'https://quranunlocked.com'}};
 global.books=[{id:1,alias:'bukhari',shortName_en:'Bukhari',type:'hadith'},{id:61,alias:'riyad',shortName_en:'Riyad',virtual:1}];
 global.surahs=[{num:2,name_en:'Baqarah'}];global.query=jest.fn(async()=>[]);
});
afterEach(()=>{fetchSource.mockRestore();Object.assign(global,previous);});
test('Bukhari 1 gets its stored title, readable source excerpt, and the actual site icon',async()=>{
 global.query.mockResolvedValue([{title_en:'Actions depend on intentions',body_en:'I heard the Messenger say: **"Deeds are judged by intentions."** [^1]\n\n[^1]: Footnote apparatus'}]);
 const result=await Media.preview('https://hadithunlocked.com/bukhari:1');
 expect(result.title).toBe('Bukhari 1 — Actions depend on intentions');
 expect(result.description).toContain('Deeds are judged by intentions.');
 expect(result.description).not.toMatch(/\*\*|\[\^1\]|Footnote apparatus/);
 expect(result.image).toBe('/static/img/apple-touch-icon.png');
 expect(result.imageKind).toBe('icon');
 expect(result.source).toBe(true);
 expect(global.query.mock.calls[0][0]).toMatch(/FROM v_hadiths WHERE book_alias='bukhari' AND num='1'/);
});
test('untitled hadith uses its page title and a translated excerpt with citation',async()=>{
 const words='A person receives the reward for the intention behind the action. ';
 global.query.mockResolvedValue([{title_en:'…',body_en:'The narrator reported: "'+words.repeat(10)+'"'}]);
 const result=await Source.enrich('https://hadithunlocked.com/bukhari:1');
 expect(result.title).toBe('Bukhari 1');
 expect(result.description.length).toBeLessThanOrEqual(380);
 expect(result.description.endsWith('…')).toBe(true);
 expect(result.description).not.toContain('Read Bukhari');
});
test('Quran ranges use ordered source text and preserve the range identity',async()=>{
 global.query.mockResolvedValue([{body_en:'First ayah.'},{body_en:'Second ayah.'}]);
 const result=await Source.enrich('https://quranunlocked.com/quran/2:255-257');
 expect(result.title).toBe('Baqarah 2:255-257');
 expect(result.description).toBe('Baqarah 2:255-257: First ayah. Second ayah.');
 expect(global.query.mock.calls[0][0]).toContain("num IN ('2:255', '2:256', '2:257')");
});
test('virtual references read their own snapshot and use site branding',async()=>{
 global.books[1].properties={cover:'/static/img/riyad-cover.jpg'};
 global.query.mockResolvedValue([{body_en:'The stored virtual-book text.'}]);
 const result=await Source.enrich('https://hadithunlocked.com/riyad:1');
 expect(global.query.mock.calls[0][0]).toContain('FROM v_hadiths_virtual_snapshot');
 expect(result.image).toBe('/static/img/apple-touch-icon.png');
});
test('missing source metadata still returns a complete reference card without scraping',async()=>{
 global.query.mockRejectedValue(Error('Source unavailable'));
 const result=await Source.enrich('https://hadithunlocked.com/bukhari:1');
 expect(result).toMatchObject({title:'Bukhari 1',source:true});
 expect(result.description).toBeTruthy();expect(result.image).toBeTruthy();
 expect(Source.preview('https://evil.example/bukhari:1')).toBeNull();
});
test('external pages fall back to Twitter metadata, article paragraphs, and a representative image',()=>{
 const result=Media.metadata('<title>Article title</title><main><nav>Ignore navigation</nav><p>This is the first useful paragraph of the article, long enough to be an informative summary.</p><img src="/article-cover.jpg"></main>','https://example.com/story');
 expect(result.title).toBe('Article title');expect(result.description).toContain('first useful paragraph');expect(result.description).not.toContain('navigation');expect(result.image).toBe('https://example.com/article-cover.jpg');
 expect(Media.metadata('<meta name="twitter:title" content="Twitter title"><meta name="twitter:description" content="Twitter summary"><meta name="twitter:image" content="https://example.com/card.jpg">','https://example.com')).toEqual({title:'Twitter title',description:'Twitter summary',image:'https://example.com/card.jpg'});
});

test('source enrichment is lazy and does not run as part of publishing Markdown',async()=>{
 const result=await Media.prepare('https://hadithunlocked.com/bukhari:1');
 expect(result.html).toContain('community-link-preview');
 expect(global.query).not.toHaveBeenCalled();
});

test.each(['/riyad','/riyad/','/riyad?view=chapters'])('collection URL %s has its catalog title, summary, and thumbnail even with old generic preview data',async path=>{
 global.books[1]={...global.books[1],name_en:'Riyad al-Salihin',description:'A collection of hadith arranged by topics for daily practice.'};
 const Community=require('../lib/Community');
 const ensure=jest.spyOn(Community,'ensure').mockRejectedValue(Error('The generic cache path must not be used'));
 try {
  const data=await Media.preview('https://hadithunlocked.com'+path,true);
  expect(data.title).toBe('Riyad al-Salihin');
  expect(data.description).toBe('A collection of hadith arranged by topics for daily practice.');
  expect(data.image).toBe('/static/img/apple-touch-icon.png');
  expect(data.source).toBe(true);expect(ensure).not.toHaveBeenCalled();
 }finally{ensure.mockRestore();}
});
test('collection fallback reads its stored introduction and still supplies artwork without a summary',async()=>{
 global.books[1].name_en='Riyad al-Salihin';
 global.query.mockResolvedValue([{intro_en:'Stored collection introduction.'}]);
 const data=await Source.enrich('https://hadithunlocked.com/riyad');
 expect(data.title).toBe('Riyad al-Salihin');expect(data.description).toBe('Stored collection introduction.');expect(data.image).toBeTruthy();
 global.query.mockResolvedValue([]);
 const empty=await Source.enrich('https://hadithunlocked.com/riyad');expect(empty.title).toBe('Riyad al-Salihin');expect(empty.description).toBeTruthy();expect(empty.image).toBeTruthy();
});

test('any published link stays lazy while external fallback thumbnails are safe and available',async()=>{
 const Community=require('../lib/Community');const ensure=jest.spyOn(Community,'ensure').mockRejectedValue(Error('No metadata work during publishing'));
 try{const rendered=await Media.prepare('https://example.com/article-without-metadata');expect(rendered.html).toContain('community-link-preview');expect(ensure).not.toHaveBeenCalled();}finally{ensure.mockRestore();}
});
test.each(['missing','hostname-only'])('public GET previews enrich %s cache entries instead of returning only a hostname',async state=>{
 const Community=require('../lib/Community');const ensure=jest.spyOn(Community,'ensure').mockResolvedValue();const sql=jest.spyOn(Community,'sql').mockImplementation(async statement=>statement.startsWith('SELECT')&&state==='hostname-only'?[{title:'example.com',description:'',image:null,updated_at:new Date()}]:[]);
 const https=require('https'),dns=require('dns').promises,{EventEmitter}=require('events');
 const lookup=jest.spyOn(dns,'lookup').mockResolvedValue([{address:'8.8.8.8',family:4}]);
 const get=jest.spyOn(https,'get').mockImplementation((url,options,callback)=>{
   const req=new EventEmitter();req.destroy=()=>req.emit('close');
   setImmediate(()=>{const res=new EventEmitter();res.statusCode=200;res.headers={'content-type':'text/html'};res.resume=()=>{};callback(res);res.emit('data',Buffer.from('<title>Real page title</title><meta name="description" content="A real page summary">'));res.emit('end');req.emit('close');});return req;
 });
 try{
  const data=await Media.preview('https://example.com/story');
  expect(get).toHaveBeenCalled();expect(data.title).toBe('Real page title');expect(data.description).toBe('A real page summary');expect(data.image).toBe('https://example.com/apple-touch-icon.png');
 }finally{get.mockRestore();lookup.mockRestore();sql.mockRestore();ensure.mockRestore();}
});

test('large pages keep their valid metadata within the bounded HTML read',async()=>{
 const Community=require('../lib/Community'),https=require('https'),dns=require('dns').promises,{EventEmitter}=require('events');
 const ensure=jest.spyOn(Community,'ensure').mockResolvedValue(),sql=jest.spyOn(Community,'sql').mockResolvedValue([]);
 const lookup=jest.spyOn(dns,'lookup').mockResolvedValue([{address:'8.8.8.8',family:4}]);
 const destroy=jest.fn();
 const get=jest.spyOn(https,'get').mockImplementation((url,options,callback)=>{
  const req=new EventEmitter();req.destroy=()=>req.emit('close');
  setImmediate(()=>{const res=new EventEmitter();res.statusCode=200;res.headers={'content-type':'text/html'};res.destroy=()=>{destroy();req.emit('close');};res.resume=()=>{};callback(res);res.emit('data',Buffer.from('<title>Large page title</title><meta name="description" content="Valid summary"><meta property="og:image" content="https://example.com/cover.jpg">'+'x'.repeat(600*1024)));});return req;
 });
 try{const result=await Media.preview('https://example.com/large-page');expect(result).toMatchObject({title:'Large page title',description:'Valid summary',image:'https://example.com/cover.jpg'});expect(destroy).toHaveBeenCalled();}
 finally{get.mockRestore();lookup.mockRestore();sql.mockRestore();ensure.mockRestore();}
});

// Generated artwork must be served by the running app, not the shared URL's deployment.
test('generated source thumbnails use the current app origin', async()=>{
 const source=await Source.enrich('https://hadithunlocked.com/riyad');
 expect(source.image).toBe('/static/img/apple-touch-icon.png');
 const local=new URL(source.image,'http://localhost:3000');
 expect(local.origin).toBe('http://localhost:3000');
 expect(require('fs').existsSync(require('path').join(__dirname,'../public',source.image))).toBe(true);
 const quran=await Source.enrich('https://quranunlocked.com/quran/2:255');
 expect(quran.image).toBe('/static/img/quran-apple-touch-icon.png');
});

test.each(['https://quran.islamunlocked.com/quran:28:24','https://quran.islamunlocked.com/28:24'])('canonical Quran URL %s uses its translation and full citation',async url=>{
 global.surahs.push({num:28,name_en:'Al-Qasas'});
 global.query.mockResolvedValue([{title_en:'Moses prays for goodness',body_en:'My Lord, I am in need of whatever good You send down to me.'}]);
 const data=await Media.preview(url);
 expect(data.title).toBe('Al-Qasas 28:24 — Moses prays for goodness');
 expect(data.description).toBe('Al-Qasas 28:24: My Lord, I am in need of whatever good You send down to me.');
 expect(data.image).toBe('/static/img/quran-apple-touch-icon.png');
});
test('hadith uses the full book name and number in its translated summary',async()=>{
 global.books[0].name_en='Sahih al-Bukhari';
 global.query.mockResolvedValue([{body_en:'Actions depend on intentions.'}]);
 const data=await Media.preview('https://hadithunlocked.com/bukhari:1');
 expect(data.title).toBe('Sahih al-Bukhari 1');
 expect(data.description).toBe('Sahih al-Bukhari 1: Actions depend on intentions.');
 expect(data.image).toBe('/static/img/apple-touch-icon.png');
});

test('explicit Open Graph fields override first-party metadata while missing fields retain source fallbacks',async()=>{
 global.query.mockResolvedValue([{title_en:'Stored title',body_en:'Stored translation.'}]);
 fetchSource.mockResolvedValue({url:'https://hadithunlocked.com/bukhari:1',html:'<meta property="og:title" content="Publisher title"><meta property="og:image" content="/social.png">'});
 const result=await Media.preview('https://hadithunlocked.com/bukhari:1');
 expect(result.title).toBe('Publisher title');
 expect(result.description).toBe('Bukhari 1: Stored translation.');
 expect(result.image).toBe('https://hadithunlocked.com/social.png');
 expect(result.imageKind).toBe('cover');
});
test('Open Graph description wins and invalid images do not replace site branding',async()=>{
 fetchSource.mockResolvedValue({url:'https://hadithunlocked.com/bukhari:1',html:'<meta property="og:description" content="Publisher summary"><meta property="og:image" content="http://127.0.0.1/private">'});
 const result=await Media.preview('https://hadithunlocked.com/bukhari:1');
 expect(result.description).toBe('Publisher summary');
 expect(result.image).toBe('/static/img/apple-touch-icon.png');
});
