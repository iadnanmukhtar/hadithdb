/* jslint node:true, esversion:9 */
'use strict';

const {
  Rating,
  State,
  checkParameters,
  clipParameters,
  createEmptyCard,
  default_w: DEFAULT_WEIGHTS,
  fsrs,
  generatorParameters
} = require('ts-fsrs');

const FSRS_VERSION = 6;
const GRADE_RATINGS = Object.freeze({
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy
});

function clamp(minimum, maximum, value) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeTargetRetention(value) {
  const parsed = Number(value);
  return [0.8, 0.85, 0.9, 0.92, 0.95].includes(parsed) ? parsed : 0.9;
}

function choice(value, allowed, fallback) {
  const normalized = (value || '').toString().trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeWeights(value) {
  if (!Array.isArray(value) || value.length !== 21) return null;
  const weights = value.map(Number);
  if (weights.some(weight => !Number.isFinite(weight))) return null;
  try {
    return Array.from(checkParameters(clipParameters(weights, 0, true)));
  } catch (err) {
    return null;
  }
}

function normalizeSettings(value) {
  const settings = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    targetRetention: normalizeTargetRetention(settings.targetRetention),
    learningSpeed: choice(settings.learningSpeed, ['slow', 'normal', 'fast'], 'normal'),
    intervalGrowth: choice(settings.intervalGrowth, ['conservative', 'standard', 'aggressive'], 'standard'),
    lapseRecovery: choice(settings.lapseRecovery, ['mild', 'standard', 'strict'], 'standard'),
    parameters: normalizeWeights(settings.parameters),
    optimizedAt: /^\d{4}-\d{2}-\d{2}T/.test((settings.optimizedAt || '').toString())
      ? settings.optimizedAt.toString()
      : null
  };
}

function effectiveWeights(value) {
  const settings = normalizeSettings(value);
  const weights = Array.from(settings.parameters || DEFAULT_WEIGHTS);
  const initialStrength = {
    slow: [0.45, 1.1, 2.7, 6],
    normal: [0.75, 1.6, 3.5, 7],
    fast: [1, 2, 4.25, 9]
  }[settings.learningSpeed];
  initialStrength.forEach((weight, index) => { weights[index] = weight; });
  const growthMultiplier = { conservative: 0.78, standard: 1, aggressive: 1.25 }[settings.intervalGrowth];
  weights[8] += Math.log(growthMultiplier);
  const lapseMultiplier = { strict: 0.72, standard: 1, mild: 1.28 }[settings.lapseRecovery];
  weights[11] *= lapseMultiplier;
  return Array.from(checkParameters(clipParameters(weights, 0, true)));
}

function parameters(value) {
  const settings = normalizeSettings(value);
  return generatorParameters({
    request_retention: settings.targetRetention,
    w: effectiveWeights(settings),
    maximum_interval: 36500,
    enable_fuzz: false,
    enable_short_term: true,
    // Quran reviews use the FSRS 6 short-term model directly. This avoids a
    // second, fixed learning-step algorithm competing with the trained model.
    learning_steps: [],
    relearning_steps: []
  });
}

function validDate(value, fallback) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : fallback;
}

function inferredState(row) {
  if (Number.isInteger(Number(row.fsrs_state)) && Number(row.fsrs_state) >= State.New
    && Number(row.fsrs_state) <= State.Relearning) return Number(row.fsrs_state);
  if (row.lifecycle_state === 'relearning') return State.Relearning;
  if (row.lifecycle_state === 'learning') return Number(row.review_count) > 0 ? State.Learning : State.New;
  return State.Review;
}

function cardFromRow(row, now) {
  const current = validDate(now, new Date());
  const initialized = row && [State.Learning, State.Review, State.Relearning].includes(Number(row.fsrs_state))
    && Number(row.stability) > 0;
  if (!row || (!initialized && !row.last_reviewed_at && Number(row.review_count || 0) === 0)) return createEmptyCard(current);
  const lastReview = validDate(row.last_reviewed_at || row.learning_last_worked_at
    || row.fully_memorized_at || row.updated_at, current);
  return {
    due: validDate(row.next_review_at, current),
    stability: Math.max(0.001, Number(row.stability) || 0.001),
    difficulty: clamp(1, 10, Number(row.difficulty) || 5),
    elapsed_days: Math.max(0, Math.round((current.getTime() - lastReview.getTime()) / 86400000)),
    scheduled_days: Math.max(0, Number(row.fsrs_scheduled_days) || 0),
    learning_steps: Math.max(0, Number(row.fsrs_learning_steps) || 0),
    reps: Math.max(0, Number(row.review_count) || 0),
    lapses: Math.max(0, Number(row.lapse_count) || 0),
    state: inferredState(row),
    last_review: lastReview
  };
}

