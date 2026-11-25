'use strict';

const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { choose } = require('../../lib/SunnahReminder');

const origin = process.env.UX_TEST_ORIGIN || 'http://localhost:3004';
const midnight = Date.UTC(2026, 10, 25);
const dayLength = 86400000;
const pool = [21, 44, 62].map(hId => ({ hId }));

async function verify(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  try {
    await page.clock.install({ time: midnight - 60000 });
    await page.clock.pauseAt(midnight - 1000);
    let serverDay = Math.floor((midnight - 1) / dayLength);
    let pending;
    await page.route('**/reminders/sunnah?*', async route => {
      const options = Object.fromEntries(new URL(route.request().url()).searchParams);
      const { hId } = choose(pool, options, serverDay);
      const json = {
        id: String(hId), num: hId + 'a', day: serverDay, more: true,
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
      const href = '/mujtaba:' + id + 'a';
      await dialog.getByRole('link', { name: 'Mujtaba ' + id + 'a', exact: true }).waitFor();
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
      assert.equal((await ref.locator('..').innerText()).trim(), '— Mujtaba ' + id + 'a');
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
