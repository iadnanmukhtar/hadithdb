const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const ejs = require('ejs');
const cheerio = require('cheerio');
const utils = require('../lib/Utils');
const arabic = require('../lib/Arabic');

async function renderPassage() {
  const passage = [119, 120, 121, 122].map(ayah => ({
    num: '9:' + ayah,
    ref: 'quran:9:' + ayah,
    quranTranslationAlias: 'en-khattab',
    en: { body: '<section class="content-markdown"><p>Translation <sup class="footnote-ref"><a id="fnref1" href="#fn1">[1]</a></sup></p><section class="footnotes"><ol class="footnotes-list"><li class="footnote-item" id="fn1">Note ' + ayah + '<a class="footnote-backref" href="#fnref1">↩</a></li></ol></section></section>' },
    ar: { body: 'نص' }
  }));
  // The shared footnote handler also accepts the marker class on the anchor itself.
  passage[2].en.body = passage[2].en.body.replace('<sup class="footnote-ref"><a', '<sup><a class="footnote-ref"');
  return ejs.renderFile(path.join(__dirname, '../views/sub-views/quran.ejs'), {
    passage, utils, arabic, site: {}, page: { context: {} }, req: { quranServerRenderedTranslationAlias: 'en-khattab' },
    selectedAyahs: [passage[2]], main: false, title: false, searchResult: false
  });
}

test('the initial Study passage keeps inline references and collects the notes after both columns', async () => {
  const $ = cheerio.load(await renderPassage());
  const flow = $('[lang="en"] .quran-passage-flow');
  expect(flow.find('.ayah')).toHaveLength(4);
  expect(flow.text()).not.toContain('Note');
  expect(flow.find('.ayah-selected').attr('data-quran-ref')).toBe('9:121');
  const notes = $('.quran-passage-group, article').last().nextAll('.quran-study-notes');
  for (const ayah of [119, 120, 121, 122]) {
    const href = flow.find('[data-quran-ayah="' + ayah + '"] sup a').attr('href');
    const number = ayah - 118;
    expect(flow.find('[data-quran-ayah="' + ayah + '"] sup a').text()).toBe('[' + number + ']');
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


test('switching translations on a newly rendered passage retains its original notes for restoration', async () => {
  const { document } = new JSDOM(await renderPassage()).window;
  const source = fs.readFileSync(path.join(__dirname, '../public/static/js/script.js'), 'utf8');
  const book = { source: 'local', alias: 'other' };
  const context = vm.createContext({
    document,
    quranTranslationBooks: async () => [book],
    applyQuranTranslationToTargets: async (targets, selectedBook) => {
      for (const target of targets) {
        context.storeDefaultQuranTranslationTarget(target);
        target.innerHTML = context.quranPassageTranslationHtml(
          selectedBook === book ? 'Alternate translation' : target.dataset.quranDefaultTranslationHtml,
          target, selectedBook.alias);
        context.normalizeQuranSelectedTranslationFootnotes(context.quranSelectedTranslationFootnoteHolder(target));
      }
    },
    quranDefaultTranslationBook: () => ({ source: 'default' })
  });
  vm.runInContext(source.slice(source.indexOf('function quranTranslationFootnoteIdPart'),
    source.indexOf('function restoreDefaultQuranTranslationEditor')), context);
  vm.runInContext(source.slice(source.indexOf('function applyQuranHeroTranslationAlias'),
    source.indexOf('function updateQuranTranslationPreferenceHearts')), context);
  await context.applyQuranHeroTranslationAlias(book.alias);
  expect(document.querySelectorAll('.footnote-item')).toHaveLength(0);
  await context.applyQuranHeroTranslationAlias('');
  const marker = document.querySelector('[data-quran-ref="9:121"] sup a');
  const note = document.getElementById(marker.hash.slice(1));
  expect(note?.textContent).toBe('Note 121↩');
  expect(note.closest('.quran-study-notes')).toBeTruthy();
  expect(marker.textContent).toBe('[3]');
  expect(document.getElementById(note.querySelector('a').hash.slice(1))).toBe(marker);
});
