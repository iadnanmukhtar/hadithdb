const fs = require('fs');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');

test('restoring via the homepage anchor focuses the hero once and leaves refresh focus on the button', async () => {
  const template = fs.readFileSync(require.resolve('../views/sub-views/sunnah_reminder.ejs'), 'utf8');
  const reminder = ejs.render(template, { utils: { scriptAssetVersion: () => 'test' } });
  const dom = new JSDOM(
    '<section id="sunnah-reminder" tabindex="-1" hidden><div data-sunnah-slot></div></section>' + reminder,
    { url: 'https://example.test/#sunnah-reminder', runScripts: 'outside-only' }
  );
  const { window } = dom;
  try {
    let num = 0;
    window.fetch = async () => ({
      ok: true,
      json: async () => ({ id: ++num, num, day: 1, more: true, arabic: 'عربي', english: 'English' })
    });
    window.eval(fs.readFileSync(require.resolve('../public/static/js/sunnah-reminder.js'), 'utf8'));
    await new Promise(resolve => setImmediate(resolve));
    const home = window.document.getElementById('sunnah-reminder');
    expect(window.document.activeElement).toBe(home);
    const another = home.querySelector('[data-sunnah-action="another"]');
    another.focus();
    another.click();
    await new Promise(resolve => setImmediate(resolve));
    expect(home.querySelector('[role=status]').textContent).toBe('Mujtaba 2');
    expect(window.document.activeElement).toBe(another);
  } finally {
    window.close();
  }
});
