'use strict';
const fs = require('fs');
const { JSDOM } = require('jsdom');
const script = fs.readFileSync(require.resolve('../public/static/js/settings-filter.js'), 'utf8');

test('searching for the saved reciter reveals its card even when the catalog arrives later', async () => {
  const dom = new JSDOM(`
    <nav class="settings-beta-index">
      <input id="settings-filter"><button data-settings-filter-clear></button>
      <span data-settings-filter-status></span><a href="#reading">Reading</a>
    </nav>
    <main id="settings-groups"><section class="settings-beta-group"><h2 id="reading">Reading</h2>
      <details class="settings-beta-row"><summary><strong>Reciter</strong>
        <span data-setting-summary="audio">Ḥuṣary</span></summary><div id="catalog"></div>
      </details>
    </section></main>`, { runScripts: 'outside-only' });
  try {
    const { window } = dom;
    const document = window.document;
    window.eval(script);
    const input = document.querySelector('input');
    input.value = 'husary';
    input.dispatchEvent(new window.Event('input'));
    document.querySelector('#catalog').innerHTML =
      '<div class="reciter-setting-row">Ḥuṣary</div><div class="reciter-setting-row">Juhani</div>';
    await new Promise(resolve => setImmediate(resolve));
    expect(document.querySelector('details').open).toBe(true);
    expect(document.querySelectorAll('.reciter-setting-row:not(.settings-filter-miss)')).toHaveLength(1);
    expect(document.querySelector('.settings-filter-miss').textContent).toBe('Juhani');

    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(document.querySelector('details').open).toBe(false);
    expect(document.querySelector('.settings-filter-miss')).toBeNull();
  } finally {
    dom.window.close();
  }
});
