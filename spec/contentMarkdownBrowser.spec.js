'use strict';
const fs = require('fs');
jest.setTimeout(15000);
const { chromium } = require('playwright');
const source = fs.readFileSync('views/sub-views/scripts.ejs', 'utf8');
const helpers = source.slice(source.indexOf('const renderMarkdown ='), source.indexOf('const applyHadithRevision ='));
const save = source.slice(source.indexOf('async function changeListener('), source.indexOf('async function update('));
const bind = source.slice(source.indexOf('const bindInlineEditors ='), source.indexOf('const bindHadithGradeSorting ='));
let browser;
beforeAll(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); });
afterAll(async () => browser?.close());
test.each([390, 1000])('admin editor formats, toggles and saves without toolbar blur at %s px', async width => {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  page.setDefaultTimeout(3000);
  page.on('pageerror', error => console.error(error.message));
  try {
    await page.setContent('<style>[hidden]{display:none!important} body{margin:16px}</style><div class="_e content-markdown" lang="en" tabindex="0" data-id="7" data-prop="hadith_virtual.note_en" data-markdown-source="**Original**"><p><strong>Original</strong></p></div><button id="outside">Outside</button>');
    for (const file of ['community.css', 'markdown-content.css']) await page.addStyleTag({ path: 'public/static/css/' + file });
    await page.addScriptTag({ path: 'node_modules/jquery/dist/jquery.js' });
    await page.addScriptTag({ path: 'node_modules/marked/lib/marked.umd.js' });
    for (const file of ['notebook-shortcuts', 'community-parallel-text', 'community-short-editor']) await page.addScriptTag({ path: 'public/static/js/' + file + '.js' });
    await page.addScriptTag({ content: `
      window.renderClientMarkdown = text => marked.parse(text);
      window.editHadithApiPath = path => '/api' + path;
      window.fetch = async (_, options) => ({ ok:true, json:async()=>({html:marked.parse(JSON.parse(options.body).markdown)}) });
      window.updates = [];
      const update = async body => { updates.push(body); return { code:200, value:body.value }; };
      const bindHadithSimilarSearch = () => {}, bindPrimaryNarratorAutocomplete = () => {}, bindSharhTitleAutocomplete = () => {}, bindBilingualMetadataAutocomplete = () => {};
      const prepareInlineContentEditor = el => el.setAttribute('contenteditable','true');
      ${helpers}
      ${save}
      ${bind}
      bindInlineEditors(document);
    ` });
    await page.locator('._e').click();
    const rich = page.locator('.community-rich-input');
    expect(await rich.isVisible()).toBe(true);
    await rich.fill('Changed العربية');
    await rich.press('ControlOrMeta+A');
    await page.getByRole('button', { name: 'Bold', exact: true }).click();
    expect(await page.evaluate(() => updates.length)).toBe(0);
    await page.locator('.community-short-tools .community-editor-mode').click();
    expect(await page.locator('textarea').isVisible()).toBe(true);
    expect(await page.evaluate(() => updates.length)).toBe(0);
    await page.locator('textarea').fill('**Saved**\n\nالعربية');
    await page.locator('.community-short-tools .community-editor-mode').click();
    expect(await rich.isVisible()).toBe(true);
    expect(await page.evaluate(() => updates.length)).toBe(0);
    const box = await rich.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: '/tmp/content-markdown-editor-' + width + '.png' });
    await page.locator('#outside').click();
    await page.waitForFunction(() => updates.length === 1);
    expect(await page.evaluate(() => updates[0].value)).toBe('**Saved**\n\nالعربية');
    expect(await page.locator('._e strong').textContent()).toBe('Saved');
    expect(await page.locator('.community-short-editor').count()).toBe(0);
  } finally { await page.close(); }
});

