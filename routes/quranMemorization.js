/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit').default;
const debug = require('../lib/Debug')('hadithdb:QuranMemorization');
const GoogleAuth = require('../lib/GoogleAuth');
const QuranAyahMemorization = require('../lib/QuranAyahMemorization');
const UserSettings = require('../lib/UserSettings');
const QuranRecitationFeedback = require('../lib/QuranRecitationFeedback');

const router = express.Router();

function expectedVersion(req) {
  const value = req.body && req.body.expected_version;
  const parsed = typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value.trim()) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    const err = new Error('The current ayah row version is required. Reload and try again.');
    err.status = 428;
    throw err;
  }
  return parsed;
}

function batchRefs(value) {
  const tokens = (value || '').toString().split(',').map(item => item.trim()).filter(Boolean);
  if (tokens.length > 500) {
    const err = new Error('A maximum of 500 ayah references may be loaded at once.');
    err.status = 400;
    throw err;
  }
  return tokens.map(token => {
    const match = token.replace(/^quran:/i, '').match(/^(\d+):(\d+)$/);
    const ref = match && QuranAyahMemorization.parseRef(match[1], match[2]);
    if (!ref) {
      const err = new Error(`Quran ayah reference '${token}' is not valid.`);
      err.status = 400;
      throw err;
    }
    return ref;
  });
}

function batchSurahs(value) {
  const tokens = (value || '').toString().split(',').map(item => item.trim()).filter(Boolean);
  if (tokens.length > 114) {
    const err = new Error('A maximum of 114 surahs may be loaded at once.');
    err.status = 400;
    throw err;
  }
  const surahs = tokens.map(token => {
    const ref = QuranAyahMemorization.parseRef(token, 1);
    if (!ref) {
      const err = new Error(`Quran surah '${token}' is not valid.`);
      err.status = 400;
      throw err;
    }
    return ref.surah;
  });
  return Array.from(new Set(surahs));
}
const recitationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many recitation checks. Please wait and try again.' }
});
const fsrsOptimizerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'FSRS personalization may be run up to three times per hour.' }
});