function lifecycleAfter(existing, grade, card) {
  if (existing.lifecycle_state === 'weak') {
    return grade === 'easy' || (grade === 'good' && Number(existing.consecutive_successes || 0) >= 1)
      ? 'review'
      : 'weak';
  }
  if (existing.lifecycle_state === 'learning') {
    return grade === 'easy' || (grade === 'good' && Number(existing.consecutive_successes || 0) >= 1)
      ? 'review'
      : 'learning';
  }
  if (grade === 'again' && existing.lifecycle_state !== 'learning') return 'relearning';
  if (card.state === State.New || card.state === State.Learning) return 'learning';
  if (card.state === State.Relearning) return 'relearning';
  return 'review';
}

function schedule(existing, grade, settings, nowValue) {
  if (!GRADE_RATINGS[grade]) throw new TypeError('A schedulable review grade is required.');
  const now = validDate(nowValue, new Date());
  const before = cardFromRow(existing, now);
  const result = fsrs(parameters(settings)).next(before, now, GRADE_RATINGS[grade]);
  const card = result.card;
  const dueMs = Math.max(0, card.due.getTime() - now.getTime());
  const lifecycleState = lifecycleAfter(existing, grade, card);
  const graduated = ['learning', 'weak'].includes(existing.lifecycle_state) && lifecycleState === 'review';
  return {
    lifecycle_state: lifecycleState,
    learning_progress: graduated ? 'nearly_memorized'
      : existing.lifecycle_state === 'learning' && grade === 'again' ? 'started'
        : existing.lifecycle_state === 'learning' && grade === 'good' ? 'partial'
          : existing.lifecycle_state === 'learning' ? existing.learning_progress || 'started' : undefined,
    graduated,
    stability: card.stability,
    difficulty: card.difficulty,
    due: card.due,
    interval: Math.max(0, Math.round(dueMs / 86400000)),
    scheduled_days: Math.max(0, Number(card.scheduled_days) || Math.round(dueMs / 86400000)),
    learning_steps: Math.max(0, Number(card.learning_steps) || 0),
    fsrs_state: card.state,
    lapse_count: card.lapses,
    consecutive_successes: grade === 'again' || grade === 'hard' ? 0 : Number(existing.consecutive_successes || 0) + 1,
    relearning_step: card.state === State.Relearning ? 1 : 0,
    elapsed_days: result.log.elapsed_days,
    retrievability: before.stability > 0 ? fsrs(parameters(settings)).get_retrievability(before, now, false) : null
  };
}

function initialAssessment(lifecycleState, settings, nowValue) {
  const grade = { weak: 'hard', review: 'good', core: 'easy' }[lifecycleState];
  if (!grade) throw new TypeError('Weak, Memorized, or Core is required for an initial FSRS assessment.');
  const result = schedule({ lifecycle_state: 'learning', review_count: 0, consecutive_successes: 0 }, grade, settings, nowValue);
  return {
    stability: result.stability,
    difficulty: result.difficulty,
    next_review_at: lifecycleState === 'core' ? null : result.due,
    fsrs_state: result.fsrs_state,
    fsrs_scheduled_days: lifecycleState === 'core' ? 0 : result.scheduled_days,
    fsrs_learning_steps: result.learning_steps,
    fsrs_version: FSRS_VERSION
  };
}

async function optimize(reviewRows) {
  const { computeParameters, FSRSBindingItem, FSRSBindingReview } = require('@open-spaced-repetition/binding');
  const byCard = new Map();
  (reviewRows || []).forEach(row => {
    const key = `${Number(row.surah_number)}:${Number(row.ayah_number)}`;
    if (!byCard.has(key)) byCard.set(key, []);
    byCard.get(key).push(row);
  });
  const items = [];
  byCard.forEach(rows => {
    rows.sort((left, right) => new Date(left.reviewed_at) - new Date(right.reviewed_at));
    let previous = null;
    const reviews = rows.map(row => {
      const reviewedAt = new Date(row.reviewed_at);
      const delta = previous ? Math.max(0, Math.round((reviewedAt - previous) / 86400000)) : 0;
      previous = reviewedAt;
      return new FSRSBindingReview(GRADE_RATINGS[row.grade], delta);
    });
    // The optimizer expects one training item for every outcome after the
    // first review, with that card's history included up to that outcome.
    for (let length = 2; length <= reviews.length; length += 1)
      items.push(new FSRSBindingItem(reviews.slice(0, length)));
  });
  const reviewCount = Array.from(byCard.values()).reduce((total, rows) => total + rows.length, 0);
  if (reviewCount < 100) {
    const err = new Error(`Personalization needs at least 100 graded reviews. You currently have ${reviewCount}.`);
    err.status = 409;
    throw err;
  }
  const optimized = await computeParameters(items, {
    enableShortTerm: true,
    numRelearningSteps: 0,
    timeout: 15000
  });
  return { parameters: normalizeWeights(optimized), reviewCount };
}

module.exports = {
  FSRS_VERSION,
  effectiveWeights,
  initialAssessment,
  normalizeSettings,
  optimize,
  parameters,
  schedule
};
