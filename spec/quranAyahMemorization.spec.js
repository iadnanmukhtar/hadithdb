/* jslint node:true, esversion:9 */
'use strict';

const QuranAyahMemorization = require('../lib/QuranAyahMemorization');

describe('QuranAyahMemorization public ayah helpers', () => {
  let originalSurahs;

  beforeEach(() => {
    originalSurahs = global.surahs;
    global.surahs = [
      { num: 1, ayahs: 7 },
      { num: 2, ayahs: 286 },
      { num: 114, ayahs: 6 }
    ];
  });

  afterEach(() => {
    global.surahs = originalSurahs;
  });

  test('uses the seven lifecycle states and their user-facing labels', () => {
    expect(Array.from(QuranAyahMemorization.LIFECYCLE_STATES)).toEqual([
      'later',
      'learning',
      'weak',
      'review',
      'core',
      'relearning',
      'suspended'
    ]);
    expect(QuranAyahMemorization.STATE_LABELS).toEqual({
      later: 'Later',
      learning: 'Learning',
      weak: 'Weak',
      review: 'Memorized',
      core: 'Core',
      relearning: 'Relearning',
      suspended: 'Paused'
    });
    expect(QuranAyahMemorization.STATE_DESCRIPTIONS.weak).toBe('Memorized, with recall assessed as fragile');
    expect(QuranAyahMemorization.STATE_DESCRIPTIONS.relearning).toBe('Automatic recovery after Again on a Memorized ayah');
  });

  test('keeps review outcomes separate from lifecycle states', () => {
    expect(Array.from(QuranAyahMemorization.REVIEW_GRADES)).toEqual([
      'again',
      'hard',
      'good',
      'easy',
      'skip'
    ]);
    expect(QuranAyahMemorization.LIFECYCLE_STATES.has('hard')).toBe(false);
    expect(QuranAyahMemorization.LIFECYCLE_STATES.has('again')).toBe(false);
    expect(QuranAyahMemorization.REVIEW_GRADES.has('core')).toBe(false);
  });

  test('treats Core as memorized while removing it from scheduled review', () => {
    const memorizedAt = new Date('2026-07-01T12:00:00Z');
    const values = QuranAyahMemorization.stateUpdateValues({
      lifecycle_state: 'review',
      fully_memorized_at: memorizedAt,
      next_review_at: new Date('2026-08-01T12:00:00Z'),
      stability: 21,
      difficulty: 4,
      review_count: 8,
      lapse_count: 1,
      relearning_step: 1,
      suspended_at: new Date('2026-07-02T12:00:00Z'),
      suspended_from_state: 'review'
    }, 'core');

    expect(values).toEqual({
      lifecycle_state: 'core',
      fully_memorized_at: memorizedAt,
      stability: 7,
      difficulty: 1,
      next_review_at: null,
      fsrs_state: 2,
      fsrs_scheduled_days: 0,
      fsrs_learning_steps: 0,
      fsrs_version: 6,
      relearning_step: 0,
      suspended_at: null,
      suspended_from_state: null
    });
    expect(values).not.toHaveProperty('review_count');
    expect(values).not.toHaveProperty('lapse_count');
  });

  test('initializes Core memorization for an untouched ayah', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-31T12:00:00Z'));
    try {
      const values = QuranAyahMemorization.stateUpdateValues({
        lifecycle_state: 'later',
        fully_memorized_at: null
      }, 'core');
      expect(values).toEqual({
        lifecycle_state: 'core',
        fully_memorized_at: new Date('2026-07-31T12:00:00Z'),
        stability: 7,
        difficulty: 1,
        next_review_at: null,
        fsrs_state: 2,
        fsrs_scheduled_days: 0,
        fsrs_learning_steps: 0,
        fsrs_version: 6,
        relearning_step: 0,
        suspended_at: null,
        suspended_from_state: null
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test('uses the Memorized assessment when moving Core back to spaced review', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-31T12:00:00Z'));
    try {
      const memorizedAt = new Date('2020-01-01T00:00:00Z');
      expect(QuranAyahMemorization.stateUpdateValues({
        lifecycle_state: 'core',
        fully_memorized_at: memorizedAt,
        stability: 30,
        difficulty: 3,
        consecutive_successes: 9
      }, 'review')).toMatchObject({
        lifecycle_state: 'review',
        fully_memorized_at: memorizedAt,
        stability: 3.5,
        difficulty: 2.11810397,
        consecutive_successes: 9,
        next_review_at: new Date('2026-08-04T12:00:00Z')
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test('initializes an ungraded Weak ayah from a Hard FSRS assessment', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-31T12:00:00Z'));
    try {
      expect(QuranAyahMemorization.stateUpdateValues({
        lifecycle_state: 'learning',
        learning_progress: 'partial',
        stability: 0,
        difficulty: 5,
        review_count: 0
      }, 'weak')).toMatchObject({
        lifecycle_state: 'weak',
        learning_progress: 'partial',
        stability: 1.6,
        difficulty: 5.11217071,
        next_review_at: new Date('2026-08-02T12:00:00Z'),
        fsrs_state: 2,
        fsrs_version: 6
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test('lets a manual Weak assessment replace the previous FSRS estimate', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-31T12:00:00Z'));
    try {
      const values = QuranAyahMemorization.stateUpdateValues({
        lifecycle_state: 'review',
        fsrs_state: 2,
        stability: 42.25,
        difficulty: 6.4,
        review_count: 8,
        next_review_at: new Date('2026-09-01T00:00:00Z')
      }, 'weak');
      expect(values).toMatchObject({
        lifecycle_state: 'weak',
        stability: 1.6,
        difficulty: 5.11217071,
        next_review_at: new Date('2026-08-02T12:00:00Z'),
        fsrs_state: 2
      });
      expect(values).not.toHaveProperty('review_count');
    } finally {
      jest.useRealTimers();
    }
  });

  test('initializes Learning as a New FSRS card for bounded session admission', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-31T12:00:00Z'));
    try {
      expect(QuranAyahMemorization.stateUpdateValues({
        lifecycle_state: 'later',
        learning_progress: null
      }, 'learning')).toMatchObject({
        lifecycle_state: 'learning',
        learning_progress: 'started',
        next_review_at: null,
        fsrs_state: 0,
        fsrs_version: 6
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test('only treats invariant-safe Core rows as unchanged in a whole-surah update', () => {
    const clean = {
      lifecycle_state: 'core',
      fully_memorized_at: new Date('2020-01-01T00:00:00Z'),
      next_review_at: null,
      relearning_step: 0,
      suspended_at: null,
      suspended_from_state: null
    };
    expect(QuranAyahMemorization.isCleanCoreRow(clean)).toBe(true);
    expect(QuranAyahMemorization.isCleanCoreRow(Object.assign({}, clean, { next_review_at: new Date() }))).toBe(false);
    expect(QuranAyahMemorization.isCleanCoreRow(Object.assign({}, clean, { fully_memorized_at: null }))).toBe(false);
    expect(QuranAyahMemorization.isCleanCoreRow(Object.assign({}, clean, { relearning_step: 1 }))).toBe(false);
    expect(QuranAyahMemorization.isCleanCoreRow(Object.assign({}, clean, { lifecycle_state: 'review' }))).toBe(false);
  });

  test('does not let a non-canonical Core row make a surah look fully Core', () => {
    const rows = [1, 2, 3, 4, 5, 7].map(ayah => ({ surah_number: 114, ayah_number: ayah }));
    expect(QuranAyahMemorization.buildCoreSurahStatuses([114], rows)).toEqual([{
      surah_number: 114,
      ayah_count: 6,
      core_count: 5,
      is_core: false
    }]);
  });

  test('summarizes untouched āyāt as Later and reports mixed surah states', () => {
    expect(QuranAyahMemorization.buildSurahStateStatuses([114], [
      { surah_number: 114, ayah_number: 1, lifecycle_state: 'learning' },
      { surah_number: 114, ayah_number: 2, lifecycle_state: 'core' },
      { surah_number: 114, ayah_number: 7, lifecycle_state: 'review' }
    ])).toEqual([{
      surah_number: 114,
      ayah_count: 6,
      counts: { later: 4, learning: 1, weak: 0, review: 0, core: 1, relearning: 0, suspended: 0 },
      uniform_state: null
    }]);
    expect(QuranAyahMemorization.buildSurahStateStatuses([114], [])).toEqual([{
      surah_number: 114,
      ayah_count: 6,
      counts: { later: 6, learning: 0, weak: 0, review: 0, core: 0, relearning: 0, suspended: 0 },
      uniform_state: 'later'
    }]);
  });

  test('remembers Core when it is temporarily Paused', () => {
    expect(QuranAyahMemorization.stateUpdateValues({
      lifecycle_state: 'core',
      suspended_from_state: null
    }, 'suspended')).toMatchObject({
      lifecycle_state: 'suspended',
      suspended_from_state: 'core'
    });
    expect(QuranAyahMemorization.stateUpdateValues({
      lifecycle_state: 'suspended',
      suspended_from_state: 'core'
    }, 'core')).toEqual({
      lifecycle_state: 'core',
      suspended_at: null,
      suspended_from_state: null
    });
  });

  test('parses a canonical surah and ayah identity', () => {
    expect(QuranAyahMemorization.parseRef('2', '255')).toEqual({ surah: 2, ayah: 255 });
    expect(QuranAyahMemorization.parseRef(114, 6)).toEqual({ surah: 114, ayah: 6 });
  });

  test.each([
    [0, 1],
    [115, 1],
    [2, 0],
    [2, 287],
    [114, 7],
    ['02', 1],
    ['2x', 1],
    [2, '255foo'],
    ['not-a-surah', 1],
    [2, 'not-an-ayah']
  ])('rejects a non-canonical reference %s:%s', (surah, ayah) => {
    expect(QuranAyahMemorization.parseRef(surah, ayah)).toBeNull();
  });

  test('normalizes mixed reference forms, removes duplicates, and preserves order', () => {
    expect(QuranAyahMemorization.normalizeRefs([
      '2:255',
      'quran:2:255',
      { surah: 1, ayah: 7 },
      '2:287',
      '114:6'
    ])).toEqual([
      { surah: 2, ayah: 255 },
      { surah: 1, ayah: 7 },
      { surah: 114, ayah: 6 }
    ]);
  });

  test('bounds batched reference normalization', () => {
    expect(QuranAyahMemorization.normalizeRefs('1:1,1:2,1:3,1:4', 2)).toEqual([
      { surah: 1, ayah: 1 },
      { surah: 1, ayah: 2 }
    ]);
  });

  test('builds one canonical reference list for a Mushaf page shared by surahs', () => {
    expect(QuranAyahMemorization.buildMushafPageRefs([
      { surah: 2, ayah: 141 },
      { surah: 2, ayah: 141 },
      { surah: 2, ayah: 142 },
      { surah: 3, ayah: 1 },
      { surah: 115, ayah: 1 }
    ])).toEqual(['2:141', '2:142', '3:1']);
  });

  test('includes every Juz represented by a progress row', () => {
    const juzRows = [
      { num: 1, start: '' },
      { num: 2, start: '2:142' },
      { num: 3, start: '2:253' }
    ];
    expect(QuranAyahMemorization.juzNumbersForRefs(['1:1', '2:141'], juzRows)).toEqual([1]);
    expect(QuranAyahMemorization.juzNumbersForRefs(['2:141', '2:142'], juzRows)).toEqual([1, 2]);
    expect(QuranAyahMemorization.juzNumbersForRefs(['2:253'], juzRows)).toEqual([3]);
  });

  describe('progress grouping', () => {
    const definitions = () => QuranAyahMemorization.buildProgressGroupDefinitions([
      { surah: 1, line_count: 30 },
      { surah: 2, line_count: 31 },
      { surah: 3, line_count: 40 }
    ], [
      { surah: 1, ayah: 1, page_number: 1, first_word_id: 1 },
      { surah: 1, ayah: 2, page_number: 1, first_word_id: 8 },
      { surah: 2, ayah: 1, page_number: 2, first_word_id: 20 },
      { surah: 2, ayah: 2, page_number: 2, first_word_id: 27 },
      { surah: 3, ayah: 1, page_number: 2, first_word_id: 40 },
      { surah: 3, ayah: 2, page_number: 2, first_word_id: 45 }
    ], [
      { page_number: 1, surah: 1, ayah: 1, first_word_id: 1 },
      { page_number: 2, surah: 2, ayah: 1, first_word_id: 20 }
    ]);

    test('derives page starts and distinct surah line counts without range joins', () => {
      const geometry = QuranAyahMemorization.buildProgressGeometry([
        { page_number: 1, line_number: 1, first_word_id: 1, last_word_id: 4 },
        { page_number: 1, line_number: 2, first_word_id: 5, last_word_id: 8 },
        { page_number: 2, line_number: 1, first_word_id: 9, last_word_id: 12 }
      ], [
        { surah: 1, ayah: 1, global_word_id: 1 },
        { surah: 1, ayah: 1, global_word_id: 2 },
        { surah: 2, ayah: 1, global_word_id: 3 },
        { surah: 2, ayah: 1, global_word_id: 5 },
        { surah: 2, ayah: 2, global_word_id: 9 }
      ]);

      expect(geometry.lineCounts).toEqual([
        { surah: 1, line_count: 1 },
        { surah: 2, line_count: 3 }
      ]);
      expect(geometry.pageStarts).toEqual([
        { page_number: 1, surah: 1, ayah: 1, first_word_id: 1 },
        { page_number: 2, surah: 2, ayah: 2, first_word_id: 9 }
      ]);
      expect(geometry.ayahStarts).toEqual([
        { surah: 1, ayah: 1, first_word_id: 1, page_number: 1 },
        { surah: 2, ayah: 1, first_word_id: 3, page_number: 1 },
        { surah: 2, ayah: 2, first_word_id: 9, page_number: 2 }
      ]);
    });

    test('uses one row for a short surah and page rows for longer surahs', () => {
      const result = definitions();

      expect(result.shortSurahs.has(1)).toBe(true);
      expect(result.shortSurahs.has(2)).toBe(false);
      expect(result.groups.map(group => group.group_key)).toEqual([
        'surah:1',
        'surah-page:2:2',
        'surah-page:3:2'
      ]);
      expect(result.groups[0]).toMatchObject({
        group_type: 'surah',
        unit_label: 'Whole surah',
        page_number: 1,
        surah_number: 1,
        start_surah_number: 1,
        start_ayah_number: 1,
        member_refs: ['1:1', '1:2']
      });
      expect(result.groups[1]).toMatchObject({
        group_type: 'page',
        page_number: 2,
        surah_number: 2,
        start_surah_number: 2,
        start_ayah_number: 1,
        member_refs: ['2:1', '2:2']
      });
      expect(result.groups[2]).toMatchObject({
        group_type: 'page',
        page_number: 2,
        surah_number: 3,
        start_surah_number: 3,
        start_ayah_number: 1,
        member_refs: ['3:1', '3:2']
      });
    });

    test('counts active stages once and leaves Later rows out of grouped progress', () => {
      const result = QuranAyahMemorization.buildProgressGroups(definitions(), [
        { surah_number: 1, ayah_number: 1, lifecycle_state: 'learning', fsrs_state: 0, review_count: 0 },
        { surah_number: 1, ayah_number: 2, lifecycle_state: 'review', fsrs_state: 2, next_review_at: '2026-07-30T12:00:00Z', review_count: 2 },
        { surah_number: 2, ayah_number: 1, lifecycle_state: 'review', fsrs_state: 2, next_review_at: '2026-08-03T12:00:00Z', review_count: 3 },
        { surah_number: 2, ayah_number: 2, lifecycle_state: 'later', review_count: 5 },
        { surah_number: 3, ayah_number: 1, lifecycle_state: 'suspended', next_review_at: '2026-07-29T12:00:00Z', review_count: 4 },
        { surah_number: 3, ayah_number: 2, lifecycle_state: 'core', next_review_at: '2026-07-28T12:00:00Z', review_count: 6 }
      ], '2026-07-31T12:00:00Z');

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        group_key: 'surah:1',
        counts: { learning: 1, weak: 0, review: 1, core: 0, relearning: 0, suspended: 0 },
        stage_start_references: { learning: '1:1', review: '1:2' },
        stage_start_pages: { learning: 1, review: 1 },
        active_ayah_count: 2,
        member_count: 2,
        due_count: 1,
        new_count: 1,
        next_review_at: '2026-07-30T12:00:00Z',
        review_count: 2
      });
      expect(result[1]).toMatchObject({
        group_key: 'surah-page:2:2',
        counts: { learning: 0, weak: 0, review: 1, core: 0, relearning: 0, suspended: 0 },
        stage_start_references: { review: '2:1' },
        stage_start_pages: { review: 2 },
        active_ayah_count: 1,
        due_count: 0,
        next_review_at: '2026-08-03T12:00:00Z',
        review_count: 3
      });
      expect(result[2]).toMatchObject({
        group_key: 'surah-page:3:2',
        counts: { learning: 0, weak: 0, review: 0, core: 1, relearning: 0, suspended: 1 },
        stage_start_references: { suspended: '3:1', core: '3:2' },
        stage_start_pages: { suspended: 2, core: 2 },
        active_ayah_count: 2,
        due_count: 0,
        next_review_at: null,
        review_count: 10
      });
    });
  });

  describe('FSRS 6 scheduling', () => {
    const reviewedAyah = () => ({
      lifecycle_state: 'review',
      stability: 1,
      difficulty: 5,
      last_reviewed_at: '2026-07-30T12:00:00Z',
      next_review_at: '2026-07-31T12:00:00Z',
      review_count: 1,
      lapse_count: 0,
      consecutive_successes: 0,
      relearning_step: 0,
      fsrs_state: 2,
      fsrs_scheduled_days: 1,
      fsrs_learning_steps: 0
    });
    const schedule = (ayah, grade, settings) => QuranAyahMemorization.reviewSchedule(
      ayah, grade, settings, '2026-07-31T12:00:00Z'
    );

    test('uses the FSRS 6 grade ordering and records a lapse only for Again', () => {
      const again = schedule(reviewedAyah(), 'again');
      const hard = schedule(reviewedAyah(), 'hard');
      const good = schedule(reviewedAyah(), 'good');
      const easy = schedule(reviewedAyah(), 'easy');

      expect(again).toMatchObject({ lifecycle_state: 'relearning', lapse_count: 1, fsrs_state: 2 });
      expect(hard).toMatchObject({ lifecycle_state: 'review', lapse_count: 0 });
      expect(hard.interval).toBeLessThan(good.interval);
      expect(good.interval).toBeLessThan(easy.interval);
    });

    test('keeps Weak under user control while FSRS updates its memory model', () => {
      const weakAyah = { ...reviewedAyah(), lifecycle_state: 'weak', stability: 0.5, difficulty: 7 };
      const again = schedule(weakAyah, 'again');
      const good = schedule(weakAyah, 'good');
      const easy = schedule(weakAyah, 'easy');

      expect(again).toMatchObject({ lifecycle_state: 'weak', lapse_count: 1 });
      expect(good.lifecycle_state).toBe('weak');
      expect(easy.lifecycle_state).toBe('weak');
      expect(good.stability).toBeGreaterThan(again.stability);
      expect(easy.stability).toBeGreaterThan(good.stability);
    });

    test('uses bounded Learning steps and graduates on the second Good or first Easy', () => {
      const learningAyah = {
        lifecycle_state: 'learning',
        learning_progress: 'started',
        stability: 0.5,
        difficulty: 5,
        lapse_count: 0,
        consecutive_successes: 0,
        relearning_step: 0
      };
      const again = schedule(learningAyah, 'again');
      const hard = schedule(learningAyah, 'hard');
      const firstGood = schedule(learningAyah, 'good');
      const secondGood = schedule({ ...learningAyah, ...firstGood, last_reviewed_at:'2026-07-27T12:00:00Z', review_count:1 }, 'good');
      const easy = schedule(learningAyah, 'easy');

      expect(again).toMatchObject({
        lifecycle_state: 'learning',
        learning_progress: 'started',
        interval: 1
      });
      expect(again.graduated).toBe(false);
      expect(hard).toMatchObject({
        lifecycle_state: 'learning',
        learning_progress: 'started',
        interval: 2,
        graduated: false
      });
      expect(firstGood).toMatchObject({
        lifecycle_state: 'learning',
        learning_progress: 'partial',
        interval: 4,
        graduated: false
      });
      expect(secondGood).toMatchObject({
        lifecycle_state: 'review',
        learning_progress: 'nearly_memorized',
        graduated: true
      });
      expect(easy).toMatchObject({
        lifecycle_state: 'review',
        learning_progress: 'nearly_memorized',
        interval: 7,
        graduated: true
      });
    });

    test('allows exactly one Again retry for a Learning review item', () => {
      expect(QuranAyahMemorization.shouldQueueReviewRetry('again', 0)).toBe(true);
      expect(QuranAyahMemorization.shouldQueueReviewRetry('again', 1)).toBe(false);
      expect(QuranAyahMemorization.shouldQueueReviewRetry('hard', 0)).toBe(false);
    });

    test('returns Relearning to Memorized after a successful recovery review', () => {
      const relearning = { ...reviewedAyah(), lifecycle_state:'relearning', stability:0.4, difficulty:8, lapse_count:1 };
      const recovered = schedule(relearning, 'good');
      expect(recovered).toMatchObject({ lifecycle_state: 'review', consecutive_successes: 1 });
      expect(recovered.interval).toBeGreaterThanOrEqual(1);
    });

    test('applies target retention and simplified FSRS parameter presets', () => {
      const standard = schedule(reviewedAyah(), 'good');
      const highRetention = schedule(reviewedAyah(), 'good', { targetRetention:0.95 });
      const conservative = schedule(reviewedAyah(), 'good', { intervalGrowth:'conservative' });
      const aggressive = schedule(reviewedAyah(), 'good', { intervalGrowth:'aggressive' });
      expect(highRetention.interval).toBeLessThanOrEqual(standard.interval);
      expect(conservative.stability).toBeLessThan(aggressive.stability);
    });
  });

  describe('review session admission', () => {
    const rows = (state, count, surah) => Array.from({ length: count }, (_, index) => ({
      surah_number: surah,
      ayah_number: index + 1,
      lifecycle_state: state
    }));
    const limits = { learning: 3, relearning: 4, weak: 3, memorized: 10 };
    const order = 'next_review_at, surah_number, ayah_number';

    test('allocates independent category caps fairly under the overall limit', async () => {
      const query = jest.fn()
        .mockResolvedValueOnce(rows('learning', 3, 1))
        .mockResolvedValueOnce(rows('relearning', 4, 2))
        .mockResolvedValueOnce(rows('weak', 3, 3))
        .mockResolvedValueOnce(rows('review', 10, 4));

      const result = await QuranAyahMemorization.selectReviewSessionItems(query, 'user-1', 10, limits, order);

      expect(result.learning).toHaveLength(3);
      expect(result.relearning).toHaveLength(3);
      expect(result.weak).toHaveLength(2);
      expect(result.memorized).toHaveLength(2);
      expect(result.scheduled).toEqual(result.weak.concat(result.memorized));
      expect(result.fresh).toBe(false);
      expect(query).toHaveBeenCalledTimes(4);
      expect(query.mock.calls.map(call => call[0].match(/lifecycle_state='([^']+)'/)[1])).toEqual([
        'learning', 'relearning', 'weak', 'review'
      ]);
      expect(query.mock.calls[0][0]).toContain('LIMIT 3 FOR UPDATE');
      expect(query.mock.calls[1][0]).toContain('LIMIT 4 FOR UPDATE');
      expect(query.mock.calls[2][0]).toContain('LIMIT 3 FOR UPDATE');
      expect(query.mock.calls[3][0]).toContain('LIMIT 10 FOR UPDATE');
    });

    test('lets one due category use otherwise unused overall capacity', async () => {
      const memorized = rows('review', 10, 2);
      const query = jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(memorized);

      const result = await QuranAyahMemorization.selectReviewSessionItems(query, 'user-1', 10, limits, order);

      expect(result.learning).toEqual([]);
      expect(result.relearning).toEqual([]);
      expect(result.weak).toEqual([]);
      expect(result.memorized).toEqual(memorized);
      expect(result.fresh).toBe(false);
    });

    test('starts a fresh session with future Learning first when nothing is due', async () => {
      const futureLearning = rows('learning', 2, 1);
      const futureWeak = rows('weak', 1, 2);
      const futureMemorized = rows('review', 2, 3);
      const query = jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(futureLearning)
        .mockResolvedValueOnce(futureWeak)
        .mockResolvedValueOnce(futureMemorized);

      const result = await QuranAyahMemorization.selectReviewSessionItems(query, 'user-1', 5, limits, order);

      expect(result.learning).toEqual(futureLearning);
      expect(result.relearning).toEqual([]);
      expect(result.weak).toEqual(futureWeak);
      expect(result.memorized).toEqual(futureMemorized);
      expect(result.fresh).toBe(true);
      expect(query).toHaveBeenCalledTimes(7);
      expect(query.mock.calls.slice(4).every(call => call[0].includes('next_review_at>NOW()'))).toBe(true);
      expect(query.mock.calls.slice(4).some(call => call[0].includes("lifecycle_state='relearning'"))).toBe(false);
    });

    test('does not add future cards while any due card remains', async () => {
      const due = rows('review', 1, 2);
      const query = jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(due);

      const result = await QuranAyahMemorization.selectReviewSessionItems(query, 'user-1', 10, limits, order);

      expect(result.memorized).toEqual(due);
      expect(result.fresh).toBe(false);
      expect(query).toHaveBeenCalledTimes(4);
    });

    test('queues every non-Later ayah in a Surah Review without category caps', async () => {
      const ordered = [
        { surah_number: 2, ayah_number: 1, lifecycle_state: 'review', fsrs_state: 2 },
        { surah_number: 2, ayah_number: 2, lifecycle_state: 'learning', fsrs_state: 0 },
        { surah_number: 2, ayah_number: 3, lifecycle_state: 'weak', fsrs_state: 2 },
        { surah_number: 2, ayah_number: 4, lifecycle_state: 'relearning', fsrs_state: 3 },
        { surah_number: 2, ayah_number: 5, lifecycle_state: 'core', fsrs_state: 2 },
        { surah_number: 2, ayah_number: 6, lifecycle_state: 'suspended', fsrs_state: 2 }
      ];
      const query = jest.fn().mockResolvedValue(ordered);

      const result = await QuranAyahMemorization.selectSurahReviewSessionItems(query, 'user-1', 2);

      expect(result.items).toEqual(ordered);
      expect(result.learning).toEqual([ordered[1]]);
      expect(result.relearning).toEqual([ordered[3]]);
      expect(result.weak).toEqual([ordered[2]]);
      expect(result.memorized).toEqual([ordered[0]]);
      expect(result.core).toEqual([ordered[4]]);
      expect(result.suspended).toEqual([ordered[5]]);
      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0][0]).toContain("lifecycle_state IN ('learning','relearning','weak','review','core','suspended')");
      expect(query.mock.calls[0][0]).toContain('ORDER BY surah_number, ayah_number');
      expect(query.mock.calls[0][0]).not.toContain('LIMIT');
    });

    test('queues a Mushaf page across surahs without applying a surah condition', async () => {
      const ordered = [
        { surah_number: 8, ayah_number: 75, lifecycle_state: 'review', fsrs_state: 2 },
        { surah_number: 9, ayah_number: 1, lifecycle_state: 'core', fsrs_state: 2 }
      ];
      const query = jest.fn().mockResolvedValue(ordered);

      const result = await QuranAyahMemorization.selectSurahReviewSessionItems(query, 'user-1', null, ['8:75', '9:1']);

      expect(result.items).toEqual(ordered);
      expect(query.mock.calls[0][0]).not.toContain('AND surah_number=');
      expect(query.mock.calls[0][0]).toContain('(surah_number,ayah_number) IN ((8,75),(9,1))');
    });
  });
});
