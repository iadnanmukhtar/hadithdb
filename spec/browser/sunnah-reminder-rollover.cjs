'use strict';

const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { choose } = require('../../lib/SunnahReminder');

const origin = process.env.UX_TEST_ORIGIN || 'http://localhost:3004';
const midnight = Date.UTC(2026, 10, 25, 5);
const dayLength = 86400000;
const pool = [21, 44, 62].map(hId => ({ hId }));

// Supply a suffixed record from the candidate database for the navigation checks.
const numberFor = id => id === 62 && process.env.UX_MUJTABA_NUMBER
  ? process.env.UX_MUJTABA_NUMBER : id + 'a';

async function verify(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  try {
    await page.clock.install({ time: midnight - 60000 });
    await page.clock.pauseAt(midnight - 1000);
    let serverDay = Math.floor(midnight / dayLength) - 1;
    let pending;
    await page.route('**/reminders/sunnah?*', async route => {
      const options = Object.fromEntries(new URL(route.request().url()).searchParams);
      const { hId } = choose(pool, options, serverDay);
      const json = {
        alias: 'mujtaba', bookName: 'Mujtaba', id: String(hId), num: numberFor(hId), day: serverDay, more: true,
        arabic: ('عربي ' + hId + ' ').repeat(100), english: ('English ' + hId + ' ').repeat(100)
      };
      if (pending && options.another) {
        pending.started();
        await pending.gate;
      }
      await route.fulfill({ json });
    });
    await page.goto(origin);
    const dialog = page.locator('#sunnah-dialog');
    const ref = dialog.locator('[data-sunnah-ref]');
    const another = dialog.getByRole('button', { name: 'Another reminder' });
    const opener = page.locator('[data-sunnah-open]:visible').first();
    async function checkDay() {
      const id = pool[serverDay % pool.length].hId;
      const href = '/mujtaba:' + numberFor(id);
      await dialog.getByRole('link', { name: 'Mujtaba ' + numberFor(id), exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      for (const [lang, direction, start] of [['ar', 'rtl', 'عربي'], ['en', 'ltr', 'English']]) {
        const excerpt = dialog.locator('[data-sunnah-text=' + lang + ']');
        assert.equal(new URL(await excerpt.evaluate(el => el.href)).pathname, href);
        assert.ok((await excerpt.innerText()).startsWith(start + ' ' + id));
        const lines = await excerpt.evaluate(el => {
          const style = getComputedStyle(el.querySelector('p'));
          return [style.direction, el.parentElement.offsetHeight / parseFloat(style.lineHeight)];
        });
        assert.equal(lines[0], direction);
        assert.ok(lines[1] > 2 && lines[1] <= 3.1, 'three-line preview');
      }
      assert.equal(await ref.getAttribute('href'), href);
      assert.equal((await ref.locator('..').innerText()).trim(), '— Mujtaba ' + numberFor(id));
      assert.doesNotMatch(await dialog.innerText(), /AI translation/i);
    }

    await checkDay();
    await another.focus();
    serverDay++;
    await page.clock.fastForward(1000);
    await checkDay();
    assert.ok(await another.evaluate(el => el === document.activeElement));

    let started;
    const requested = new Promise(resolve => { started = resolve; });
    let release;
    pending = { started, gate: new Promise(resolve => { release = resolve; }) };
    await another.click();
    await requested;
    serverDay++;
    await page.clock.fastForward(dayLength);
    await checkDay();
    const delivered = page.waitForResponse(response => response.url().includes('another=1'));
    release();
    await delivered;
    await checkDay();

    const triggerHref = await dialog.getByRole('link', { name: 'Browse Mujtaba' }).getAttribute('href');
    assert.equal(triggerHref, '/mujtaba');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.ok(await opener.evaluate(el => document.activeElement === el));
    await page.getByRole('link', { name: 'Show another reminder' }).waitFor();
    await opener.click();
    await checkDay();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.ok(await opener.evaluate(el => document.activeElement === el));
    for (const selector of ['[data-sunnah-text=ar]', '[data-sunnah-text=en]', '[data-sunnah-ref]', '[data-sunnah-action=browse]']) {
      await opener.click();
      await checkDay();
      const link = dialog.locator(selector);
      const path = await link.getAttribute('href');
      const [response] = await Promise.all([page.waitForNavigation(), link.click()]);
      assert.ok(response?.ok(), 'Destination returned an error: ' + path);
      assert.equal(new URL(page.url()).pathname, path);
      assert.match(await page.locator('body').innerText(), /Mujtab[aā]/i);
      if (selector !== '[data-sunnah-action=browse]') {
        assert.match(path, /\d[a-z]$/i);
        assert.ok((await page.locator('body').innerText()).includes(path.split(':')[1]));
      }
      await page.goto(origin);
    }
    const original = page.getByRole('link', { name: 'Show another reminder' });
    const [home] = await Promise.all([page.waitForNavigation(), original.click()]);
    assert.ok(home?.ok());
    await page.getByRole('heading', { name: /^(Hadith|Ayah) Reminder$/ }).waitFor();
    const quran = await page.goto(new URL('/quran:2:255', origin).href);
    assert.ok(quran?.ok());
    const hero = page.locator('.quran-ayah-hero:visible').filter({
      has: page.locator('[data-quran-ref="2:255"]')
    }).first();
    await hero.waitFor();
    assert.ok(await hero.locator('.quran-ayah-hero-text p').count() >= 2);
    console.log(width + 'px passed');
  } finally {
    await page.context().close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.UX_BROWSER_CHANNEL || 'chrome' });
  try {
    for (const width of [390, 1440]) await verify(browser, width);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
