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
routes.set('/bukhari:11', 200);
routes.set('/quran/en-khattab/2/1', 200);
routes.set('/notebook/shared/unavailable-fixture', 404);
routes.set('/community/unsubscribe/' + '0'.repeat(64), 200);
routes.set('/community/write?kind=article', 200);
routes.set('/community/email-preferences?from=/quran/settings', 200);

const comparableTitles = new Set(['/settings', '/books', '/about', '/community', '/bookmarks', '/notebook', '/quran/review', '/adab/introduction', '/quran/tafsir/mokhtasar/introduction']);

async function verifyRoute(page, route, status, titles) {
  const response = await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 60000 });
  assert.equal(response.status(), status, 'HTTP status');
  if (status === 200 && !route.includes('/_app_restarting.html')) {
    // The review starter immediately navigates away from its initial document.
    const html = route === '/quran/review?start' ? await (await page.request.get(base + route)).text() : await response.text();
    const $ = require('cheerio').load(html);
    assert.equal($('html[lang]').length, 1, 'document language');
    assert.equal($('head meta[charset="utf-8"]').length, 1, 'document encoding');
    assert.equal($('main').length, 1, 'main landmark');
    const field = (selector, attr) => {
      const el = $('head').find(selector);
      assert.equal(el.length, 1, selector);
      const value = attr ? el.attr(attr) : el.text();
      assert.ok(value?.trim(), selector);
      return value;
    };
    const title = field('title');
    const description = field('meta[name="description"]', 'content');
    const canonical = field('link[rel="canonical"]', 'href');
    assert.match(canonical, /^https?:\/\//);
    assert.equal(new URL(canonical).href, canonical);
    assert.equal(field('meta[property="og:title"]', 'content'), title);
    assert.equal(field('meta[property="og:description"]', 'content'), description);
    assert.equal(field('meta[property="og:url"]', 'content'), canonical);
    const nodes = $('script[type="application/ld+json"]').toArray().map(el => JSON.parse($(el).text()));
    assert.ok(nodes.every(node => node['@context'] === 'https://schema.org'));
    assert.equal(nodes.filter(node => node['@id'] === canonical && node.name === title && node.description === description).length, 1, 'canonical page schema');
  }
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

  if (route === '/quran/en-khattab/2/1') {
    for (const index of [0, 1]) {
      if (index) await page.locator('.quran-infinite-sentinel').first().scrollIntoViewIfNeeded();
      const passage = page.locator('.quran-study-passage').nth(index);
      await passage.locator('.quran-study-notes .footnote-item').first().waitFor({ state: 'attached' });
      const issues = await passage.evaluate(element => {
        const footer = element.querySelector('.quran-study-notes');
        const items = [...footer.querySelectorAll('.footnote-item')];
        const references = [...element.querySelectorAll('.quran-passage-section .footnote-ref a')];
        const sections = [...element.querySelectorAll('.quran-passage-section')];
        return {
          inlineNotes: element.querySelectorAll('.ayah ol').length,
          misplaced: sections.some(section => section.getBoundingClientRect().bottom > footer.getBoundingClientRect().top + 1),
          mismatchedNumbers: items.some((item, i) => item.value !== i + 1),
          brokenReferences: !references.length || references.some(ref => {
            const note = document.getElementById(ref.hash.slice(1));
            return !footer.contains(note) || ref.textContent !== '[' + note.value + ']';
          }),
          legacyFont: getComputedStyle(items[0].querySelector('p') || items[0]).fontFamily.includes('Gentium')
        };
      });
      assert.deepEqual(issues, { inlineNotes: 0, misplaced: false, mismatchedNumbers: false, brokenReferences: false, legacyFont: false });
    }
  }
  if (route === '/bukhari') {
    await page.locator('[data-command-search-open]:visible').first().click();
    const picker = page.getByRole('combobox', {name: 'Search scope'});
    const query = page.locator('.command-search-input');
    assert.equal(await picker.inputValue(), 'all');
    const endpoint = '**/*autocomplete?*';
    await page.route(endpoint, request => {
      const filters = new URL(request.request().url()).searchParams.getAll('b');
      return request.fulfill({json: [{label: 'Suggestion for ' + (filters.join(',') || 'all')}]});
    });
    try {
      const term = 'قد أفلح';
      await query.fill(term);
      await query.click();
      assert.equal(await query.evaluate(input => getComputedStyle(input).outlineStyle), 'none');
      assert.notEqual(await query.evaluate(input => getComputedStyle(input.parentElement).boxShadow), 'none');
      for (const [scope, filters] of Object.entries({
        quran: ['quran','translations'], tafsir: ['tafsir'], translations: ['translations'],
        hadith: ['hadith'], sharh: ['sharh'], sirah: ['sirah'], blog: ['blog'], community: ['community'], all: []
      })) {
        const request = page.waitForRequest(req => {
          const url = new URL(req.url());
          return url.pathname.endsWith('/autocomplete') && url.searchParams.get('q') === term
            && JSON.stringify(url.searchParams.getAll('b')) === JSON.stringify(filters);
        });
        await picker.click();
        await picker.locator('option[value="' + scope + '"]').click();
        await request;
        await page.locator('#global-search-dialog .ui-autocomplete:visible')
          .getByText('Suggestion for ' + (filters.join(',') || 'all'), {exact: true}).waitFor();
        assert.deepEqual(await picker.evaluate(el => new FormData(el.form).getAll('b')), filters);
        assert.equal(await query.inputValue(), term);
      }
      await query.press('Escape');
      const shortcut = page.getByRole('button', {name: 'Search within Bukhari'});
      assert.equal(await shortcut.locator('.bi-book[aria-hidden="true"]').count(), 1);
      assert.equal(await shortcut.evaluate(el => getComputedStyle(el).getPropertyValue('--bs-btn-bg').trim()),
        await shortcut.evaluate(el => getComputedStyle(el).getPropertyValue('--ux-secondary-fill').trim()));
      await shortcut.focus();
      await shortcut.press('Enter');
      await shortcut.waitFor({state: 'hidden'});
      assert.deepEqual(await picker.evaluate(el => new FormData(el.form).getAll('b')), ['bukhari']);
      const pill = page.getByRole('button', {name: 'Remove Bukhari filter'});
      const count = page.locator('[data-command-filter-toggle] [data-command-search-filter-count]');
      const appearance = el => ['fontSize', 'fontWeight', 'borderRadius', 'paddingInlineStart', 'backgroundColor']
        .map(property => getComputedStyle(el)[property]);
      assert.deepEqual(await pill.evaluate(appearance), await count.evaluate(appearance));
      await pill.focus();
      await pill.press('Enter');
      await shortcut.waitFor();
      assert.deepEqual(await picker.evaluate(el => new FormData(el.form).getAll('b')), []);
      await page.locator('[data-command-filter-toggle]:visible').click();
      const sourceFilter = page.getByRole('searchbox', {name: 'Filter books and sources'});
      await sourceFilter.fill('Bukhari');
      await page.getByRole('button', {name: 'Clear source filter'}).click();
      assert.equal(await sourceFilter.inputValue(), '');
      await sourceFilter.fill('Bukhari');
      await sourceFilter.press('Escape');
      assert.equal(await sourceFilter.inputValue(), '');
      assert.ok(await page.locator('#global-search-dialog').isVisible());
      await page.keyboard.press('Escape');
    } finally { await page.unroute(endpoint); }
  }
  if (route === '/bukhari:1' || route === '/bukhari:11') {
    const headings = page.locator('main h1:visible');
    assert.equal(await headings.count(), 1, 'related narrations must not repeat the detail heading');
    assert.equal(await headings.innerText(), 'Bukhari ' + route.split(':')[1]);
    const title = await headings.boundingBox();
    const controls = await page.locator('[data-reader-language-toolbar]:visible').first().boundingBox();
    assert.ok(controls.y >= title.y + title.height, 'language controls follow the detail heading');
  }
  if (route === '/bookmarks') {
    await page.locator('#bookmarks-empty').waitFor();
    assert.ok(await page.locator('#clear-bookmarks-btn').isHidden());
  }
  if (route.includes('?q=')) {
    assert.equal(await page.locator('main h1:visible').count(), 1);
    await page.getByRole('button', {name: 'Edit search', exact: true}).waitFor();
    const latinExcerpt = page.locator('.search-results-page [lang="en"] :is(p, mark, a):visible').first();
    if (await latinExcerpt.count()) {
      assert.match(await latinExcerpt.evaluate(el => getComputedStyle(el).fontFamily), /^Inter\b/);
    }
    const rail = page.locator('#search-rail-title');
    assert.equal(await rail.isVisible(), page.viewportSize().width >= 992);
    if (await rail.isVisible()) {
      const heading = await page.locator('main h1').boundingBox();
      assert.ok(Math.abs((await rail.boundingBox()).y - heading.y) < 2, 'search rail title alignment');
    }
    if (route.includes('xyzqzxqz')) {
      await page.getByRole('button', {name: 'Edit search'}).click();
      const dialog = page.locator('#global-search-dialog[open]');
      assert.equal(await dialog.locator('[name="q"]').inputValue(), 'xyzqzxqz');
      await page.keyboard.press('Escape');
    }
  }
  if (route === '/community/write?kind=article') {
    const signIn = page.getByRole('button', {name: 'Sign in to write'});
    const title = page.locator('#community-title');
    await signIn.waitFor();
    assert.ok(await title.isHidden());
    let releaseAccount;
    const accountReady = new Promise(resolve => { releaseAccount = resolve; });
    const endpoint = '**/api/**';
    await page.route(endpoint, async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/notebook') {
        const notes = [{title: 'Reading notes'}, {title: 'Friday notes'}];
        return route.fulfill({json: {notes: notes.filter(note => note.title.includes(url.searchParams.get('q')))}});
      }
      if (url.pathname === '/api/community/me') {
        await accountReady;
        return route.fulfill({json: {author: {name: 'Fixture Author', handle: 'fixture'}}});
      }
      return route.fulfill({json: {}});
    });
    const accountRequest = page.waitForRequest(request => request.url().endsWith('/community/me'));
    await page.evaluate(() => {
      window.hadithAuth.getToken = async () => 'fixture';
      document.dispatchEvent(new Event('hadithAuthChanged'));
    });
    await accountRequest;
    assert.ok(await title.isHidden());
    releaseAccount();
    await title.waitFor();
    await page.locator('#community-import').click();
    const matches = page.locator('#community-notebook-results');
    await matches.getByText('Friday notes').waitFor();
    await page.locator('#community-notebook-search').fill('Reading');
    await matches.getByText('Friday notes').waitFor({state: 'hidden'});
    await matches.getByText('Reading notes').waitFor();
    await page.getByRole('button', {name: 'Clear note search'}).click();
    await matches.getByText('Friday notes').waitFor();
    await title.fill('Fixture draft');
    await page.evaluate(() => {
      window.hadithAuth.getToken = async () => null;
      document.dispatchEvent(new Event('hadithAuthChanged'));
    });
    await signIn.waitFor();
    assert.ok(await title.isHidden());
    assert.equal(await title.inputValue(), '');
    await page.unroute(endpoint);
  }

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
    const shelf = page.locator('[data-highlight-pane]:visible');
    const selected = shelf.locator('[data-position="center"]');
    assert.equal(await selected.getAttribute('data-alias'), 'nawawi40');
    await shelf.getByRole('button', { name: 'Next book' }).click();
    assert.equal(await selected.getAttribute('data-alias'), 'ibnrajab50');
    const filter = page.getByPlaceholder('Search books');
    const controls = page.locator('.book-catalog-details-button:visible');
    const allBooks = await controls.count();
    assert.ok(allBooks > 1);
    await filter.fill('bukhari');
    assert.equal(await shelf.count(), 0);
    // A pending scroll event may be delivered after filtering hides the shelf.
    await page.locator('[data-highlight-pane] .library-volumes').evaluateAll(directories =>
      directories.forEach(directory => directory.dispatchEvent(new Event('scroll'))));
    await page.waitForFunction(count => {
      const matches = [...document.querySelectorAll('.book-catalog-details-button')].filter(button => button.getClientRects().length);
      return matches.length > 0 && matches.length < count;
    }, allBooks);
    await page.getByRole('button', { name: 'Clear book filter' }).click();
    assert.equal(await controls.count(), allBooks);
    assert.equal(await selected.getAttribute('data-alias'), 'ibnrajab50');
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
    const translations = page.getByRole('tabpanel', { name: 'Translations', exact: true });
    await translations.getByRole('button', { name: 'Next book' }).click();
    const translation = await translations.locator('[data-position="center"]').getAttribute('href');
    assert.match(translation, /\/quran\/(?!tafsir\/)/);
    await page.getByRole('tab', { name: 'English Tafsirs', exact: true }).click();
    const highlights = page.getByRole('tabpanel', { name: 'English Tafsirs' });
    const selected = highlights.locator('[data-position="center"]');
    assert.equal(await selected.getAttribute('data-alias'), 'mokhtasar');
    await highlights.getByRole('button', { name: 'Next book' }).click();
    assert.match(await selected.getAttribute('href'), /\/quran\/tafsir\//);
    assert.notEqual(await selected.getAttribute('data-alias'), 'mokhtasar');
    const english = await highlights.locator('.library-volume').evaluateAll(links => links.map(link => link.dataset.alias));
    const tabs = page.getByRole('tablist', { name: 'Quran library' });
    await tabs.getByRole('tab', {name: 'Other', exact: true}).click();
    const directory = page.getByRole('tabpanel', {name: 'Other', exact: true});
    const remaining = await directory.locator('.library-volume:visible').evaluateAll(links => links.map(link => link.dataset.alias));
    assert.ok(remaining.length > 0 && remaining.every(alias => !english.includes(alias)));
    assert.equal(await directory.getByRole('button', {name: 'Next book'}).count(), 0);
    const filter = page.locator('#quran-library-filter');
    await filter.fill('khattab');
    await page.locator('#quran-library-results .library-volume:visible').first().waitFor();
    assert.ok(await directory.isHidden());
    await filter.fill('no-such-book-712');
    await page.locator('#quran-library-results .library-empty').waitFor();
    await page.getByRole('button', {name: 'Clear book search'}).click();
    await directory.waitFor();
    await page.locator('#toc-tab-surahs').click();
    await page.getByRole('tablist', { name: 'Quran library' }).getByRole('tab', { name: 'Translations' }).click();
    assert.equal(await translations.locator('[data-position="center"]').getAttribute('href'), translation);
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
