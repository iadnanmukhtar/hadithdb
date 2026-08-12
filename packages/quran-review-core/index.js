(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HadithDbQuranReview = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CANONICAL_AYAH_COUNTS = Object.freeze([
    7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128,
    111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73,
    54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60,
    49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52,
    44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19,
    26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7,
    3, 6, 3, 5, 4, 5, 6
  ]);
  const REVIEW_GRADES = Object.freeze(['again', 'hard', 'good', 'easy', 'skip']);
  const LIFECYCLE_STATE_LABELS = Object.freeze({ later: 'Later', learning: 'Learning', weak: 'Hard', review: 'Good', core: 'Easy', relearning: 'Hard', suspended: 'Paused' });
  const USER_SELECTABLE_LIFECYCLE_STATES = Object.freeze(['later', 'learning', 'weak', 'review', 'core', 'suspended']);
  const INITIAL_ASSESSMENT_STAGES = Object.freeze([
    Object.freeze({ state: 'learning', label: 'Learn' }),
    Object.freeze({ state: 'weak', label: 'Hard' }),
    Object.freeze({ state: 'review', label: 'Good' }),
    Object.freeze({ state: 'core', label: 'Easy' })
  ]);
  const QURAN_DAGGER_ALIF_FIXED_WORDS = Object.freeze([
    ['هاذا', 'هذا'], ['هاذه', 'هذه'], ['ذالك', 'ذلك'], ['ذالكم', 'ذلكم'],
    ['اولايك', 'اولئك'], ['اوليك', 'اولئك'], ['هاولا', 'هولا']
  ]);
  const ARABIC_DIACRITICS = /[\u0600-\u061f\u064b-\u0652\u0657-\u065f\u066b-\u066d\u06d6-\u06ed\u08d3-\u08ff]/g;

  function reviewError(message, status) {
    const error = new Error(message);
    error.status = status || 400;
    return error;
  }

  function strictInteger(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!/^(0|[1-9]\d*)$/.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  function parseRef(surahValue, ayahValue) {
    const surah = strictInteger(surahValue);
    const ayah = strictInteger(ayahValue);
    if (!surah || !ayah || surah > CANONICAL_AYAH_COUNTS.length || ayah > CANONICAL_AYAH_COUNTS[surah - 1]) return null;
    return { surah, ayah };
  }

  function parseRefString(value) {
    const parts = (value || '').toString().replace(/^quran:/i, '').split(':');
    return parts.length === 2 ? parseRef(parts[0], parts[1]) : null;
  }

  function normalizeArabic(value, keepHamzah) {
    let text = (value || '').toString();
    text = text.replace(/ى\u0670/g, 'ا').replace(/ي\u0670/g, 'ا').replace(/\u0670/g, 'ا').replace(/ا+/g, 'ا').replace(/\u0656/g, 'ي');
    text = text.replace(ARABIC_DIACRITICS, '').replace(/ـ/g, '')
      .replace(/\u0675/g, 'ءا').replace(/\u0676/g, 'ءو').replace(/\u0678/g, 'ءى')
      .replace(/ٱ/g, 'ا').replace(/ى(?=$|[^\p{L}\p{M}\d])/gu, 'ا').replace(/ى/g, 'ي');
    if (keepHamzah) {
      return text.replace(/([آ]|ا\u0653)/g, 'ءا').replace(/[أإؤئ]/g, 'ء').replace(/[اوي][\u0654\u0655\u0674]/g, 'ء');
    }
    return text.replace(/ء/g, '').replace(/[\u0654\u0655\u0674]/g, '')
      .replace(/([آأإٲٳٵ]|ا[\u0653\u0654\u0655\u0674]|\u0654?ا)/g, 'ا')
      .replace(/(ؤ|و[\u0653\u0654\u0655\u0674])/g, 'و').replace(/(ئ|ي[\u0653\u0654\u0655\u0674])/g, 'ي');
  }

  function quranSearchNormalizeArabic(value) {
    let text = normalizeArabic((value || '').toString().trim(), false);
    QURAN_DAGGER_ALIF_FIXED_WORDS.forEach(pair => {
      const re = new RegExp(`(^|[^\\p{L}\\p{M}\\d])${pair[0]}(?=$|[^\\p{L}\\p{M}\\d])`, 'gu');
      text = text.replace(re, `$1${pair[1]}`);
    });
    return text.replace(/ة(?=$|[^\p{L}\p{M}\d])/gu, 'ت').replace(/يي/g, 'ي');
  }

  function arabicTokens(value) {
    return (value || '').toString().split(/[^\p{L}\p{M}\d]+/gu).filter(Boolean);
  }

  function stripArabicAffixes(value) {
    let text = value || '';
    if (text.length > 3) text = text.replace(/^(ا|ال|ف|ب|و|س|ت|ن|ء|أ|إ|ي|ك|ل)/, '');
    if (text.length > 3) text = text.replace(/(ة|ه|هم|هما|كم|ك|كما|تم|ن|نا|ي|تما|وا|ا|ون|ين|و)$/, '');
    return text;
  }

  function disemvowelArabic(value) {
    return normalizeArabic((value || '').toString().replace(/[^ \p{L}\p{M}\d]+/gu, ''), true)
      .replace(/( |^)ال([^\s]{3,})( |$)/gu, '$1$2$3').replace(/( |^)وال([^\s]{3,})( |$)/gu, '$1$2$3')
      .replace(/( |^)فال([^\s]{3,})( |$)/gu, '$1$2$3').replace(/( |^)و([^\s]{3,})( |$)/gu, '$1$2$3')
      .replace(/( |^)ف([^\s]{3,})( |$)/gu, '$1$2$3').replace(/( |^)([^\s]{2,})(ات|ان|ين|ون)( |$)/gu, '$1$2$4')
      .replace(/[ة]/g, 'ت').replace(/[ايو]/g, '').replace(/ +/gu, ' ').trim();
  }

  function quranArabicTokenVariants(token) {
    const variants = new Set();
    token = (token || '').toString().trim();
    if (!token) return [];
    variants.add(token);
    const stripped = stripArabicAffixes(token);
    if (stripped.length >= 3) variants.add(stripped);
    const disemvoweled = disemvowelArabic(token);
    if (disemvoweled.length >= 3) variants.add(disemvoweled);
    return Array.from(variants);
  }

  function quranArabicTokenMatches(normalizedText, token) {
    if (normalizedText.includes(token)) return true;
    if (token.length < 3) return false;
    const tokenVariants = quranArabicTokenVariants(token);
    return arabicTokens(normalizedText).some(word => {
      const wordVariants = quranArabicTokenVariants(word);
      return tokenVariants.some(left => wordVariants.some(right => right.includes(left)));
    });
  }

  function quranSearchMatches(normalizedText, query) {
    const normalizedQuery = quranSearchNormalizeArabic(query);
    if (!normalizedQuery) return false;
    if (normalizedText.includes(normalizedQuery)) return true;
    return arabicTokens(normalizedQuery).every(token => quranArabicTokenMatches(normalizedText, token));
  }

  function quranStudyPath(value) {
    const ref = typeof value === 'object' && value
      ? parseRef(value.surah, value.ayah)
      : parseRefString(value);
    return ref ? `/quran:${ref.surah}:${ref.ayah}` : '';
  }

  function localDayStart(dateValue) {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue === undefined ? Date.now() : dateValue);
    if (!Number.isFinite(date.getTime())) throw reviewError('A valid review date is required.');
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
  }

  function reviewSessionRequest(options) {
    const source = options || {};
    const rawMode = source.mode === undefined ? 'regular' : (source.mode || '').toString().trim().toLowerCase();
    if (!['regular', 'surah', 'page', 'passage'].includes(rawMode))
      throw reviewError('Review mode must be regular, surah, page, or passage.');
    if (rawMode === 'regular')
      return { mode: 'regular', reviewUnit: 'ayah', surahNumber: null, pageLimit: null, pageNumber: null, startRef: null, continueForward: false };
    const reviewUnit = (source.reviewUnit || source.review_unit || 'ayah').toString().trim().toLowerCase();
    if (!['ayah', 'passage'].includes(reviewUnit))
      throw reviewError('Choose āyah-by-āyah or passage-by-passage review.');
    const continueForward = source.continueForward === true || source.continue_forward === true;
    if (rawMode === 'passage') {
      const startRef = parseRefString(source.startRef || source.start_ref);
      if (!startRef) throw reviewError('A valid Quran ayah is required for a Passage Review.');
      return { mode: 'passage', reviewUnit, surahNumber: startRef.surah, pageLimit: null, pageNumber: null, startRef: `${startRef.surah}:${startRef.ayah}`, continueForward };
    }
    if (rawMode === 'page') {
      const pageNumber = strictInteger(source.pageNumber === undefined ? source.page_number : source.pageNumber);
      if (!pageNumber || pageNumber > 604) throw reviewError('A valid Mushaf page from 1 through 604 is required for a Page Review.');
      return { mode: 'page', reviewUnit, surahNumber: null, pageLimit: null, pageNumber, startRef: null, continueForward };
    }
    const ref = parseRef(source.surahNumber === undefined ? source.surah_number : source.surahNumber, 1);
    if (!ref) throw reviewError('A valid surah is required for a Surah Review.');
    const reviewType = (source.reviewType || source.review_type || '').toString().trim().toLowerCase();
    if (!['all', 'regular'].includes(reviewType)) throw reviewError('Choose Review all āyāt or Regular review for this Surah Review.');
    return { mode: 'surah', reviewUnit, surahNumber: ref.surah, reviewType, pageLimit: reviewType === 'all' ? null : 0, pageNumber: null, startRef: null, continueForward };
  }

  function sessionRequestBody(options) {
    const request = reviewSessionRequest(options);
    const body = { mode: request.mode };
    if (request.reviewUnit) body.review_unit = request.reviewUnit;
    if (request.surahNumber) body.surah_number = request.surahNumber;
    if (request.reviewType) body.review_type = request.reviewType;
    if (request.pageNumber) body.page_number = request.pageNumber;
    if (request.startRef) body.start_ref = request.startRef;
    if (request.continueForward) body.continue_forward = true;
    return body;
  }

  function gradeRequestBody(options) {
    const source = options || {};
    const grade = (source.grade || '').toString().toLowerCase();
    if (!REVIEW_GRADES.includes(grade)) throw reviewError('A valid review grade is required.');
    if (!source.sessionId || !source.attemptToken) throw reviewError('The active review attempt is required.', 409);
    return {
      grade,
      session_id: source.sessionId,
      attempt_token: source.attemptToken,
      day_start: source.dayStart || localDayStart(),
      duration_seconds: Math.max(0, Math.round(Number(source.durationSeconds) || 0))
    };
  }

  function nextItemTarget(result) {
    if (!result || result.complete || !result.ayah) return { complete: true };
    const ayah = result.ayah;
    const ref = parseRef(ayah.surah_number, ayah.ayah_number);
    if (!ref) throw reviewError('The server returned an invalid Quran reference.', 502);
    const pageNumber = strictInteger(ayah.page_number) || 1;
    return {
      complete: false,
      ref: `${ref.surah}:${ref.ayah}`,
      surah: ref.surah,
      ayah: ref.ayah,
      pageNumber,
      retry: ayah.retry === true || ayah.retry === 1,
      passageRefs: result.passage && Array.isArray(result.passage.refs) ? result.passage.refs.filter(value => parseRefString(value)) : []
    };
  }

  return { CANONICAL_AYAH_COUNTS, REVIEW_GRADES, LIFECYCLE_STATE_LABELS, USER_SELECTABLE_LIFECYCLE_STATES, INITIAL_ASSESSMENT_STAGES, strictInteger, parseRef, parseRefString, normalizeArabic, quranSearchNormalizeArabic, quranSearchMatches, quranStudyPath, localDayStart, reviewSessionRequest, sessionRequestBody, gradeRequestBody, nextItemTarget };
}));
