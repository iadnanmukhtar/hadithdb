const fs = require('fs');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('public/static/js/script.js', 'utf8');
function fn(name) {
  const start = source.indexOf('function ' + name + '(');
  return source.slice(start, source.indexOf('\nfunction ', start + 1));
}
function setup() {
  const surahs = Array.from({ length: 114 }, (_, i) => ({ num: i + 1, ayahs: i === 113 ? 6 : 7, name_en: 'Surah ' + (i + 1) }));
  const html = ejs.render(fs.readFileSync('views/sub-views/quran_audio_range_modal.ejs', 'utf8'), { global: { surahs } });
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const w = dom.window;
  Object.assign(w, {
    bootstrap: { Modal: { getOrCreateInstance: () => ({ show() {}, hide() {} }) } },
    quranPassageAudioStartRef: () => ({ surah: 2, ayah: 3 }),
    quranPassageAudioRepeatEnabled: () => false,
    setQuranPassageAudioRepeat: jest.fn(), startQuranPassageAudio: jest.fn(),
    quranPassageAudioState: {}, setQuranPassageAudioLoading: jest.fn(),
    stopQuranPassageAudio: jest.fn(), playCurrentQuranPassageAudio: jest.fn(),
    loadQuranPassageAudio: jest.fn().mockResolvedValue([{ verseKey: '3:1' }])
  });
  ['openQuranAudioRangeModal', 'continueQuranAudioRange', 'advanceQuranPassageAudio', 'quranPassageAudioRequestRanges'].forEach(name => w.eval(fn(name)));
  return w;
}
test('defaults to the current ayah, no end, continuous playback through 114:6', () => {
  const w = setup(); w.openQuranAudioRangeModal({});
  expect(w.document.querySelector('#quran-audio-start-ayah').value).toBe('3');
  expect(w.document.querySelector('#quran-audio-end-ayah').disabled).toBe(true);
  w.document.querySelector('form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  const options = w.startQuranPassageAudio.mock.calls[0][1];
  expect(options.ranges[0]).toEqual({ surah: 2, from: 3, to: 7 });
  expect(options.ranges.at(-1)).toEqual({ surah: 114, from: 1, to: 6 });
  expect(w.setQuranPassageAudioRepeat).toHaveBeenCalledWith({}, false);
});
test('validates end ordering and includes a custom ending ayah', () => {
  const w = setup(); w.openQuranAudioRangeModal({});
  const end = w.document.querySelector('#quran-audio-end-surah');
  end.value = '1'; end.onchange();
  const submit = () => w.document.querySelector('form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  submit(); expect(w.startQuranPassageAudio).not.toHaveBeenCalled();
  end.value = '3'; end.onchange(); w.document.querySelector('#quran-audio-end-ayah').value = '4';
  w.document.querySelector('#quran-audio-range-loop').checked = true;
  submit(); expect(w.startQuranPassageAudio.mock.calls[0][1].ranges).toEqual([{ surah: 2, from: 3, to: 7 }, { surah: 3, from: 1, to: 4 }]);
  expect(w.setQuranPassageAudioRepeat).toHaveBeenCalledWith({}, true);
});
test.each([false, true])('range end stops or loops according to repeat=%s', async repeat => {
  const w = setup(); const control = {};
  Object.assign(w.quranPassageAudioState, { control, requestId: 1, ranges: [{surah: 2, from: 3, to: 7}], rangeIndex: 0, repeat, playlist: [{}], index: 0 });
  w.advanceQuranPassageAudio(); await Promise.resolve();
  if (repeat) {
    expect(w.loadQuranPassageAudio).toHaveBeenCalledWith(control, { ranges: [{surah: 2, from: 3, to: 7}] });
    expect(w.playCurrentQuranPassageAudio).toHaveBeenCalled();
  } else expect(w.stopQuranPassageAudio).toHaveBeenCalledWith(control);
});
test('crosses a surah boundary even when repeat is enabled; stale completion cannot restart stopped audio', async () => {
  const w = setup(); const state = w.quranPassageAudioState;
  Object.assign(state, {control: {}, requestId: 1, ranges: [{surah: 2, from: 3, to: 7}, {surah: 3, from: 1, to: 4}], rangeIndex: 0, repeat: true, playlist: [{}], index: 0});
  w.advanceQuranPassageAudio(); state.requestId++;
  await Promise.resolve();
  expect(w.loadQuranPassageAudio.mock.calls[0][1].ranges[0].surah).toBe(3);
  expect(w.playCurrentQuranPassageAudio).not.toHaveBeenCalled();
});
test('cross-surah playback advances successfully without losing the original looping range', async () => {
  const w = setup(); const ranges = [{surah: 2, from: 3, to: 7}, {surah: 3, from: 1, to: 4}];
  Object.assign(w.quranPassageAudioState, {control: {}, requestId: 1, ranges, rangeIndex: 0, repeat: true, playlist: [{}], index: 0});
  w.advanceQuranPassageAudio(); await Promise.resolve();
  expect(w.quranPassageAudioState.rangeIndex).toBe(1);
  expect(w.quranPassageAudioState.ranges).toEqual(ranges);
  expect(w.playCurrentQuranPassageAudio).toHaveBeenCalledTimes(1);
});
test('default ref uses the page beginning, selected ayah, or searched ayah', () => {
  const w = setup();
  w.document.body.insertAdjacentHTML('beforeend', '<article data-quran-mushaf-page="2"><div id="control" data-surah="2" data-from="1" data-to="5"></div><span class="quran-mushaf-search-ayah" data-quran-ref="2:4"></span></article>');
  w.quranAudioInteger = Number;
  w.quranAudioRefParts = value => { const [surah, ayah] = value.split(':').map(Number); return {surah, ayah}; };
  w.eval(fn('quranPassageAudioControlRange')); w.eval(fn('quranPassageAudioStartRef'));
  const control = w.document.querySelector('#control');
  expect(w.quranPassageAudioStartRef(control)).toEqual({surah:2, ayah:4});
  control.parentElement.dataset.quranMushafSelectedRef = '2:3';
  expect(w.quranPassageAudioStartRef(control)).toEqual({surah:2, ayah:3});
  delete control.parentElement.dataset.quranMushafSelectedRef;
  w.document.querySelector('.quran-mushaf-search-ayah').remove();
  expect(w.quranPassageAudioStartRef(control)).toEqual({surah:2, ayah:1});
});
