'use strict';
const express = require('express');
const GoogleAuth = require('../lib/GoogleAuth');
const Notebook = require('../lib/NotebookDrive');
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
router.get('/ayah', async (req, res, next) => {
  try {
    const ref = String(req.query.reference || '');
    if (!/^quran:\d{1,3}:\d{1,3}$/.test(ref)) return res.status(400).json({ error: 'Invalid ayah.' });
    const item = await require('../lib/Model').Item.itemFromRef(ref);
    if (!item || item.ref !== ref || !Number.isSafeInteger(Number(item.id))) return res.status(404).json({ error: 'Ayah not found.' });
    const source = { source_key: `item:${item.id}`, source_title: ref, source_url: `/${ref}`, markdown: '', version: 0 };
    res.json({ source });
  } catch (err) { next(err); }
});
router.get('/drive', async (req, res, next) => {
  try { res.json(await Notebook.connectionStatus(req.user.uid)); } catch (err) { next(err); }
});
router.post('/drive/connect', async (req, res, next) => {
  try {
    const origin = req.get('Origin');
    const allowed = [...Object.values(global.settings?.site || {}), ...(process.env.GOOGLE_DRIVE_ORIGINS || '').split(',')]
      .filter(value => typeof value === 'string' && /^https?:\/\//.test(value)).map(value => new URL(value).origin);
    if (process.env.NODE_ENV !== 'production') allowed.push('http://localhost:3004', 'http://127.0.0.1:3004');
    if (req.get('X-Requested-With') !== 'XmlHttpRequest' || !allowed.includes(origin))
      return res.status(403).json({ error: 'Invalid Google Drive authorization origin.' });
    res.json(await Notebook.connect(req.user, req.body?.code, origin));
  } catch (err) { next(err); }
});
router.post('/drive/migrate', async (req, res, next) => {
  try { res.json(await Notebook.migrate(req.user.uid)); } catch (err) { next(err); }
});
router.delete('/drive', async (req, res, next) => {
  try { await Notebook.disconnect(req.user.uid); res.json({ disconnected: true }); } catch (err) { next(err); }
});
router.get('/tags', async (req, res, next) => {
  try { res.json({ tags: await Notebook.tagList(req.user.uid) }); } catch (err) { next(err); }
});
router.post('/download', (req, res, next) => {
  try { res.json({ markdown: Notebook.exportMarkdown(req.body || {}) }); } catch (err) { next(err); }
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
    res.json(await Notebook.list(req.user.uid, offset, req.query.q || '', req.query.tag || ''));
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
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Could not access your notebook. Please try again.', code: err.code });
});
module.exports = router;
