/* jslint node:true, esversion:9 */
'use strict';

const QuranAyahMemorization = require('../lib/QuranAyahMemorization');
const QuranFsrs = require('../lib/QuranFsrs');

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
      weak: 'Hard',
      review: 'Good',
      core: 'Easy',
      relearning: 'Hard',
      suspended: 'Paused'
    });
    expect(QuranAyahMemorization.STATE_DESCRIPTIONS.weak).toBe('Hard recall, scheduled with shorter intervals');
    expect(QuranAyahMemorization.STATE_DESCRIPTIONS.relearning).toBe('Hard recall under automatic recovery after Again');
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

  test('keeps the entire review schedule in surah and ayah order', () => {
    const items = [
      { surah_number: 2, ayah_number: 10, lifecycle_state: 'learning' },
      { surah_number: 3, ayah_number: 4, lifecycle_state: 'relearning' },
      { surah_number: 2, ayah_number: 3, lifecycle_state: 'weak' },
      { surah_number: 3, ayah_number: 1, lifecycle_state: 'review' },
      { surah_number: 2, ayah_number: 7, lifecycle_state: 'review' }
    ];

    expect(QuranAyahMemorization.orderReviewItemsBySurah(items).map(item =>
      `${item.surah_number}:${item.ayah_number}`)).toEqual([
      '2:3', '2:7', '2:10', '3:1', '3:4'
    ]);
  });

  test('introduces small passages from other surahs into a regular review candidate queue', () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, index) => ({ surah_number: 2, ayah_number: index + 1 })),
      ...Array.from({ length: 4 }, (_, index) => ({ surah_number: 18, ayah_number: index + 1 })),
      ...Array.from({ length: 2 }, (_, index) => ({ surah_number: 72, ayah_number: index + 1 }))
    ];

    expect(QuranAyahMemorization.diversifyReviewCandidatesBySurah(rows, 3).map(item =>
      `${item.surah_number}:${item.ayah_number}`)).toEqual([
      '2:1', '2:2', '2:3',
      '18:1', '18:2', '18:3',
      '72:1', '72:2',
      '2:4', '2:5', '2:6',
      '18:4',
      '2:7', '2:8'
    ]);
  });

  test('only lets enrolled ayat be marked Core, Paused, or Later by the user', () => {
    const allowed = QuranAyahMemorization.userStateTransitionAllowed;
    expect(allowed('later', 'learning')).toBe(true);
    expect(allowed('later', 'weak')).toBe(true);
    expect(allowed('later', 'review')).toBe(true);
    expect(allowed('later', 'core')).toBe(true);
    expect(allowed('later', 'suspended')).toBe(false);
    expect(allowed('learning', 'suspended')).toBe(true);
    expect(allowed('review', 'later')).toBe(true);
    expect(allowed('weak', 'review')).toBe(false);
    expect(allowed('review', 'core')).toBe(true);
    expect(allowed('core', 'learning')).toBe(false);
    expect(allowed('suspended', 'weak')).toBe(false);
  });

  test('only lets enrolled pages and surahs be marked Core, Paused, or Later', () => {
    const allowed = QuranAyahMemorization.bulkStateTransitionAllowed;
    expect(allowed('review', 'core')).toBe(true);
    expect(allowed('weak', 'suspended')).toBe(true);
    expect(allowed('learning', 'later')).toBe(true);
    expect(allowed('review', 'weak')).toBe(false);
    expect(allowed('core', 'learning')).toBe(false);
  });

  test('uses every ayah in Surahs 1, 113, and 114 as the new-user Learning set', () => {
    const refs = QuranAyahMemorization.defaultLearningRefs();
    expect(refs).toHaveLength(18);
    expect(refs[0]).toEqual({ surah: 1, ayah: 1 });
    expect(refs[6]).toEqual({ surah: 1, ayah: 7 });
    expect(refs[7]).toEqual({ surah: 113, ayah: 1 });
    expect(refs[11]).toEqual({ surah: 113, ayah: 5 });
    expect(refs[12]).toEqual({ surah: 114, ayah: 1 });
    expect(refs[17]).toEqual({ surah: 114, ayah: 6 });
  });

  test('seeds the starter Learning ayat only when the user has no memorization rows', async () => {
    const existingQuery = jest.fn().mockResolvedValue([{ found: 1 }]);
    await expect(QuranAyahMemorization.seedDefaultLearningAyat(existingQuery, 'existing-user')).resolves.toBe(0);
    expect(existingQuery).toHaveBeenCalledTimes(1);

    const newUserQuery = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 18 });
    await expect(QuranAyahMemorization.seedDefaultLearningAyat(newUserQuery, 'new-user')).resolves.toBe(18);
    expect(newUserQuery).toHaveBeenCalledTimes(2);
    expect(newUserQuery.mock.calls[1][0]).toContain('INSERT IGNORE INTO quran_ayah_memorization');
    expect(newUserQuery.mock.calls[1][0]).toContain("1,1,'learning','started',UTC_TIMESTAMP(),UTC_TIMESTAMP()");
    expect(newUserQuery.mock.calls[1][0]).toContain("113,1,'learning','started',UTC_TIMESTAMP(),UTC_TIMESTAMP()");
    expect(newUserQuery.mock.calls[1][0]).toContain("114,6,'learning','started',UTC_TIMESTAMP(),UTC_TIMESTAMP()");
  });

  test('captures the exact memory and queue state needed to undo a review grade', () => {
    const snapshot = QuranAyahMemorization.reviewUndoSnapshot({
      lifecycle_state: 'weak', stability: 1.6, difficulty: 5.1, review_count: 3,
      next_review_at: new Date('2026-08-01T12:00:00Z'), row_version: 8,
      unrelated: 'not persisted'
    }, {
      item_state: 'queued', attempts: 0, current_token: 'attempt-token',
      presented_at: new Date('2026-07-31T12:00:00Z'), last_attempt_token: null,
      unrelated: 'not persisted'
    });
    expect(snapshot.memory).toMatchObject({
      lifecycle_state: 'weak', stability: 1.6, difficulty: 5.1,
      review_count: 3, row_version: 8
    });
    expect(snapshot.item).toMatchObject({
      item_state: 'queued', attempts: 0, current_token: 'attempt-token', last_attempt_token: null
    });
    expect(snapshot.memory).not.toHaveProperty('unrelated');
    expect(snapshot.item).not.toHaveProperty('unrelated');
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

  test('initializes an ungraded Weak ayah as a bounded new card', () => {
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
        stability: 0,
        difficulty: 7,
        next_review_at: null,
        fsrs_state: 0,
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

  test('converts a preserved ISO learning date when moving Later back to Learning', () => {
    const values = QuranAyahMemorization.stateUpdateValues({
      lifecycle_state: 'later',
      learning_progress: null,
      learning_started_at: '2026-08-03T12:15:20Z',
      stability: 0,
      difficulty: 5,
      review_count: 0
    }, 'learning');

    expect(values.learning_started_at).toEqual(new Date('2026-08-03T12:15:20Z'));
    expect(values.learning_started_at).toBeInstanceOf(Date);
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
        { surah_number: 1, ayah_number: 1, lifecycle_state: 'learning', fsrs_state: 0, review_count: 0, stability: 0, difficulty: 0 },
        { surah_number: 1, ayah_number: 2, lifecycle_state: 'relearning', fsrs_state: 2, next_review_at: '2026-07-30T12:00:00Z', review_count: 2, stability: 2, difficulty: 8 },
        { surah_number: 2, ayah_number: 1, lifecycle_state: 'review', fsrs_state: 2, next_review_at: '2026-08-03T12:00:00Z', review_count: 3, stability: 10, difficulty: 4 },
        { surah_number: 2, ayah_number: 2, lifecycle_state: 'later', review_count: 5 },
        { surah_number: 3, ayah_number: 1, lifecycle_state: 'suspended', next_review_at: '2026-07-29T12:00:00Z', review_count: 4, stability: 20, difficulty: 6 },
        { surah_number: 3, ayah_number: 2, lifecycle_state: 'core', next_review_at: '2026-07-28T12:00:00Z', review_count: 6, stability: 30, difficulty: 8 }
      ], '2026-07-31T12:00:00Z');

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        group_key: 'surah:1',
        counts: { learning: 1, weak: 1, review: 0, core: 0, relearning: 0, suspended: 0 },
        stage_start_references: { learning: '1:1', weak: '1:2' },
        stage_start_pages: { learning: 1, weak: 1 },
        active_ayah_count: 2,
        average_difficulty: 8,
        average_stability: 2,
        member_count: 2,
        due_count: 2,
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
        review_count: 3,
        average_difficulty: 6,
        average_stability: 20
      });
      expect(result[2]).toMatchObject({
        group_key: 'surah-page:3:2',
        counts: { learning: 0, weak: 0, review: 0, core: 1, relearning: 0, suspended: 1 },
        stage_start_references: { suspended: '3:1', core: '3:2' },
        stage_start_pages: { suspended: 2, core: 2 },
        active_ayah_count: 2,
        due_count: 0,
        next_review_at: null,
        review_count: 10,
        average_difficulty: 6,
        average_stability: 20
      });
    });

    test('does not count a new Weak card as due before bounded admission', () => {
      const result = QuranAyahMemorization.buildProgressGroups(definitions(), [
        { surah_number: 1, ayah_number: 1, lifecycle_state: 'weak', fsrs_state: 0, review_count: 0, stability: 0, difficulty: 0 }
      ], '2026-07-31T12:00:00Z');

      expect(result[0]).toMatchObject({ due_count: 0, new_count: 1 });
    });

    test('uses the database due result when application and database clocks differ', () => {
      const result = QuranAyahMemorization.buildProgressGroups(definitions(), [
        {
          surah_number: 1,
          ayah_number: 1,
          lifecycle_state: 'review',
          fsrs_state: 2,
          next_review_at: '2026-08-01T17:28:59.000Z',
          is_due_now: 1,
          review_count: 1
        }
      ], '2026-08-01T13:00:00.000Z');

      expect(result[0].due_count).toBe(1);
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
      expect(hard).toMatchObject({ lifecycle_state: 'weak', lapse_count: 0 });
      expect(hard.difficulty).toBeGreaterThan(6);
      expect(hard.interval).toBeLessThan(good.interval);
      expect(good.interval).toBeLessThan(easy.interval);
    });

    test('updates recall difficulty from grades and uses it to shorten difficult ayah intervals', () => {
      const again = schedule(reviewedAyah(), 'again');
      const hard = schedule(reviewedAyah(), 'hard');
      const good = schedule(reviewedAyah(), 'good');
      const easy = schedule(reviewedAyah(), 'easy');
      expect(again.difficulty).toBeGreaterThan(hard.difficulty);
      expect(hard.difficulty).toBeGreaterThan(good.difficulty);
      expect(good.difficulty).toBeGreaterThan(easy.difficulty);

      const easyRecall = schedule({ ...reviewedAyah(), difficulty:2 }, 'good');
      const difficultRecall = schedule({ ...reviewedAyah(), difficulty:8 }, 'good');
      expect(difficultRecall.stability).toBeLessThan(easyRecall.stability);
      expect(difficultRecall.interval).toBeLessThan(easyRecall.interval);
    });

    test('classifies scheduled ayat with FSRS difficulty greater than 6 as Weak', () => {
      const difficult = schedule({ ...reviewedAyah(), difficulty:6.2 }, 'good');
      const manageable = schedule({ ...reviewedAyah(), difficulty:6 }, 'good');
      expect(difficult.difficulty).toBeGreaterThan(6);
      expect(difficult.lifecycle_state).toBe('weak');
      expect(manageable.difficulty).toBeLessThanOrEqual(6);
      expect(manageable.lifecycle_state).toBe('review');
    });

    test('graduates exceptionally stable, very-low-difficulty ayat to Core and clears their schedule', () => {
      const core = schedule({ ...reviewedAyah(), stability:800, difficulty:1.5 }, 'good');
      const notStableEnough = schedule({ ...reviewedAyah(), stability:700, difficulty:1.5 }, 'good');
      const tooDifficult = schedule({ ...reviewedAyah(), stability:800, difficulty:2.1 }, 'good');
      expect(core).toMatchObject({ lifecycle_state:'core', due:null, interval:0, scheduled_days:0 });
      expect(core.stability).toBeGreaterThan(730);
      expect(core.difficulty).toBeLessThan(2);
      expect(notStableEnough.lifecycle_state).toBe('review');
      expect(tooDifficult.lifecycle_state).toBe('review');
    });

    test('keeps Weak after Again or an initial Good while Easy graduates it', () => {
      const weakAyah = { ...reviewedAyah(), lifecycle_state: 'weak', stability: 0.5, difficulty: 7 };
      const again = schedule(weakAyah, 'again');
      const good = schedule(weakAyah, 'good');
      const easy = schedule(weakAyah, 'easy');

      expect(again).toMatchObject({ lifecycle_state: 'weak', lapse_count: 1 });
      expect(good.lifecycle_state).toBe('weak');
      expect(easy.lifecycle_state).toBe('review');
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

    test('caps Again at two grades for the same review item in one session', () => {
      expect(QuranAyahMemorization.MAX_AGAIN_GRADES_PER_SESSION_ITEM).toBe(2);
      expect(QuranAyahMemorization.shouldQueueReviewRetry('again', 0)).toBe(true);
      expect(QuranAyahMemorization.shouldQueueReviewRetry('again', 1)).toBe(false);
      expect(QuranAyahMemorization.shouldQueueReviewRetry('again', 2)).toBe(false);
      expect(QuranAyahMemorization.shouldQueueReviewRetry('hard', 0)).toBe(false);
    });

    test('returns Relearning to Weak while recall difficulty remains high', () => {
      const relearning = { ...reviewedAyah(), lifecycle_state:'relearning', stability:0.4, difficulty:8, lapse_count:1 };
      const recovered = schedule(relearning, 'good');
      expect(recovered).toMatchObject({ lifecycle_state: 'weak', consecutive_successes: 1 });
      expect(recovered.difficulty).toBeGreaterThan(6);
      expect(recovered.interval).toBeGreaterThanOrEqual(1);
    });

    test('graduates Weak after one Easy or two consecutive Good reviews', () => {
      const weak = { ...reviewedAyah(), lifecycle_state:'weak', consecutive_successes:0 };
      expect(schedule(weak, 'good').lifecycle_state).toBe('weak');
      expect(schedule({ ...weak, consecutive_successes:1 }, 'good').lifecycle_state).toBe('review');
      expect(schedule(weak, 'easy').lifecycle_state).toBe('review');
      expect(schedule(weak, 'hard').lifecycle_state).toBe('weak');
      expect(schedule(weak, 'again').lifecycle_state).toBe('weak');
    });

    test('applies target retention and simplified FSRS parameter presets', () => {
      const standard = schedule(reviewedAyah(), 'good');
      const highRetention = schedule(reviewedAyah(), 'good', { targetRetention:0.95 });
      const conservative = schedule(reviewedAyah(), 'good', { intervalGrowth:'conservative' });
      const aggressive = schedule(reviewedAyah(), 'good', { intervalGrowth:'aggressive' });
      expect(highRetention.interval).toBeLessThanOrEqual(standard.interval);
      expect(conservative.stability).toBeLessThan(aggressive.stability);
    });

    test('shortens existing stability intervals when target retention increases', () => {
      const relaxed = QuranFsrs.intervalForStability(100, { targetRetention: 0.8 });
      const standard = QuranFsrs.intervalForStability(100, { targetRetention: 0.9 });
      const mastery = QuranFsrs.intervalForStability(100, { targetRetention: 0.95 });
      expect(relaxed).toBeGreaterThan(standard);
      expect(standard).toBeGreaterThan(mastery);
    });
  });

  describe('review session admission', () => {
    const rows = (state, count, surah) => Array.from({ length: count }, (_, index) => ({
      surah_number: surah,
      ayah_number: index + 1,
      lifecycle_state: state
    }));
    const limits = { learning: 3, weak: 3, memorized: 10 };
    const order = 'next_review_at, surah_number, ayah_number';

    test('requires the two supported Surah Review types without page limits', () => {
      expect(QuranAyahMemorization.reviewSessionRequest({ mode:'surah', surahNumber:2, reviewType:'regular' })).toMatchObject({
        mode:'surah', reviewUnit:'ayah', surahNumber:2, reviewType:'regular', pageLimit:0
      });
      expect(QuranAyahMemorization.reviewSessionRequest({ mode:'surah', surahNumber:2, reviewType:'all', reviewUnit:'passage' })).toMatchObject({
        mode:'surah', reviewUnit:'passage', surahNumber:2, reviewType:'all', pageLimit:null
      });
      expect(() => QuranAyahMemorization.reviewSessionRequest({ mode:'surah', surahNumber:2, reviewType:'all', reviewUnit:'page' }))
        .toThrow('Choose āyah-by-āyah or passage-by-passage review');
      expect(() => QuranAyahMemorization.reviewSessionRequest({ mode:'surah', surahNumber:2, pageLimit:3 }))
        .toThrow('Choose all āyāt or regular review');
    });

    test('accepts finite and forward-continuing passage and page reviews', () => {
      expect(QuranAyahMemorization.reviewSessionRequest({ mode:'passage', startRef:'2:255' })).toMatchObject({
        mode:'passage', startRef:'2:255', surahNumber:2, continueForward:false
      });
      expect(QuranAyahMemorization.reviewSessionRequest({ mode:'passage', startRef:'2:255', continueForward:true })).toMatchObject({
        mode:'passage', startRef:'2:255', continueForward:true
      });
      expect(QuranAyahMemorization.reviewSessionRequest({ mode:'page', pageNumber:42, continueForward:true })).toMatchObject({
        mode:'page', pageNumber:42, continueForward:true
      });
      expect(QuranAyahMemorization.reviewSessionRequest({ mode:'page', pageNumber:42, reviewUnit:'passage' })).toMatchObject({
        mode:'page', reviewUnit:'passage'
      });
      expect(QuranAyahMemorization.reviewSessionRequest({ mode:'surah', surahNumber:2, reviewType:'all', reviewUnit:'passage', continueForward:true })).toMatchObject({
        mode:'surah', reviewUnit:'passage', continueForward:true
      });
      expect(() => QuranAyahMemorization.reviewSessionRequest({ mode:'passage', startRef:'2:999' }))
        .toThrow('A valid Quran ayah is required');
    });

    test('groups passage review items by each ayah own surah', () => {
      const keys = QuranAyahMemorization.passageKeysForItems([
        { surah_number: 8, ayah_number: 75 },
        { surah_number: 9, ayah_number: 1 }
      ], {
        8: [{ section: 10, start: 70, end: 75 }],
        9: [{ section: 1, start: 1, end: 6 }]
      }, {});
      expect(keys).toEqual(['h2:8:10:70-75', 'h2:9:1:1-6']);
    });

    test('finds every enrolled passage companion for selected ayah review items', async () => {
      const selected = [
        { surah_number: 2, ayah_number: 2, lifecycle_state: 'review' },
        { surah_number: 3, ayah_number: 5, lifecycle_state: 'weak' }
      ];
      const enrolled = [
        { surah_number: 2, ayah_number: 1, lifecycle_state: 'learning' },
        { surah_number: 2, ayah_number: 2, lifecycle_state: 'review' },
        { surah_number: 2, ayah_number: 3, lifecycle_state: 'core' },
        { surah_number: 2, ayah_number: 4, lifecycle_state: 'review' },
        { surah_number: 3, ayah_number: 4, lifecycle_state: 'weak' },
        { surah_number: 3, ayah_number: 5, lifecycle_state: 'weak' },
        { surah_number: 3, ayah_number: 6, lifecycle_state: 'suspended' }
      ];
      const query = jest.fn().mockResolvedValue(enrolled);
      const sections = {
        2: [{ section: 1, start: 1, end: 3 }, { section: 2, start: 4, end: 4 }],
        3: [{ section: 1, start: 4, end: 6 }]
      };

      const result = await QuranAyahMemorization.includeEnrolledAyatForSelectedPassages(
        query, 'user-1', selected, sections, {}
      );

      expect(result.map(item => `${item.surah_number}:${item.ayah_number}`)).toEqual([
        '2:1', '2:2', '2:3', '3:4', '3:5', '3:6'
      ]);
      expect(query.mock.calls[0][0]).toContain('surah_number IN (2,3)');
      expect(query.mock.calls[0][0]).toContain("lifecycle_state IN ('learning','relearning','weak','review','core','suspended')");
    });

    test('keeps passage companions within every regular-session category and total cap', () => {
      const selected = [
        { surah_number: 55, ayah_number: 1, lifecycle_state: 'learning' },
        { surah_number: 55, ayah_number: 2, lifecycle_state: 'learning' },
        { surah_number: 55, ayah_number: 3, lifecycle_state: 'learning' },
        { surah_number: 55, ayah_number: 20, lifecycle_state: 'weak' },
        { surah_number: 55, ayah_number: 30, lifecycle_state: 'review' }
      ];
      const expanded = [
        ...selected,
        { surah_number: 55, ayah_number: 4, lifecycle_state: 'learning' },
        { surah_number: 55, ayah_number: 19, lifecycle_state: 'relearning' },
        { surah_number: 55, ayah_number: 29, lifecycle_state: 'review' },
        { surah_number: 55, ayah_number: 40, lifecycle_state: 'core' },
        { surah_number: 55, ayah_number: 41, lifecycle_state: 'suspended' }
      ];

      const result = QuranAyahMemorization.limitRegularSessionPassageCompanions(
        selected, expanded, { learning: 3, weak: 1, memorized: 1 }, 6
      );

      expect(result.map(item => `${item.surah_number}:${item.ayah_number}`)).toEqual([
        '55:1', '55:2', '55:3', '55:20', '55:30', '55:40'
      ]);
      expect(result.filter(item => item.lifecycle_state === 'learning')).toHaveLength(3);
      expect(result.filter(item => ['relearning', 'weak'].includes(item.lifecycle_state))).toHaveLength(1);
      expect(result.filter(item => item.lifecycle_state === 'review')).toHaveLength(1);
      expect(result).toHaveLength(6);
    });

    test('enrolls Later ayat in a custom review scope as Learning cards', async () => {
      const query = jest.fn()
        .mockResolvedValueOnce([
          { surah_number:2, ayah_number:1, lifecycle_state:'review' },
          { surah_number:2, ayah_number:2, lifecycle_state:'later' }
        ])
        .mockResolvedValueOnce({ affectedRows:2 });

      await expect(QuranAyahMemorization.enrollReviewScope(query, 'user-1', ['2:1', '2:2', '2:3'])).resolves.toBe(2);

      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
      const statement = query.mock.calls[1][0];
      expect(statement).not.toContain("('user-1',2,1,'learning','started'");
      expect(statement).toContain("('user-1',2,2,'learning','started'");
      expect(statement).toContain("('user-1',2,3,'learning','started'");
      expect(statement).toContain("lifecycle_state=IF(lifecycle_state='later','learning',lifecycle_state)");
      expect(statement).toContain("row_version=row_version+IF(lifecycle_state='later',1,0)");
    });

    test('does not issue an enrollment write when every scoped ayah is already enrolled', async () => {
      const query = jest.fn().mockResolvedValueOnce([
        { surah_number:2, ayah_number:1, lifecycle_state:'learning' },
        { surah_number:2, ayah_number:2, lifecycle_state:'review' }
      ]);

      await expect(QuranAyahMemorization.enrollReviewScope(query, 'user-1', ['2:1', '2:2'])).resolves.toBe(0);
      expect(query).toHaveBeenCalledTimes(1);
    });

    test('shares one Weak cap across recovery and fragile ayat', async () => {
      const query = jest.fn()
        .mockResolvedValueOnce(rows('learning', 3, 1))
        .mockResolvedValueOnce(rows('relearning', 4, 2))
        .mockResolvedValueOnce(rows('weak', 3, 3))
        .mockResolvedValueOnce(rows('review', 10, 4));

      const result = await QuranAyahMemorization.selectReviewSessionItems(query, 'user-1', 10, limits, order);

      expect(result.learning).toHaveLength(3);
      expect(result.relearning).toHaveLength(2);
      expect(result.weak).toHaveLength(1);
      expect(result.memorized).toHaveLength(4);
      expect(result.relearning.length + result.weak.length).toBe(3);
      expect(result.scheduled).toEqual(result.weak.concat(result.memorized));
      expect(result.fresh).toBe(false);
      expect(query).toHaveBeenCalledTimes(4);
      expect(query.mock.calls.map(call => call[0].match(/lifecycle_state='([^']+)'/)[1])).toEqual([
        'learning', 'relearning', 'weak', 'review'
      ]);
      expect(query.mock.calls[0][0]).toContain('LIMIT 300 FOR UPDATE');
      expect(query.mock.calls[1][0]).toContain('LIMIT 300 FOR UPDATE');
      expect(query.mock.calls[2][0]).toContain('LIMIT 300 FOR UPDATE');
      expect(query.mock.calls[3][0]).toContain('LIMIT 300 FOR UPDATE');
      expect(query.mock.calls.slice(0, 4).every(call => call[0].includes('CASE WHEN fsrs_state=0 THEN 1 ELSE 0 END'))).toBe(true);
    });

    test('lets one due category use otherwise unused overall capacity', async () => {
      const memorized = rows('review', 10, 2).map(row => ({ ...row, fsrs_state:2 }));
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

    test('includes due Weak ayat in regular review sessions', async () => {
      const weak = rows('weak', 2, 3).map(row => ({ ...row, fsrs_state:2 }));
      const query = jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(weak)
        .mockResolvedValueOnce([]);

      const result = await QuranAyahMemorization.selectReviewSessionItems(query, 'user-1', 10, limits, order);

      expect(result.weak).toEqual(weak);
      expect(result.scheduled).toEqual(weak);
      expect(result.fresh).toBe(false);
    });

    test('keeps overdue Learning cards within the configured category cap', async () => {
      const overdueLearning = rows('learning', 4, 2).map(row => ({ ...row, fsrs_state:2 }));
      const query = jest.fn()
        .mockResolvedValueOnce(overdueLearning)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await QuranAyahMemorization.selectReviewSessionItems(query, 'user-1', 10, limits, order);

      expect(result.learning).toEqual(overdueLearning.slice(0, limits.learning));
      expect(result.fresh).toBe(false);
    });

    test('keeps overdue Good cards within the configured category cap', async () => {
      const overdueMemorized = rows('review', 12, 2).map(row => ({ ...row, fsrs_state:2 }));
      const query = jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(overdueMemorized);

      const result = await QuranAyahMemorization.selectReviewSessionItems(query, 'user-1', 20, limits, order);

      expect(result.memorized).toEqual(overdueMemorized.slice(0, limits.memorized));
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
      expect(query.mock.calls.slice(4).every(call => call[0].includes('CASE WHEN fsrs_state=0 THEN 0 ELSE 1 END'))).toBe(true);
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

    test('applies the normal ayah schedule within a Surah Review scope', async () => {
      const due = [{ surah_number:2, ayah_number:3, lifecycle_state:'review', fsrs_state:2 }];
      const refs = ['2:1', '2:2', '2:3'];
      const query = jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(due);

      const result = await QuranAyahMemorization.selectReviewSessionItems(query, 'user-1', 10, limits, order, refs);

      expect(result.memorized).toEqual(due);
      expect(result.fresh).toBe(false);
      expect(query).toHaveBeenCalledTimes(4);
      expect(query.mock.calls.every(call => call[0].includes('(surah_number,ayah_number) IN ((2,1),(2,2),(2,3))'))).toBe(true);
      expect(query.mock.calls.every(call => call[0].includes('next_review_at<=NOW()'))).toBe(true);
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

  describe('review session switching', () => {
    test('pauses the active session before resuming the selected paused session', async () => {
      const query = jest.fn()
        .mockResolvedValueOnce([
          { session_id: 'active-session', paused_at: null },
          { session_id: 'paused-session', paused_at: new Date('2026-08-01T12:00:00Z') }
        ])
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce({ affectedRows: 1 });

      await expect(QuranAyahMemorization.switchReviewSession(query, 'user-1', 'paused-session')).resolves.toEqual({
        session_id: 'paused-session',
        resumed: true,
        switched_from_session_ids: ['active-session']
      });
      expect(query).toHaveBeenCalledTimes(3);
      expect(query.mock.calls[1][0]).toContain('SET paused_at=NOW()');
      expect(query.mock.calls[2][0]).toContain('paused_at=NULL');
    });

    test('keeps the selected active session active', async () => {
      const query = jest.fn().mockResolvedValueOnce([{ session_id: 'active-session', paused_at: null }]);
      await expect(QuranAyahMemorization.switchReviewSession(query, 'user-1', 'active-session')).resolves.toEqual({
        session_id: 'active-session',
        resumed: true,
        switched_from_session_ids: []
      });
      expect(query).toHaveBeenCalledTimes(1);
    });
  });
});
