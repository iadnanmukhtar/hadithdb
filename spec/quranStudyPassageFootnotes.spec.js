const path = require('path');
const ejs = require('ejs');
const cheerio = require('cheerio');
const utils = require('../lib/Utils');
const arabic = require('../lib/Arabic');

test('the initial Study passage keeps inline references and collects the notes after both columns', async () => {
  const passage = [119, 120, 121, 122].map(ayah => ({
    num: '9:' + ayah,
    ref: 'quran:9:' + ayah,
    quranTranslationAlias: 'en-khattab',
    en: { body: '<section class="content-markdown"><p>Translation <sup class="footnote-ref"><a id="fnref1" href="#fn1">[1]</a></sup></p><section class="footnotes"><ol class="footnotes-list"><li class="footnote-item" id="fn1">Note ' + ayah + '<a class="footnote-backref" href="#fnref1">↩</a></li></ol></section></section>' },
    ar: { body: 'نص' }
  }));
  const html = await ejs.renderFile(path.join(__dirname, '../views/sub-views/quran.ejs'), {
    passage, utils, arabic, site: {}, page: { context: {} }, req: { quranServerRenderedTranslationAlias: 'en-khattab' },
    selectedAyahs: [passage[2]], main: false, title: false, searchResult: false
  });
  const $ = cheerio.load(html);
  const flow = $('[lang="en"] .quran-passage-flow');
  expect(flow.find('.ayah')).toHaveLength(4);
  expect(flow.text()).not.toContain('Note');
  expect(flow.find('.ayah-selected').attr('data-quran-ref')).toBe('9:121');
  const notes = $('.quran-passage-group, article').last().nextAll('.quran-study-notes');
  for (const ayah of [119, 120, 121, 122]) {
    const href = flow.find('[data-quran-ayah="' + ayah + '"] .footnote-ref a').attr('href');
    const number = ayah - 118;
    expect(flow.find('[data-quran-ayah="' + ayah + '"] .footnote-ref a').text()).toBe('[' + number + ']');
    const note = $(href);
    expect(note.attr('value')).toBe(String(number));
    expect(note).toHaveLength(1);
    expect(note.closest('.quran-study-notes')[0]).toBe(notes[0]);
    expect(note.text()).toBe('Note ' + ayah + '↩');
    const backlink = $(note.find('.footnote-backref').attr('href'));
    expect(backlink).toHaveLength(1);
    expect(backlink.closest('[data-quran-ayah]').attr('data-quran-ayah')).toBe(String(ayah));
  }
});