test('reader typography and inline editing override legacy Arabic sizing without changing the reader scale', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 850 } });
  try {
    const Tafsir = require('../lib/Tafsir');
    const arabic = Tafsir.renderCommentaryText('## عنوان\n\nنص عربي[^١]\n\n[^١]: حاشية', '', 'md');
    await page.setContent(`<main><section class="intro content-markdown" lang="ar" data-prop="toc.intro">${arabic}</section><section class="hadith-sharh-body content-markdown" lang="en"><h2>Heading</h2><p>Paragraph</p></section><section class="intro content-markdown" lang="en" data-prop="toc.intro_en"><div class="community-short-editor"><div class="community-rich-input notebook-markdown"><p>First</p>\n<p>Second</p></div></div></section></main>`);
    for (const name of ['style', 'community', 'markdown-content']) await page.addStyleTag({ path: `public/static/css/${name}.css` });
    const metrics = await page.evaluate(() => {
      const size = selector => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
      return {
        ref: size('.footnote-ref a'), text: size('[lang=ar] p'),
        heading: size('.hadith-sharh-body h2'), paragraph: size('.hadith-sharh-body p'),
        reader: size('[data-prop="toc.intro_en"]'), editor: size('.community-rich-input'),
        whitespace: getComputedStyle(document.querySelector('.community-rich-input')).whiteSpace,
        paragraphGap: parseFloat(getComputedStyle(document.querySelector('.community-rich-input p')).marginBottom)
      };
    });
    expect(metrics.ref).toBeLessThan(metrics.text * .8);
    expect(metrics.heading).toBeGreaterThan(metrics.paragraph);
    expect(metrics.editor).toBeCloseTo(metrics.reader);
    expect(metrics.whitespace).toBe('normal');
    expect(metrics.paragraphGap).toBeLessThan(metrics.paragraph * .5);
  } finally { await page.close(); }
});

test.each(['ar', 'en'])('Arabic honorifics do not expand fixed %s line boxes', async lang => {
  const page = await browser.newPage({ viewport: { width: 390, height: 850 } });
  try {
    await page.route('http://spacing.test/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.startsWith('/static/fonts/')) return route.fulfill({ body: fs.readFileSync(require('path').join(process.cwd(), 'public', pathname)) });
      return route.fulfill({ body: '<!doctype html>', contentType: 'text/html' });
    });
    await page.goto('http://spacing.test/');
    const text = lang === 'ar' ? 'قَالَ رَسُولُ اللَّهِ' : 'The Messenger of Allah';
    const line = lang === 'ar' ? `<span class="notebook-arabic">${text} ﷺ</span>` : `${text} <span class="notebook-arabic">ﷺ</span>`;
    const plainLine = lang === 'ar' ? `<span class="notebook-arabic">${text}</span>` : text;
    await page.setContent(`<main><div class="content-markdown" lang="${lang}"><p dir="${lang === 'ar' ? 'rtl' : 'ltr'}">${line}<br>${plainLine}<br>${line}</p></div></main>`);
    for (const name of ['style', 'community', 'markdown-content']) await page.addStyleTag({ path: `public/static/css/${name}.css` });
    await page.evaluate(() => document.fonts.ready);
    const metrics = await page.locator('p').evaluate(p => {
      const lineHeight = parseFloat(getComputedStyle(p).lineHeight);
      const withHonorific = p.getBoundingClientRect().height;
      const inlineLineHeight = getComputedStyle(p.querySelector('.notebook-arabic')).lineHeight;
      p.querySelectorAll('.notebook-arabic').forEach(n => { n.textContent = n.textContent.replace(/ﷺ/g, ''); });
      return { lineHeight, withHonorific, withoutHonorific: p.getBoundingClientRect().height, inlineLineHeight };
    });
    expect(Math.abs(parseFloat(metrics.inlineLineHeight) - metrics.lineHeight)).toBeLessThan(1);
    expect(Math.abs(metrics.withHonorific - metrics.withoutHonorific)).toBeLessThan(1);
    expect(metrics.withHonorific).toBeLessThan(metrics.lineHeight * 3 + 15);
  } finally { await page.close(); }
});