router.use(function (req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

router.use(async function (req, res, next) {
  try {
    req.user = await GoogleAuth.verifyRequest(req, { allowSession: true });
    if (!req.user) return res.status(401).json({ error: 'Please sign in to save memorization progress.' });
    next();
  } catch (err) {
    debug.error(`Auth error: ${err.message}\n${err.stack || ''}`);
    res.status(401).json({ error: 'Please sign in to save memorization progress.' });
  }
});

router.get('/ayahs', async function (req, res) {
  const ayahs = await QuranAyahMemorization.getMany(req.user.uid, batchRefs(req.query.refs));
  res.json({ ayahs });
});

router.get('/ayahs/:surah/:ayah', async function (req, res) {
  const ayah = await QuranAyahMemorization.get(req.user.uid, req.params.surah, req.params.ayah);
  res.json({ ayah });
});

router.put('/ayahs/:surah/:ayah/state', async function (req, res) {
  const ayah = await QuranAyahMemorization.updateState(
    req.user.uid,
    req.params.surah,
    req.params.ayah,
    req.body && req.body.lifecycle_state,
    { expectedVersion: expectedVersion(req) }
  );
  res.json({ ayah });
});

router.get('/surahs/core', async function (req, res) {
  const surahs = await QuranAyahMemorization.coreSurahStatuses(req.user.uid, batchSurahs(req.query.surahs));
  res.json({ surahs });
});

router.get('/surahs/states', async function (req, res) {
  const surahs = await QuranAyahMemorization.surahStateStatuses(req.user.uid, batchSurahs(req.query.surahs));
  res.json({ surahs });
});

router.put('/surahs/:surah/state', async function (req, res) {
  const result = await QuranAyahMemorization.setSurahState(
    req.user.uid,
    req.params.surah,
    req.body && req.body.lifecycle_state
  );
  res.json(result);
});

router.put('/pages/:page/state', async function (req, res) {
  const result = await QuranAyahMemorization.setMushafPageState(
    req.user.uid,
    req.params.page,
    req.body && req.body.lifecycle_state
  );
  res.json(result);
});

router.put('/progress/groups/state', async function (req, res) {
  const result = await QuranAyahMemorization.setProgressGroupState(
    req.user.uid,
    req.body && req.body.group_key,
    req.body && req.body.lifecycle_state
  );
  res.json(result);
});

router.put('/surahs/:surah/core', async function (req, res) {
  const result = await QuranAyahMemorization.markSurahCore(req.user.uid, req.params.surah);
  res.json(result);
});

router.post('/onboarding', async function (req, res) {
  const knownValues = req.body && req.body.known_surahs;
  if (knownValues !== undefined && !Array.isArray(knownValues)) {
    const err = new Error('Known surahs must be a list.');
    err.status = 400;
    throw err;
  }
  const knownSurahs = Array.from(new Set((knownValues || []).map(Number)));
  if (knownSurahs.length > 114 || knownSurahs.some(surah => !QuranAyahMemorization.parseRef(surah, 1))) {
    const err = new Error('Choose valid surahs that you know by heart.');
    err.status = 400;
    throw err;
  }
  const known = [];
  for (const surah of knownSurahs)
    known.push(await QuranAyahMemorization.markSurahCore(req.user.uid, surah));
  const learning = await QuranAyahMemorization.enrollLearningAyahs(
    req.user.uid,
    req.body && req.body.learning_surah,
    req.body && req.body.learning_ayah_count
  );
  res.json({ known_surahs: known.map(result => result.surah_number), learning });
});

router.post('/ayahs/:surah/:ayah/activity', async function (req, res) {
  const ayah = await QuranAyahMemorization.recordLearningActivity(
    req.user.uid,
    req.params.surah,
    req.params.ayah,
    req.body && req.body.learning_progress,
    { expectedVersion: expectedVersion(req) }
  );
  res.json({ ayah });
});

router.post('/ayahs/:surah/:ayah/memorized', async function (req, res) {
  const ayah = await QuranAyahMemorization.updateState(
    req.user.uid,
    req.params.surah,
    req.params.ayah,
    'review',
    { expectedVersion: expectedVersion(req) }
  );
  res.json({ ayah });
});

router.post('/ayahs/:surah/:ayah/reviews', async function (req, res) {
  const settings = await UserSettings.getSettings(req.user.uid);
  const result = await QuranAyahMemorization.recordSessionReview(
    req.user.uid,
    req.body && req.body.session_id,
    req.params.surah,
    req.params.ayah,
    req.body && req.body.grade,
    {
      attemptToken: req.body && req.body.attempt_token,
      durationSeconds: req.body && req.body.duration_seconds,
      mistakeCount: req.body && req.body.mistake_count,
      promptCount: req.body && req.body.prompt_count,
      fsrs: settings.memorization && settings.memorization.fsrs
    }
  );
  if (req.body && req.body.session_id) {
    try {
      result.next_review = await QuranAyahMemorization.nextSessionItem(
        req.user.uid,
        req.body.session_id,
        req.body.day_start
      );
    } catch (err) {
      result.next_review = null;
      result.next_review_error = err.message || 'Unable to select the next review.';
    }
  }
  res.json(result);
});

router.post('/review/sessions/:session/undo', async function (req, res) {
  const result = await QuranAyahMemorization.undoSessionReview(
    req.user.uid,
    req.params.session,
    req.body && req.body.attempt_token
  );
  res.json(result);
});

router.get('/collections/:collection', async function (req, res) {
  const ayahs = await QuranAyahMemorization.collection(req.user.uid, req.params.collection);
  res.json({ ayahs });
});

router.get('/progress', async function (req, res) {
  const progress = await QuranAyahMemorization.progress(req.user.uid);
  res.json({ progress });
});

router.get('/progress/groups', async function (req, res) {
  const [progress, groups] = await Promise.all([
    QuranAyahMemorization.progress(req.user.uid),
    QuranAyahMemorization.progressGroups(req.user.uid)
  ]);
  res.json({ progress, groups });
});

router.post('/review/sessions', async function (req, res) {
  const settings = await UserSettings.getSettings(req.user.uid);
  const session = await QuranAyahMemorization.startReviewSession(req.user.uid, settings, {
    mode: req.body && req.body.mode,
    surahNumber: req.body && req.body.surah_number,
    reviewType: req.body && req.body.review_type,
    reviewUnit: req.body && req.body.review_unit,
    pageNumber: req.body && req.body.page_number,
    startRef: req.body && req.body.start_ref,
    continueForward: req.body && req.body.continue_forward
  });
  res.status(201).json({ session });
});

router.get('/review/sessions/active', async function (req, res) {
  const session = await QuranAyahMemorization.activeReviewSession(req.user.uid);
  res.json({ session });
});

router.get('/review/sessions/paused', async function (req, res) {
  const sessions = await QuranAyahMemorization.pausedReviewSessions(req.user.uid);
  res.json({ sessions });
});

router.get('/review/sessions/open', async function (req, res) {
  const sessions = await QuranAyahMemorization.openReviewSessions(req.user.uid);
  res.json({ sessions });
});

router.post('/review/sessions/:session/pause', async function (req, res) {
  const session = await QuranAyahMemorization.pauseReviewSession(req.user.uid, req.params.session);
  res.json({ session });
});

router.post('/review/sessions/:session/resume', async function (req, res) {
  const session = await QuranAyahMemorization.resumeReviewSession(req.user.uid, req.params.session);
  res.json({ session });
});

router.post('/review/sessions/:session/end', async function (req, res) {
  const session = await QuranAyahMemorization.endReviewSession(req.user.uid, req.params.session);
  res.json({ session });
});

router.get('/review/stats', async function (req, res) {
  const stats = await QuranAyahMemorization.reviewStats(req.user.uid, req.query.days, req.query.timezone);
  res.json({ stats });
});

router.post('/fsrs/optimize', fsrsOptimizerLimiter, async function (req, res) {
  const [settings, optimized] = await Promise.all([
    UserSettings.getSettings(req.user.uid),
    QuranAyahMemorization.optimizeFsrsParameters(req.user.uid)
  ]);
  const saved = await UserSettings.saveSettings(req.user, {
    ...settings,
    memorization: {
      ...settings.memorization,
      fsrs: {
        ...settings.memorization.fsrs,
        parameters: optimized.parameters,
        optimizedAt: new Date().toISOString()
      }
    }
  });
  res.json({ fsrs: saved.memorization.fsrs, review_count: optimized.reviewCount });
});

router.get('/review/active/:surah/:ayah/reviewed', async function (req, res) {
  const state = await QuranAyahMemorization.activeSessionReviewState(
    req.user.uid,
    req.params.surah,
    req.params.ayah,
    req.query.day_start
  );
  if (!state) return res.status(404).json({ error: 'This ayah is not the active review item.' });
  res.json(state);
});

router.get('/review/sessions/:session/next', async function (req, res) {
  const result = await QuranAyahMemorization.nextSessionItem(req.user.uid, req.params.session, req.query.day_start);
  res.json(result);
});

router.post('/pages/:page/transcribe',
  recitationLimiter,
  express.raw({ type: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'application/octet-stream'], limit: '8mb' }),
  async function (req, res) {
    const pageNumber = Number(req.params.page);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 604)
      return res.status(400).json({ error: 'A valid Mushaf page is required.' });
    const result = await QuranRecitationFeedback.transcribe(pageNumber, req.body, req.get('content-type') || 'audio/webm');
    res.json(result);
  });

router.use(function (err, req, res, next) {
  debug.error(`${req.method} ${req.originalUrl}: ${err.message}\n${err.stack || ''}`);
  if (res.headersSent) return next(err);
  const status = Number(err.status || err.statusCode);
  res.status(Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500)
    .json({ error: err.message || 'Unable to load memorization progress.' });
});

module.exports = router;
