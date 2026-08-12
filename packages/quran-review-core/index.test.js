'use strict';

const core = require('./index');

test('validates canonical Quran references', () => {
  expect(core.parseRefString('quran:2:286')).toEqual({ surah: 2, ayah: 286 });
  expect(core.parseRefString('2:287')).toBeNull();
});

test('normalizes native and web session request fields', () => {
  expect(core.sessionRequestBody({ mode: 'page', pageNumber: 529, reviewUnit: 'passage', continueForward: true })).toEqual({
    mode: 'page', review_unit: 'passage', page_number: 529, continue_forward: true
  });
  expect(core.sessionRequestBody({ mode: 'passage', start_ref: '1:1' })).toEqual({
    mode: 'passage', review_unit: 'ayah', surah_number: 1, start_ref: '1:1'
  });
});

test('builds idempotent grade payloads', () => {
  const body = core.gradeRequestBody({ grade: 'good', sessionId: 's1', attemptToken: 'a1', dayStart: '2026-08-11T05:00:00.000Z', durationSeconds: 4.6 });
  expect(body).toEqual({ grade: 'good', session_id: 's1', attempt_token: 'a1', day_start: '2026-08-11T05:00:00.000Z', duration_seconds: 5 });
});

test('normalizes the next remote item for local content lookup', () => {
  expect(core.nextItemTarget({ ayah: { surah_number: 2, ayah_number: 255, page_number: 42 } })).toMatchObject({ complete: false, ref: '2:255', pageNumber: 42 });
  expect(core.nextItemTarget({ complete: true })).toEqual({ complete: true });
});

test('normalizes Quran Arabic with the web search rules', () => {
  expect(core.quranSearchNormalizeArabic('ذَٰلِكَ الْكِتَابُ')).toBe('ذلك الكتاب');
  expect(core.quranSearchNormalizeArabic('رَحْمَةٌ')).toBe('رحمت');
  expect(core.quranSearchMatches(core.quranSearchNormalizeArabic('بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ'), 'الرحمن')).toBe(true);
});

test('builds canonical Quran Study paths', () => {
  expect(core.quranStudyPath('2:255')).toBe('/quran:2:255');
  expect(core.quranStudyPath({ surah: 1, ayah: 7 })).toBe('/quran:1:7');
  expect(core.quranStudyPath('2:999')).toBe('');
});

test('shares the four initial assessment stages', () => {
  expect(core.INITIAL_ASSESSMENT_STAGES).toEqual([
    { state: 'learning', label: 'Learn' },
    { state: 'weak', label: 'Hard' },
    { state: 'review', label: 'Good' },
    { state: 'core', label: 'Easy' }
  ]);
});
