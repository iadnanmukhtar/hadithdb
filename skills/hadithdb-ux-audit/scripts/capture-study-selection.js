// Run against a preview serving this checkout. Save passage captures outside the repo.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, firefox, webkit } = require('playwright');

async function launchCaptureBrowser(phone, fallback) {
  if (!fallback) return chromium.launch({ channel: 'chrome' });
  try {
    return await chromium.launch();
  } catch (chromiumError) {
    const alternate = phone ? webkit : firefox;
    console.warn('Chrome Headless Shell launch failed. Trying ' + alternate.name());
    try {
      return await alternate.launch();
    } catch (alternateError) {
      throw new AggregateError([chromiumError, alternateError], 'Capture browsers failed to launch');
    }
  }
}

async function capture(browser, origin, output, width, height, stylesheet, overlay) {
  const phone = width === 390;
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: phone, ...(phone ? { isMobile: true } : {}) });
  try {
    // Keep the third-party sign-in prompt from covering the anonymous reader.
    await context.route('https://accounts.google.com/gsi/**', route => route.abort());
    if (overlay) {
      const cssUrl = new URL('/static/css/style.css', origin);
      await context.route(url => url.origin === cssUrl.origin && url.pathname === cssUrl.pathname,
        route => route.fulfill({ contentType: 'text/css', body: stylesheet }));
    }
    const page = await context.newPage();
    const reminder = page.locator('#sunnah-dialog[open]');
    await page.addLocatorHandler(reminder, () => reminder.locator('[data-sunnah-close]').evaluate(el => el.click()));
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/static/css/style.css');
    const [, css] = await Promise.all([
      page.goto(new URL('/quran/en-khattab/quran:9:120', origin).href),
      response
    ]);
    assert.deepEqual(await css.body(), stylesheet, 'Preview stylesheet differs from checkout');
    // The reminder opens asynchronously on first visit and can trap keyboard focus.
    await reminder.waitFor({ timeout: 4000 }).catch(() => {});
    if (await reminder.count()) await reminder.locator('[data-sunnah-close]').evaluate(el => el.click());
    const passage = lang => page.locator('.quran-passage-section [lang="' + lang + '"] .body.passage')
      .filter({ has: page.locator('.ayah[data-quran-ref="9:120"]') }).first();
    for (const [step, number] of [120, 121, 120].entries()) {
      const ref = '9:' + number;
      if (step) {
        const marker = passage('ar').locator('.quran-ayah-end-marker[data-quran-ref="' + ref + '"]');
        const study = page.locator('[data-quran-mushaf-ayah-view]');
        if (phone) {
          await passage('ar').locator('.quran-mushaf-ayah-actions-toggle[data-quran-ref="' + ref + '"]').tap();
          await study.tap();
        } else {
          // Start at the preceding ayah marker and exercise the reader's tab order.
          const previous = passage('ar').locator('.quran-ayah-end-marker[data-quran-ref="9:' + (number - 1) + '"]');
          await previous.focus();
          const tabLimit = await passage('ar').locator('a, button, [tabindex]').count() + 1;
          for (let i = 0; i < tabLimit; i++) {
            await page.keyboard.press('Tab');
            if (await marker.evaluate(el => el === document.activeElement)) break;
          }
          assert.ok(await marker.evaluate(el => el.matches(':focus-visible')), 'Marker unreachable by Tab');
          await page.screenshot({ path: path.join(output, width + '-' + step + '-marker-focus.png') });
          await page.keyboard.press('Enter');
          await study.waitFor({ state: 'visible' });
          const menuTabLimit = await page.locator('#quran-mushaf-ayah-actions :is(a,button,[tabindex])').count() + 1;
          for (let i = 0; i < menuTabLimit; i++) {
            if (await study.evaluate(el => el === document.activeElement)) break;
            await page.keyboard.press('Tab');
          }
          assert.ok(await study.evaluate(el => el.matches(':focus-visible')), 'Expected keyboard focus on Study');
          await page.keyboard.press('Enter');
        }
      }
      for (const lang of ['ar', 'en']) {
        const body = passage(lang);
        await body.locator('.ayah-selected[data-quran-ref="' + ref + '"]').waitFor();
        assert.equal(await body.locator('.ayah-selected').count(), 1);
        await body.scrollIntoViewIfNeeded();
        await page.evaluate(() => document.fonts.ready.then(() => true));
        if (!step && lang === 'ar') {
          for (const neighbor of [119, 121])
            assert.equal(await body.locator('.ayah[data-quran-ref="9:' + neighbor + '"]').count(), 1);
          const word = body.locator('.ayah-selected .quran-corpus-word').first();
          await word.waitFor();
          assert.equal(await word.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
          assert.ok(await word.evaluate(el => [...document.fonts].some(face =>
            face.family.replace(/["']/g, '') === 'Hafs' && face.status === 'loaded') &&
            getComputedStyle(el).fontFamily.includes('Hafs')), 'Expected loaded Hafs face');
        }
        await body.screenshot({ path: path.join(output, width + '-' + step + '-' + number + '-' + lang + '.png') });
        if (number === 121 && lang === 'ar') {
          const selected = body.locator('.ayah-selected');
          await selected.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
          const prefix = path.join(output, width + '-121');
          const geometry = () => body.evaluate(async el => {
            await document.fonts.ready;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const words = [...el.querySelectorAll('.quran-corpus-word')].map(word => ({
              text: word.textContent,
              rects: [...word.getClientRects()].map(rect => rect.toJSON())
            }));
            const bounds = el.getBoundingClientRect();
            const x = Math.max(0, Math.floor(bounds.left));
            const y = Math.max(0, Math.floor(bounds.top));
            const clip = { x, y, width: Math.min(innerWidth, Math.ceil(bounds.right)) - x,
              height: Math.min(innerHeight, Math.ceil(bounds.bottom)) - y };
            return { words, scrollX, scrollY, clip };
          });
          const before = await geometry();
          assert.ok(before.words.length, 'Expected Arabic word rectangles');
          // A stable crop can still omit a wrap or the adjoining ayah boundary.
          for (const number of [120, 121, 122]) {
            const words = body.locator('.ayah[data-quran-ref="9:' + number + '"] .quran-corpus-word');
            const boundary = number === 120 ? words.last() : number === 122 ? words.first() : words;
            const visibleInCrop = await boundary.evaluateAll((nodes, clip) =>
              nodes.length > 0 && nodes.every(node => {
                const rect = node.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && rect.left >= clip.x &&
                  rect.top >= clip.y && rect.right <= clip.x + clip.width &&
                  rect.bottom <= clip.y + clip.height;
              }), before.clip);
            assert.ok(visibleInCrop, 'Comparison crop omits Arabic text at 9:' + number);
          }
          const images = {};
          const takePair = async suffix => {
            images['-viewport' + suffix] = await page.screenshot();
            images['-ar-' + (suffix ? 'transparent' : 'filled')] =
              await page.screenshot({ clip: before.clip });
            assert.deepEqual(await geometry(), before, 'Arabic passage moved during capture');
          };
          await takePair('');
          const control = await page.addStyleTag({
            content: '.quran-passage-section [lang="ar"] .body.passage .ayah-selected { background-color: transparent !important; }'
          });
          try {
            const after = await geometry();
            assert.deepEqual(after, before, 'Fill comparison changed word rectangles or scroll position');
            assert.equal(await selected.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
            await takePair('-transparent');
            await fs.writeFile(prefix + '-geometry.json', JSON.stringify({ filled: before, transparent: after }));
          } finally {
            await control.evaluate(el => el.remove());
          }
          for (const [name, bytes] of Object.entries(images))
            await fs.writeFile(prefix + name + '.png', bytes);
        }
      }
    }
  } finally {
    await context.close();
  }
}

(async () => {
  const [, , origin, output] = process.argv;
  assert.ok(origin && output, 'Supply preview origin and capture directory');
  const stylesheet = await fs.readFile(path.resolve(__dirname, '../../../public/static/css/style.css'));
  const repo = path.resolve(__dirname, '../../..');
  const git = (...args) => execFileSync('git', args, { cwd: repo });
  const revision = git('rev-parse', 'HEAD').toString().trim();
  const cssFile = 'public/static/css/style.css';
  assert.deepEqual(stylesheet, git('show', revision + ':' + cssFile),
    'Commit the stylesheet before recording revision-bound captures');
  const stylesheetBlob = git('rev-parse', revision + ':' + cssFile).toString().trim();
  await fs.mkdir(output, { recursive: true });
  assert.equal((await fs.readdir(output)).length, 0, 'Use an empty directory for this capture run');
  const overlay = process.argv.includes('--candidate-css');
  const fallback = process.argv.includes('--fallback');
  const failures = [];
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    let browser;
    try {
      browser = await launchCaptureBrowser(width === 390, fallback);
      await capture(browser, origin, output, width, height, stylesheet, overlay);
      const evidence = { revision, stylesheetBlob, url: new URL('/quran/en-khattab/quran:9:120', origin).href,
        stylesheetSubstituted: overlay, browser: browser.browserType().name(), version: browser.version(),
        width, height, input: width === 390 ? 'emulated touch' : 'keyboard', selection: [120, 121, 120] };
      await fs.writeFile(path.join(output, width + '-run.json'), JSON.stringify(evidence, null, 2) + '\n');
      console.log(browser.browserType().name(), browser.version(), width, height, '120 → 121 → 120 passed');
    } catch (error) {
      console.error(width + 'px capture failed', error);
      failures.push(width);
    } finally {
      await browser?.close();
    }
  }
  assert.equal(failures.length, 0, 'Failed viewport widths: ' + failures.join(', '));
})().catch(error => { console.error(error); process.exitCode = 1; });
