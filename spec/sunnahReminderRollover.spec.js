const fs = require('fs');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
const { withGlobal } = require('@sinonjs/fake-timers');
const { choose } = require('../lib/SunnahReminder');

const midnight = Date.UTC(2026, 10, 25);
const dayLength = 86400000;
const filename = require.resolve('../views/sub-views/sunnah_reminder.ejs');
const html = ejs.render(fs.readFileSync(filename, 'utf8'), {
  utils: { scriptAssetVersion: () => 'test' }
}, { filename });
const script = fs.readFileSync(require.resolve('../public/static/js/sunnah-reminder.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

describe('open homepage Sunnah dialog at the UTC boundary', () => {
  let window, document, clock, dialog, trigger, another, pool, holdNext;
  async function visit(stored) {
    window = new JSDOM('<button data-sunnah-open>Open</button>' + html, {
      url: 'https://example.test/', runScripts: 'outside-only', pretendToBeVisual: true
    }).window;
    document = window.document;
    dialog = document.querySelector('dialog');
    trigger = document.querySelector('[data-sunnah-open]');
    trigger.getClientRects = () => [trigger.getBoundingClientRect()];
    Object.defineProperty(trigger, 'offsetWidth', { value: 24 });
    dialog.showModal = () => dialog.setAttribute('open', '');
    dialog.close = () => {
      dialog.removeAttribute('open');
      dialog.dispatchEvent(new window.Event('close'));
    };
    clock = withGlobal(window).install({ now: midnight - 100, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    if (stored) {
      window.sessionStorage.setItem('sunnah-reminder', stored);
      document.cookie = 'sunnah_session_seen=1';
    }
    window.fetch = async url => {
      const params = new URL(url, 'https://example.test').searchParams;
      const day = Math.floor(clock.now / dayLength);
      const record = choose(pool, Object.fromEntries(params), day);
      const id = record?.hId;
      const response = { ok: true, status: id ? 200 : 204, json: async () => ({
        day, id: String(id), num: id + 'a', english: 'English ' + id, arabic: 'عربي ' + id, more: pool.length > 1
      }) };
      if (holdNext) {
        const hold = holdNext;
        holdNext = null;
        await hold;
      }
      return response;
    };
    window.eval(script);
    await settle();
    another = dialog.querySelector('[data-sunnah-action=another]');
  }
  function expectReading(id) {
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[data-sunnah-text=ar]').textContent).toBe('عربي ' + id);
    expect(dialog.querySelector('[data-sunnah-text=en]').textContent).toBe('English ' + id);
    expect(dialog.querySelector('[data-sunnah-ref]').textContent).toBe('Mujtaba ' + id + 'a');
    for (const link of dialog.querySelectorAll('[data-sunnah-text], [data-sunnah-ref]'))
      expect(link.pathname).toBe('/mujtaba:' + id + 'a');
  }
  function expected(offset = 0) {
    return pool[(midnight / dayLength + offset) % pool.length].hId;
  }
  beforeEach(async () => {
    pool = [21, 44, 62].map(hId => ({ hId }));
    holdNext = null;
    await visit();
  });
  afterEach(() => window.close());

  test('updates without a click through pool wraparound and retains focus', async () => {
    expectReading(expected(-1));
    another.focus();
    for (let offset = 0; offset < pool.length; offset++) {
      await clock.tickAsync(offset ? dayLength : 100);
      expectReading(expected(offset));
      expect(document.activeElement).toBe(another);
    }
  });

  test('manual selection survives reload until midnight', async () => {
    another.click();
    await settle();
    const stored = window.sessionStorage.getItem('sunnah-reminder');
    const manual = Number(new URLSearchParams(stored).get('id'));
    expect(manual).not.toBe(expected(-1));
    window.close();
    await visit(stored);
    expect(dialog.open).toBe(false);
    trigger.click();
    expectReading(manual);
    await clock.tickAsync(100);
    expectReading(expected());
  });

  test.each(['visibilitychange', 'pageshow'])('resumes before throttled timers run via %s', async event => {
    clock.setSystemTime(midnight);
    if (event === 'pageshow') window.dispatchEvent(new window.PageTransitionEvent(event, { persisted: true }));
    else document.dispatchEvent(new window.Event(event));
    await settle();
    expectReading(expected());
  });

  test('supersedes an unfinished manual request and ignores its late result', async () => {
    let release;
    holdNext = new Promise(resolve => { release = resolve; });
    another.click();
    await clock.tickAsync(100);
    expectReading(expected());
    release();
    await settle();
    expectReading(expected());
    const saved = new URLSearchParams(window.sessionStorage.getItem('sunnah-reminder'));
    expect(saved.get('day')).toBe(String(midnight / dayLength));
  });

  test('dismissal persists until reopening, singleton and empty pool retire controls', async () => {
    dialog.querySelector('[data-sunnah-close]').click();
    await settle();
    await clock.tickAsync(100);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
    pool = [{ hId: 77 }];
    trigger.click();
    await settle();
    expectReading(77);
    expect(another.hidden).toBe(true);
    pool = [];
    await clock.tickAsync(dayLength);
    expect(dialog.open).toBe(false);
    expect(trigger.hidden).toBe(true);
  });
});