test('source quotations stay upright and green in reading and formatted editing', async () => {
  const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
  try {
    const markdown = '*The Prophet ﷺ said: حَقُّ المُسْلِمِ عَلَى المُسْلِمِ خَمْسٌ*\n\n_Ordinary italics نص مائل_';
    const html = require('../lib/Utils').markdownToHtml(markdown);
    await page.setContent(`<main class="h"><div class="body content-markdown">${html}</div><textarea data-prophetic-speech></textarea></main>`);
    for (const name of ['style', 'community', 'markdown-content']) await page.addStyleTag({ path: `public/static/css/${name}.css` });
    await page.addScriptTag({ path: 'node_modules/marked/lib/marked.umd.js' });
    for (const name of ['notebook-shortcuts','community-parallel-text','community-short-editor']) await page.addScriptTag({ path: `public/static/js/${name}.js` });
    await page.locator('textarea').fill(markdown);
    await page.evaluate(() => CommunityShortEditor.install(document.querySelector('textarea')));
    for (const scope of ['.body', '.community-rich-input']) {
      for (const selector of ['.source-prophetic-speech', '.source-prophetic-speech .notebook-arabic']) {
        const styles = await page.locator(scope+' '+selector).first().evaluate(el => ({font:getComputedStyle(el).fontStyle,color:getComputedStyle(el).color}));
        expect(styles.font).toBe('normal');
        expect(styles.color).toBe('rgb(27, 123, 0)');
      }
      expect(await page.locator(scope+' .source-italic').evaluate(el => getComputedStyle(el).fontStyle)).toBe('italic');
    }
    await page.screenshot({ path: '/tmp/source-speech-preview.png' });
    await page.locator('.community-short-tools .community-editor-mode').click();
    expect(await page.locator('textarea').inputValue()).toBe(markdown);
    await page.locator('.community-short-tools .community-editor-mode').click();
    const serialized = await page.evaluate(() => CommunityShortEditor.serialize(document.querySelector('.community-rich-input')));
    expect(serialized).toBe(markdown);
  } finally { await page.close(); }
});

test.each([390, 1100])('hadith chain, matn and footer share a proportional bilingual size at %s px', async width => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  try {
    const Utils = require('../lib/Utils');
    await page.route('http://reader.test/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.startsWith('/static/fonts/')) return route.fulfill({ body: fs.readFileSync(require('path').join(process.cwd(), 'public', pathname)) });
      return route.fulfill({ body: '<!doctype html>', contentType: 'text/html' });
    });
    await page.goto('http://reader.test/');
    await page.setContent(`<main>${['en','ar'].map(lang => `<article class="h" lang="${lang}"><span class="chain">${lang === 'ar' ? 'حدثنا أحمد بن سعيد' : 'Ahmad b. Said narrated'}</span><section class="body"><div class="hadith-body-content content-markdown">${Utils.markdownToHtml(lang === 'ar' ? '*قال رسول الله ﷺ*' : '*The Prophet ﷺ said*')}</div></section><footer class="footnote content-markdown">${Utils.markdownToHtml(lang === 'ar' ? 'تابعه معمر' : 'Also narrated by Mamar')}</footer></article>`).join('')}<section class="tafsir-only-page">${['en','ar'].map(lang => `<div class="quran-tafsir-text content-markdown" lang="${lang}">${Utils.markdownToHtml(lang === 'ar' ? 'تفسير الآية الكريمة' : 'Explanation of the verse')}</div>`).join('')}</section></main>`);
    for (const name of ['style','community','markdown-content']) await page.addStyleTag({ path: `public/static/css/${name}.css` });
    for (const scale of [1, 1.25]) {
      await page.evaluate(scale => document.documentElement.style.setProperty('--content-font-scale',scale), scale);
      const sizes = await page.evaluate(() => {
        const size = selector => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
        return Object.fromEntries(['ar','en'].map(lang => [lang, {
          chain:size(`.h[lang=${lang}] .chain`),
          matn:size(`.h[lang=${lang}] .hadith-body-content ${lang==='ar'?'.notebook-arabic':'p'}`),
          footer:size(`.h[lang=${lang}] footer ${lang==='ar'?'.notebook-arabic':'p'}`),
          tafsir:size(`.quran-tafsir-text[lang=${lang}] ${lang==='ar'?'.notebook-arabic':'p'}`)
        }]));
      });
      for (const lang of ['ar','en']) {
        expect(sizes[lang].matn).toBeCloseTo(sizes[lang].chain);
        expect(sizes[lang].footer).toBeCloseTo(sizes[lang].chain);
        expect(sizes[lang].tafsir).toBeCloseTo(sizes[lang].chain);
      }
      expect(sizes.en.matn / sizes.ar.matn).toBeCloseTo(9/13);
    }
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `/tmp/source-reader-size-${width}.png` });
  } finally { await page.close(); }
});

