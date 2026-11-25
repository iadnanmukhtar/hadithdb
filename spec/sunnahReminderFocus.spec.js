const fs = require('fs');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');

test('refresh keeps focus on the modal button and updates the inline reference', async () => {
  const template = fs.readFileSync(require.resolve('../views/sub-views/sunnah_reminder.ejs'), 'utf8');
  const reminder = ejs.render(template, { utils: { scriptAssetVersion: () => 'test' } }, { filename: require.resolve('../views/sub-views/sunnah_reminder.ejs') });
  const dom = new JSDOM(
    '<section id="sunnah-reminder" tabindex="-1" hidden><div data-sunnah-slot></div></section>' + reminder,
    { url: 'https://example.test/#sunnah-reminder', runScripts: 'outside-only' }
  );
  const { window } = dom;
  try {
    window.document.cookie = 'sunnah_session_seen=1; Path=/';
    window.sessionStorage.setItem('sunnah-reminder-layout', 'inline');
    let num = 0;
    window.fetch = async () => ({
      ok: true,
      json: async () => ({ id: ++num, num, day: 1, more: true, arabic: 'عربي', english: 'English' })
    });
    window.eval(fs.readFileSync(require.resolve('../public/static/js/sunnah-reminder.js'), 'utf8'));
    await new Promise(resolve => setImmediate(resolve));
    const dialog = window.document.querySelector('#sunnah-dialog');
    dialog.setAttribute('open', '');
    const another = dialog.querySelector('[data-sunnah-action="another"]');
    another.focus();
    another.click();
    await new Promise(resolve => setImmediate(resolve));
    expect(dialog.querySelector('[role=status]').textContent).toBe('— Mujtaba 2');
    expect(window.document.activeElement).toBe(another);
  } finally {
    window.close();
  }
});
