const path = require('path');
const ejs = require('ejs');
const cheerio = require('cheerio');
const utils = require('../lib/Utils');
const arabic = require('../lib/Arabic');

test('the initial Study passage keeps inline references and collects the notes after both columns', async () => {
  const passage = [120, 121].map(ayah => ({
    num: '9:' + ayah,
    ref: 'quran:9:' + ayah,
    quranTranslationAlias: 'en-khattab',
    en: { body: '<section class="content-markdown"><p>Translation <sup class="footnote-ref"><a href="#fn' + ayah + '">[1]</a></sup></p><section class="footnotes"><ol><li id="fn' + ayah + '">Note ' + ayah + '</li></ol></section></section>' },
    ar: { body: 'نص' }
  }));
  const html = await ejs.renderFile(path.join(__dirname, '../views/sub-views/quran.ejs'), {
    passage, utils, arabic, site: {}, page: { context: {} }, req: { quranServerRenderedTranslationAlias: 'en-khattab' },
    selectedAyahs: [passage[1]], main: false, title: false, searchResult: false
  });
  const $ = cheerio.load(html);
  const flow = $('[lang="en"] .quran-passage-flow');
  expect(flow.find('.ayah')).toHaveLength(2);
  expect(flow.text()).not.toContain('Note');
  expect(flow.find('.ayah-selected').attr('data-quran-ref')).toBe('9:121');
  const notes = $('.quran-passage-group, article').last().nextAll('.quran-study-notes');
  for (const ayah of [120, 121]) {
    const href = flow.find('[data-quran-ayah="' + ayah + '"] .footnote-ref a').attr('href');
    expect(notes.find(href).text()).toBe('Note ' + ayah);
  }
});