test.each([390, 1100])('Arabic chain, matn and footer keep equal line boxes with honorifics at %s px', async width => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  try {
    await page.route('http://line-height.test/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      return pathname.startsWith('/static/fonts/')
        ? route.fulfill({ body: fs.readFileSync(require('path').join(process.cwd(), 'public', pathname)) })
        : route.fulfill({ body: '<!doctype html>', contentType: 'text/html' });
    });
    await page.goto('http://line-height.test/');
    const line = 'قَالَ رَسُولُ اللَّهِ ﷺ';
    const markdown = require('../lib/Utils').markdownToHtml(`*${line}*\n${line}\n${line}`);
    await page.setContent(`<main><article class="h" lang="ar"><section class="chain-block"><span class="chain">${[line,line,line].join('<br>')}</span></section><section class="body"><div class="hadith-body-content content-markdown">${markdown}</div></section><footer class="footnote content-markdown">${markdown}</footer></article></main>`);
    for (const name of ['style','community','markdown-content']) await page.addStyleTag({ path: `public/static/css/${name}.css` });
    await page.evaluate(() => document.fonts.ready);
    for (const scale of [1, 1.25]) {
      await page.evaluate(scale => document.documentElement.style.setProperty('--content-font-scale',scale), scale);
      const metrics = await page.evaluate(() => ['.chain-block','.hadith-body-content p','footer p'].map(selector => {
        const el = document.querySelector(selector);
        return {line:parseFloat(getComputedStyle(el).lineHeight),height:el.getBoundingClientRect().height};
      }));
      for (const metric of metrics) {
        expect(metric.line).toBeCloseTo(metrics[0].line);
        expect(Math.abs(metric.height - metric.line * 3)).toBeLessThan(1);
      }
    }
    await page.screenshot({path:`/tmp/hadith-line-height-${width}.png`});
    const heights = await page.locator('.chain-block,.hadith-body-content p,footer p').evaluateAll(nodes => nodes.map(n=>n.getBoundingClientRect().height));
    await page.evaluate(() => {
      const walker=document.createTreeWalker(document.querySelector('main'),NodeFilter.SHOW_TEXT);
      while(walker.nextNode()) walker.currentNode.textContent=walker.currentNode.textContent.replace(/ﷺ/g,'');
    });
    expect(await page.locator('.chain-block,.hadith-body-content p,footer p').evaluateAll(nodes => nodes.map(n=>n.getBoundingClientRect().height))).toEqual(heights);
  } finally { await page.close(); }
});

