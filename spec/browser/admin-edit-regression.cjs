'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
const ContentMarkdown = require('../../lib/ContentMarkdown');
const { chromium } = require('playwright');

const base = process.env.UX_TEST_ORIGIN || 'http://localhost:3004';
const views = path.join(__dirname, '../../views');

// Use the real admin template and event handlers. All manager data and writes
// belong to this browser context; the application never receives an edit.
async function adminFixture() {
  const shell = new JSDOM(await (await fetch(base + '/about')).text()).window.document;
  global.settings = { site: { url: base } };
  const head = shell.head.innerHTML;
  const masthead = shell.querySelector('.ux-masthead').outerHTML;
  return ejs.renderFile(path.join(views, 'admin.ejs'), {
    req: { path: '/admin', query: {} }, googleAnalyticsTagId: '',
    utils: { scriptAssetVersion: () => 'test', hadithBaseUrl: () => base, quranBaseUrl: () => base,
      defaultQuranTranslationLabel: () => 'Translation' }
  }, { includer(name) {
    if (name.endsWith('/head.ejs')) return { template: head.replace(/<%/g, '<%%') };
    if (name.endsWith('/header.ejs')) return { template: masthead };
    if (!['page_end.ejs', 'scripts.ejs', 'modal_close.ejs'].includes(path.basename(name))) return { template: ' ' };
  } });
}

