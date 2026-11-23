'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright');

const base = process.env.UX_TEST_ORIGIN || 'http://localhost:3004';
const atlas = fs.readFileSync(path.join(__dirname, '../../docs/design-system/inventory.js'), 'utf8');
const pages = vm.runInNewContext(atlas + ';pages');
const routes = new Map(pages.map(page => [page.path, page.status]));
for (const route of ['/quran/settings', '/quran/notebook', '/history']) routes.set(route, 200);
for (const path of ['/requests', '/requests/feed', '/requests/rss']) routes.set(path, 410);
routes.set('/admin', 401);
routes.set('/notebook/shared/unavailable-fixture', 404);
routes.set('/community/unsubscribe/' + '0'.repeat(64), 200);
routes.set('/community/write?kind=article', 200);
routes.set('/community/email-preferences?from=/quran/settings', 200);

const comparableTitles = new Set(['/settings', '/books', '/about', '/community', '/bookmarks', '/notebook', '/quran/review', '/adab/introduction', '/quran/tafsir/mokhtasar/introduction']);

async function verifyRoute(page, route, status, titles) {
  const response = await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 60000 });
  assert.equal(response.status(), status, 'HTTP status');
  if (route === '/admin') {
    assert.equal(await page.locator('[data-hadith-pair-manager]').count(), 0);
    return;
  }
  if (route === '/html/_app_restarting.html') {
    await page.getByRole('button', { name: 'Try again now' }).waitFor();
    return;
  }
  await page.locator('link[href*="ux-foundations.css"]').first().waitFor({ state: 'attached' });
  if (route.startsWith('/notebook/shared/')) {
    assert.equal(response.headers()['referrer-policy'], 'no-referrer');
    assert.equal(await page.locator('h1').innerText(), 'Shared note unavailable');
    return;
  }
  if (route.startsWith('/html/') && route !== '/html/privacy.html') return;
  assert.equal(await page.locator('.ux-masthead').count(), 1, 'masthead');
  assert.equal(await page.locator('.ux-footer').count(), 1, 'footer');
  assert.ok(await page.locator('main').count(), 'main');
  assert.equal(await page.locator('.ux-inline-editor').count(), 0, 'anonymous edit control');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'viewport overflow');

  if (comparableTitles.has(route)) {
    titles.set(route, await page.locator('main h1:visible').first().evaluate(node => {
      const style = getComputedStyle(node);
      return [style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight];
    }));
  }
  if (route === '/') {
    const shelf = page.locator('[data-library-shelf]');
    const cards = shelf.locator('.library-volume:visible');
    const aliases = () => cards.evaluateAll(nodes => nodes.map(node => node.dataset.alias));
    await shelf.locator('[data-shelf-view="beginner"][aria-pressed="true"]').waitFor();
    const centered = shelf.locator('[data-position="center"]');
    assert.equal(await centered.getAttribute('data-alias'), 'nawawi40');
    await shelf.getByRole('button', { name: 'Next book', exact: true }).click();
    assert.equal(await centered.getAttribute('data-alias'), 'ibnrajab50');
    async function checkBindings() {
      const colors = await cards.locator('.volume-face').evaluateAll(faces =>
        faces.map(face => getComputedStyle(face).backgroundColor));
      assert.ok(colors.every((color, index) => !index || color !== colors[index - 1]), 'adjacent book bindings');
    }
    await checkBindings();
    const beginnerShelf = await aliases();
    assert.deepEqual(beginnerShelf, ['nawawi40', 'ibnrajab50', 'riyad', 'adab', 'shamail', 'mishkat']);
    await shelf.getByRole('button', { name: 'Twelve Books', exact: true }).click();
    await checkBindings();
    const twelveShelf = await aliases();
    assert.deepEqual(twelveShelf, ['bukhari', 'muslim', 'lulu-marjan', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah', 'malik', 'ahmad', 'darimi', 'ibnhibban', 'hakim', 'daraqutni', 'mishkat']);
    assert.equal(await centered.getAttribute('data-alias'), 'bukhari');
    await shelf.getByRole('button', { name: 'Next book', exact: true }).click();
    assert.equal(await centered.getAttribute('data-alias'), 'muslim');
    await centered.press('End');
    assert.equal(await centered.getAttribute('data-alias'), 'mishkat');
    assert.equal(await shelf.getByRole('button', { name: 'Next book', exact: true }).isDisabled(), true);
    await centered.press('Home');
    assert.equal(await centered.getAttribute('data-alias'), 'bukhari');
    assert.deepEqual(await shelf.locator('[data-shelf-view]').allTextContents(), ['Beginner Books', 'Twelve Books', 'Other']);
    assert.equal(await page.getByRole('heading', { name: 'Hadith library', exact: true }).count(), 1);
    assert.equal(await page.getByRole('heading', { name: 'Book collections', exact: true }).count(), 0);
    await shelf.getByRole('button', { name: 'Other', exact: true }).click();
    for (const alias of ['history', 'ibnhisham', 'yqsirah']) {
      assert.equal(await shelf.locator('[data-alias="' + alias + '"]:visible').getAttribute('href'), '/' + alias);
    }
    const field = shelf.getByRole('searchbox');
    await field.fill('mishkat');
    assert.deepEqual(await aliases(), ['mishkat']);
    for (const query of ['bukhari', 'البخاري']) {
      await field.fill(query);
      await shelf.locator('[data-alias="bukhari"]:visible').waitFor();
    }
    await field.fill('no-such-book-712');
    await shelf.getByText('No books match your search.').waitFor();
    await field.press('Escape');
    assert.equal(await field.inputValue(), '');
    assert.equal(await shelf.getByRole('button', { name: 'Other', exact: true }).getAttribute('aria-pressed'), 'true');
    const assigned = new Set([...twelveShelf, ...beginnerShelf]);
    assert.ok((await aliases()).every(alias => !assigned.has(alias)));
    assert.equal((await aliases()).length + assigned.size, await shelf.locator('.library-volume').count());
    assert.ok(await cards.count() > 6);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  assert.equal(await page.locator('[data-page-help-tour], [data-page-help-tour-trigger], [data-quran-help-tips]').count(), 0);
  if (route === '/' || route === '/quran') {
    assert.equal(await page.locator('[data-home-intro], .home-quran-announcement').count(), 0);
    assert.equal(await page.locator('.ux-footer').getByRole('link', { name: 'About', exact: true }).getAttribute('href'), '/about');
  }
  if (route === '/about') {
    await page.waitForLoadState('load');
    await page.locator('.top-nav-menu-toggle').click();
    await page.waitForFunction(() => document.activeElement === document.querySelector('#offcanvas-topnav'));
    await page.keyboard.press('Escape');
    await page.locator('#offcanvas-topnav.show').waitFor({ state: 'hidden' });
    const light = await page.locator('body').evaluate(body => getComputedStyle(body).backgroundColor);
    const dark = await page.evaluate(() => {
      document.documentElement.setAttribute('data-bs-theme', 'dark');
      return getComputedStyle(document.body).backgroundColor;
    });
    assert.notEqual(light, dark, 'theme switch changes canvas');
  }
  if (route === '/settings') {
    const filter = page.getByPlaceholder('Search settings');
    await filter.fill('script');
    const summary = page.locator('summary:visible').filter({ hasText: 'Quran script' }).first();
    await summary.click();
    assert.equal(await page.locator('input[name="settings-quran-script"]:visible').count(), 3);
    await filter.fill('');
  }
  if (route === '/community') {
    await page.locator('#community-user-search-open').click();
    await page.locator('#community-user-search-dialog[open]').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('#community-user-search-dialog[open]').waitFor({ state: 'hidden' });
  }
  if (route === '/books') {
    const filter = page.getByPlaceholder('Search books');
    const controls = page.locator('.book-catalog-details-button:visible');
    const allBooks = await controls.count();
    assert.ok(allBooks > 1);
    await filter.fill('bukhari');
    await page.waitForFunction(count => {
      const matches = [...document.querySelectorAll('.book-catalog-details-button')].filter(button => button.getClientRects().length);
      return matches.length > 0 && matches.length < count;
    }, allBooks);
    await page.getByRole('button', { name: 'Clear book filter' }).click();
    assert.equal(await controls.count(), allBooks);
    const trigger = controls.first();
    await trigger.click();
    await page.locator('.book-catalog-dialog[open] .ux-primary-action[href]').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.book-catalog-dialog[open]').waitFor({ state: 'hidden' });
    assert.ok(await trigger.evaluate(node => node === document.activeElement), 'dialog focus return');
  }
  if (route === '/quran/page/42') {
    await page.locator('.quran-navigate:visible').first().click();
    const rail = page.locator('#quran-navigation-rail.show');
    await rail.locator('.quran-navigation-list a').first().waitFor({ state: 'attached' });
    for (const name of ['Surah', 'Ayah', 'Manzil', 'Juz', 'Page']) {
      const tab = rail.getByRole('tab', { name, exact: true });
      await tab.click();
      assert.equal(await tab.getAttribute('aria-selected'), 'true');
      const list = rail.getByRole('navigation', { name, exact: true });
      assert.ok(await list.locator('a[href]').count() > 0);
    }
    const filter = rail.getByRole('searchbox', { name: 'Search Page' });
    await filter.fill('unmatched');
    await rail.getByText('No matches', { exact: true }).waitFor();
    await filter.press('Escape');
    assert.equal(await filter.inputValue(), '');
    assert.equal(await rail.locator('.quran-page-group-title:visible').count(), 30);
    await rail.getByRole('button', { name: 'Close Quran navigation' }).click();
    await rail.waitFor({ state: 'hidden' });
  }
  if (route === '/quran') {
    await page.locator('#toc-tab-surahs').click();
    const toggle = page.locator('#toc-surahs [data-toc-toggle]').first();
    await toggle.click();
    await page.locator('#toc-surahs tr.toc-subsection-row:visible').first().waitFor();
    await toggle.click();
    assert.equal(await page.locator('#toc-surahs tr.toc-subsection-row:visible').count(), 0);
  }
}

async function main() {
  const browser = await chromium.launch({ channel: process.env.UX_BROWSER_CHANNEL || 'chrome' });
  const failures = [];
  try {
    const request = await browser.newContext();
    for (const route of ['liked', 'highlights', 'titled', 'commented']) {
      for (const suffix of ['', '/rss', '/feed']) {
        const response = await request.request.get(base + '/' + route + suffix, { maxRedirects: 0 });
        assert.equal(response.status(), 301);
        assert.equal(response.headers().location, '/community');
      }
    }
    await request.close();
    await Promise.all([390, 1440].map(async width => {
      const page = await browser.newPage({ viewport: { width, height: 850 } });
      page.setDefaultTimeout(8000);
      const titles = new Map();
      for (const [route, status] of routes) {
        try {
          await verifyRoute(page, route, status, titles);
        } catch (error) {
          failures.push({ width, route, message: error.message });
          console.error(width, route, error.message);
        }
      }
      for (const [route, title] of titles) {
        assert.deepEqual(title, titles.get('/settings'), 'Page title at ' + width + 'px on ' + route);
      }
      await page.close();
    }));
  } finally {
    await browser.close();
  }
  const total = routes.size * 2;
  console.log(`${total - failures.length}/${total} route and viewport checks passed`);
  if (failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