test('callouts tint the entire panel and emphasize only the title', async () => {
  const page = await browser.newPage({viewport:{width:700,height:650}});
  try {
    const html=require('../lib/ContentMarkdown').render('> [!warning] Check the source {.callout}\n> First paragraph.\n>\n> Another paragraph.\n\n> [!note] ملاحظة\n> نص عربي للتوضيح');
    await page.setContent(`<main class="content-markdown">${html}</main>`);
    await page.addStyleTag({path:'public/static/css/markdown-content.css'});
    const result=await page.locator('.markdown-callout-warning').evaluate(el=>({background:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderInlineStartWidth,title:getComputedStyle(el.querySelector('.markdown-callout-title')).fontWeight,body:getComputedStyle(el.querySelector('p:last-child')).fontWeight,text:el.textContent}));
    expect(result.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(result.border).toBe('3px');
    expect(result.title).toBe('700');
    expect(result.body).toBe('400');
    expect(result.text).not.toMatch(/\[!|\{\.callout\}/);
    await page.screenshot({path:'/tmp/markdown-callouts.png'});
  } finally {await page.close();}
});

test.each([390,1100])('full-page commentary and narrative readers share hadith sizes, with smaller inline notes at %s px', async width => {
  const page=await browser.newPage({viewport:{width,height:800}});
  try {
    const text=lang=>require('../lib/Utils').markdownToHtml(lang==='ar'?'نص عربي للقراءة':'English reading text');
    const pair=(classes)=>['ar','en'].map(lang=>`<section lang="${lang}"><div class="${classes}">${text(lang)}</div></section>`).join('');
    await page.setContent(`<main>
      <div id="hadith">${['ar','en'].map(lang=>`<article class="h" lang="${lang}"><span class="chain">Chain</span><div class="hadith-body-content content-markdown">${text(lang)}</div></article>`).join('')}</div>
      <div id="tafsir" class="tafsir-only-page">${pair('quran-tafsir-text quran-tafsir-entry-body content-markdown')}</div>
      <div id="sharh" class="tafsir-only-page sharh-only-page">${pair('quran-tafsir-text quran-tafsir-entry-body content-markdown')}</div>
      <div id="intro">${['ar','en'].map(lang=>`<section class="intro content-markdown" lang="${lang}">${text(lang)}</section>`).join('')}</div>
      <div id="inline">${['ar','en'].map(lang=>`<section class="hadith-sharh-column" lang="${lang}"><div class="hadith-sharh-body content-markdown">${text(lang)}</div></section>`).join('')}</div>
    </main>`);
    for(const name of ['style','community','markdown-content'])await page.addStyleTag({path:`public/static/css/${name}.css`});
    for(const scale of [1,1.25]) {
      await page.evaluate(scale=>document.documentElement.style.setProperty('--content-font-scale',scale),scale);
      for(const lang of ['ar','en']) {
        const sizes=await page.evaluate(lang=>Object.fromEntries(['hadith','tafsir','sharh','intro','inline'].map(id=>[id,parseFloat(getComputedStyle(document.querySelector(`#${id} [lang=${lang}] ${lang==='ar'?'.notebook-arabic':'p'}`)).fontSize)])),lang);
        expect(sizes.tafsir).toBeCloseTo(sizes.hadith);
        expect(sizes.sharh).toBeCloseTo(sizes.hadith);
        expect(sizes.intro).toBeLessThan(sizes.hadith);
        expect(sizes.inline).toBeCloseTo(sizes.intro);
      }
    }
    await page.screenshot({path:`/tmp/reader-surfaces-${width}.png`});
  }finally{await page.close();}
});

test('bilingual tafsir Arabic nested in an English Markdown root matches hadith', async () => {
 const page=await browser.newPage();
 try {
  const text=require('../lib/Tafsir').renderCommentaryText('نص عربي ﷺ', '', 'md');
  await page.setContent(`<main class="tafsir-only-page"><div class="quran-tafsir-text content-markdown" lang="en"><div class="quran-tafsir-entry-body"><div class="row quran-tafsir-local-pair"><section lang="en"><p>English</p></section><section lang="ar">${text}</section></div></div></div><article class="h" lang="ar"><span class="chain">نص عربي</span></article></main>`);
  for(const name of ['style','community','markdown-content'])await page.addStyleTag({path:`public/static/css/${name}.css`});
  for(const scale of [1,1.25]) {
   await page.evaluate(scale=>document.documentElement.style.setProperty('--content-font-scale',scale),scale);
   const sizes=await page.evaluate(()=>{
    const size=selector=>parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
    return {arabic:size('.quran-tafsir-local-pair [lang=ar] .notebook-arabic'),chain:size('.chain'),english:size('.quran-tafsir-local-pair [lang=en] p')};
   });
   expect(sizes.arabic).toBeCloseTo(sizes.chain);
   expect(sizes.english/sizes.arabic).toBeCloseTo(9/13);
  }
 }finally{await page.close();}
});
