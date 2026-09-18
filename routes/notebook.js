'use strict';
const express = require('express');
const GoogleAuth = require('../lib/GoogleAuth');
const Notebook = require('../lib/UserNotebook');
const router = express.Router();
router.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});
router.page = (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.locals.req = req;
  res.locals.res = res;
  res.render('notebook', { page: { menu: 'Notebook', title_en: 'My Notebook', description_en: 'Your private reading notes', canonical: '/notebook', alternate: '/notebook', feed: null, noindex: true, nofollow: true, context: {} } });
};
router.use(async (req, res, next) => {
  try { req.user = await GoogleAuth.verifyRequest(req); }
  catch (_) { return res.status(401).json({ error: 'Please sign in to use your notebook.' }); }
  if (!req.user) return res.status(401).json({ error: 'Please sign in to use your notebook.' });
  next();
});
router.get('/download', async (req, res, next) => {
  try {
    const zip = await Notebook.exportZip(req.user.uid);
    res.type('application/zip').attachment('My Notebook.zip').send(zip);
  } catch (err) { next(err); }
});
router.get('/', async (req, res, next) => {
  try {
    if (req.query.source) return res.json({ note: await Notebook.get(req.user.uid, req.query.source) });
    const offset = Number(req.query.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return res.status(400).json({ error: 'Invalid page.' });
    res.json(await Notebook.list(req.user.uid, offset));
  } catch (err) { next(err); }
});
router.put('/', async (req, res, next) => {
  try { res.json({ note: await Notebook.save(req.user.uid, req.body || {}) }); } catch (err) { next(err); }
});
router.delete('/', async (req, res, next) => {
  try { await Notebook.remove(req.user.uid, req.body.source_key, req.body.version); res.json({ deleted: true }); } catch (err) { next(err); }
});
router.post('/status', async (req, res, next) => {
  try { res.json({ sources: await Notebook.status(req.user.uid, req.body && req.body.sources) }); } catch (err) { next(err); }
});
router.post('/expand', async (req, res, next) => {
  try { res.json({ note: await Notebook.expand(req.user.uid, req.body || {}) }); } catch (err) { next(err); }
});
router.post('/preview', (req, res) => {
  const text = req.body && req.body.markdown;
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 65535) return res.status(400).json({ error: 'Invalid Markdown.' });
  res.json({ html: Notebook.render(text) });
});
router.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Could not access your notebook. Please try again.' });
});
module.exports = router;