async function run(width, browser, html) {
  const page = await browser.newPage({ viewport: { width, height: 850 }, serviceWorkers: 'block' });
  page.setDefaultTimeout(10000);
  const updates = [];
  let pairs = [
    { key: 'a', value_en: 'First', value_ar: 'الأول' },
    { key: 'b', value_en: 'Second', value_ar: 'الثاني' }
  ];
  let rejectNext = false;
  let releaseSave;
  await page.route('**/*', async route => {
    const req = route.request();
    const pathname = new URL(req.url()).pathname;
    if (req.method() === 'POST' && pathname.startsWith('/api/update/')) {
      const body = req.postDataJSON();
      updates.push(body);
      if (body.prop === 'hdith_pair.merge') {
        pairs = pairs.filter(pair => pair.key === body.targetKey || !body.mergeKeys.includes(pair.key));
      } else if (body.prop === 'hdith_pair.save') {
        const pair = pairs.find(row => row.key === body.originalKey);
        if (pair) Object.assign(pair, { value_en: body.valueEn, value_ar: body.valueAr });
        else pairs.push({ key: 'new', value_en: body.valueEn, value_ar: body.valueAr });
      } else if (body.prop === 'hdith_pair.delete') {
        pairs = pairs.filter(pair => pair.key !== body.originalKey);
      }
      if (body.value === 'first draft') await new Promise(resolve => { releaseSave = resolve; });
      const status = rejectNext ? 422 : 200;
      rejectNext = false;
      return route.fulfill({ status, json: { code: status, value: body.value, message: status === 200 ? 'Saved' : 'Try again' } });
    }
    if (req.method() === 'POST' && pathname.endsWith('/notebook/content-preview')) {
      return route.fulfill({ json: { html: ContentMarkdown.render(req.postDataJSON().markdown) } });
    }
    if (!['GET', 'HEAD'].includes(req.method())) return route.abort();
    if (pathname === '/ux-admin-fixture') return route.fulfill({ contentType: 'text/html', body: html });
    if (pathname === '/admin/book-aliases') return route.fulfill({ json: [{ id: 1, type: 'hadith', alias: 'fixture', name_en: 'Fixture' }] });
    if (pathname.endsWith('/autocomplete/bilingual-pairs')) {
      const type = new URL(req.url()).searchParams.get('type');
      return route.fulfill({ json: type === 'attribution' ? pairs : [] });
    }
    if (pathname === '/admin/legacy-graders') return route.fulfill({ json: [] });
    return route.continue();
  });
  try {
    await page.goto(base + '/ux-admin-fixture', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.bindInlineEditors === 'function');
    const opener = page.locator('[data-bs-target="#admin-book-aliases"]');
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => { document.documentElement.dataset.bsTheme = theme; }, theme);
      await opener.evaluate(el => el.scrollIntoView({ block: 'center' }));
      await page.mouse.move(0, 0);
      const fill = theme === 'dark' ? 'rgb(51, 57, 83)' : 'rgb(234, 234, 245)';
      await page.waitForFunction(rest =>
        getComputedStyle(document.querySelector('[data-bs-target="#admin-book-aliases"]')).backgroundColor === rest, fill);
      await opener.hover();
      await page.waitForFunction(rest => {
        const css = getComputedStyle(document.querySelector('[data-bs-target="#admin-book-aliases"]'));
        return css.color === 'rgb(255, 255, 255)' && css.backgroundColor !== rest;
      }, fill);
    }
    for (const name of ['narrator', 'attribution', 'chain_classification', 'grader', 'grade']) {
      await page.locator('[data-hadith-pair-manager-open="' + name + '"]').click();
      await page.locator('#admin-pair-manager.show').waitFor();
      if (name === 'attribution') {
        const manager = page.locator('#admin-pair-manager');
        const row = key => manager.locator('[data-original-key="' + key + '"]');
        const merge = manager.locator('[data-pair-merge]');
        await row('a').getByLabel('English value').fill('Revised');
        await row('a').getByRole('button', { name: 'Save pair' }).click();
        await manager.getByText('Pair saved.', { exact: true }).waitFor();
        assert.equal(await row('a').getByLabel('English value').inputValue(), 'Revised');
        await row('a').getByRole('checkbox').check();
        await row('b').getByRole('checkbox').check();
        assert.ok(await merge.isDisabled());
        await manager.getByLabel('Target pair').selectOption('a');
        page.once('dialog', dialog => dialog.dismiss());
        await merge.click();
        assert.equal(pairs.length, 2);
        page.once('dialog', dialog => dialog.accept());
        await merge.click();
        await row('b').waitFor({ state: 'detached' });
        assert.deepEqual(updates.at(-1).mergeKeys, ['a', 'b']);
        await manager.locator('[data-hadith-pair-value-ar]').fill('جديد');
        await manager.locator('[data-hadith-pair-value-en]').fill('New');
        await manager.locator('[data-hadith-pair-add]').click();
        await row('new').waitFor();
        page.once('dialog', dialog => dialog.accept());
        await row('new').getByRole('button', { name: 'Remove pair' }).click();
        await row('new').waitFor({ state: 'detached' });
        assert.equal(pairs.length, 1);
      }
      await page.locator('#admin-pair-manager .btn-close').click();
      await page.locator('#admin-pair-manager').waitFor({ state: 'hidden' });
    }
    await page.locator('[data-bs-target="#admin-legacy-graders"]').click();
    await page.locator('[data-legacy-grader-select] option[value="new"]').waitFor({ state: 'attached' });
    await page.locator('#admin-legacy-graders .btn-close').click();
    await page.locator('[data-bs-target="#admin-book-aliases"]').click();
    await page.locator('#book-alias-value').fill('changed');
    await page.locator('[data-book-alias-save]').click();
    await page.waitForFunction(() => document.querySelector('[data-book-alias-status]').textContent === 'Saved');
    assert.equal(updates.at(-1).prop, 'book.alias');
    await page.locator('#admin-book-aliases .btn-close').click();

    await page.evaluate(() => {
      document.querySelector('main').insertAdjacentHTML('afterbegin',
        '<span id="fixture-name" class="_e" lang="ar" dir="rtl" data-id="10" data-prop="book.name">اسم</span>' +
        '<div id="fixture-markdown" class="_e" data-id="13" data-prop="book.description" data-markdown-source="Original">Original</div>' +
        '<textarea id="fixture-explicit" class="_e quran-tafsir-editor" data-id="12" data-prop="toc.title_en"></textarea>' +
        '<select id="fixture-choice" class="_e" data-id="11" data-prop="book.lang"><option>ar</option><option>en</option></select>');
    });
    const field = page.locator('#fixture-name.ux-inline-editor');
    await field.focus();
    assert.equal(await field.getAttribute('contenteditable'), 'true');
    assert.equal(await field.getAttribute('dir'), 'rtl');
    rejectNext = true;
    await field.fill('اختبار');
    await field.press('Tab');
    await page.locator('#fixture-name[aria-invalid="true"]').waitFor();
    assert.equal(await field.textContent(), 'اختبار');
    await field.focus();
    await field.press('Tab');
    await page.locator('#fixture-name[aria-invalid="false"]:not([submitting])').waitFor();
    assert.equal(updates.at(-1).value, 'اختبار');
    const first = page.waitForRequest(req => req.url().endsWith('/update/10/book.name'));
    await field.focus();
    await field.fill('first draft');
    await field.press('Tab');
    await first;
    await page.locator('#fixture-name[aria-busy="true"]').waitFor();
    await field.focus();
    await field.fill('newer draft');
    await field.press('Tab');
    const latest = page.waitForResponse(res => res.url().endsWith('/update/10/book.name') &&
      res.request().postDataJSON().value === 'newer draft');
    releaseSave();
    await latest;
    await page.locator('#fixture-name:not([aria-busy])').waitFor();
    assert.equal(await field.textContent(), 'newer draft');
    const saved = page.waitForResponse(res => res.url().endsWith('/update/11/book.lang'));
    await page.locator('#fixture-choice').selectOption('en');
    await saved;
    assert.equal(updates.at(-1).value, 'en');
    const markdown = page.locator('#fixture-markdown');
    await markdown.focus();
    const rich = markdown.locator('.community-rich-input');
    await rich.fill('Edited description');
    const savedDescription = page.waitForResponse(res => res.url().endsWith('/update/13/book.description'));
    await page.locator('#fixture-explicit').focus();
    await savedDescription;
    assert.equal(await markdown.getAttribute('data-markdown-source'), 'Edited description');
    const explicit = page.locator('#fixture-explicit');
    await explicit.fill('Revised heading');
    await explicit.press('Tab');
    assert.equal(updates.filter(body => body.id === '12').length, 0);
    const confirmed = page.waitForResponse(res => res.url().endsWith('/update/12/toc.title_en'));
    await page.locator('#fixture-explicit + .quran-tafsir-save').click();
    await confirmed;
    assert.equal(updates.at(-1).value, 'Revised heading');
    console.log('Admin managers, dynamic binding, RTL editing, retries, concurrent edits, select and explicit Save passed at', width);
  } finally {
    await page.close();
  }
}

(async () => {
  const html = await adminFixture();
  const browser = await chromium.launch({ channel: process.env.UX_BROWSER_CHANNEL || 'chrome' });
  try {
    for (const width of [390, 1440]) await run(width, browser, html);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
