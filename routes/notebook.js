'use strict';
const express = require('express');
const GoogleAuth = require('../lib/GoogleAuth');
const Notebook = require('../lib/NotebookDrive');
const Shares = require('../lib/NotebookShare');
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
router.get('/floating', async (req, res, next) => {
  try {
    const settings = await require('../lib/UserSettings').getSettings(req.user.uid);
    res.json({ uid: req.user.uid, floating: settings.notebookFloating });
  } catch (err) { next(err); }
});
router.put('/floating', async (req, res, next) => {
  try {
    const floating = await require('../lib/UserSettings').saveNotebookFloating(req.user, req.body?.floating);
    res.json({ uid: req.user.uid, floating });
  } catch (err) { next(err); }
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
// Resolve exact references to the same identities used by contextual Note buttons.
router.get('/attachment', async (req, res, next) => {
  try {
    const ref = require('../lib/NotebookReferences').reference(String(req.query.reference || '').trim());
    if (/^quran:.*-/.test(ref)) return res.status(400).json({ error: 'Attach one ayah at a time.' });
    const item = await require('../lib/Model').Item.itemFromRef(ref);
    if (!item || String(item.ref).toLowerCase() !== ref || !Number.isSafeInteger(Number(item.id)) || Number(item.id) < 1)
      return res.status(404).json({ error: 'Item not found.' });
    res.json({ source: { source_key: `item:${item.id}`, source_title: ref, source_url: `/${ref}` } });
  } catch (err) { next(err instanceof ReferenceError ? Object.assign(new Error('Item not found.'), { status: 404 }) : err); }
});
router.get('/associated', async (req, res, next) => {
  try { res.json({ notes: await Notebook.related(req.user.uid, req.query.source) }); } catch (err) { next(err); }
});
router.get('/share', async (req, res, next) => {
  try { await Shares.rememberAuthor(req.user); res.json(await Shares.status(req.user.uid, req.query.source)); } catch (err) { next(err); }
});
router.post('/share', async (req, res, next) => {
  try { await Shares.rememberAuthor(req.user); res.json(await Shares.enable(req.user.uid, req.body?.source_key)); } catch (err) { next(err); }
});
router.delete('/share', async (req, res, next) => {
  try { res.json(await Shares.revoke(req.user.uid, req.body?.source_key)); } catch (err) { next(err); }
});
router.get('/drive/shadow', async (req, res, next) => {
  try { res.json(await require('../lib/CommunityDrive').status(req.user.uid)); } catch (err) { next(err); }
});
router.put('/drive/shadow', async (req, res, next) => {
  try { res.json(await require('../lib/CommunityDrive').configure(req.user.uid, req.body?.enabled)); } catch (err) { next(err); }
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
router.post('/drive/import', async (req, res, next) => {
  try { res.json(await Notebook.importFiles(req.user.uid, req.body?.fileIds)); } catch (err) { next(err); }
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
router.get('/stats', async (req, res, next) => {
  try { res.json(await Notebook.stats(req.user.uid)); } catch (err) { next(err); }
});
router.get('/links', async (req, res, next) => {
  try { res.json(await Notebook.links(req.user.uid, req.query.q || '', req.query.title)); } catch (err) { next(err); }
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
    await Shares.rememberAuthor(req.user);
    if (req.query.source) {
      const note = await Notebook.get(req.user.uid, req.query.source);
      if (req.query.context === '1' && note?.links_explicit && !note.attachments.some(entry => entry.source_key === req.query.source)) {
        // The old note still exists in the notebook, but is no longer linked here.
        // A new contextual note gets its own identity instead of overwriting it.
        return res.json({ note: null, source: { source_key: `general:${require('crypto').randomUUID()}`, source_title: 'General note', source_url: '/notebook',
          attachments: [{ source_key: note.source_key, source_title: note.source_title, source_url: note.source_url }], markdown: '', title: '', version: 0 } });
      }
      return res.json({ note });
    }
    const offset = Number(req.query.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return res.status(400).json({ error: 'Invalid page.' });
    res.json(await Notebook.list(req.user.uid, offset, req.query.q || '', req.query.tag || ''));
  } catch (err) { next(err); }
});
router.put('/', async (req, res, next) => {
  try { await Shares.rememberAuthor(req.user); res.json({ note: await Notebook.save(req.user.uid, req.body || {}) }); } catch (err) { next(err); }
});
router.delete('/', async (req, res, next) => {
  try { await Notebook.remove(req.user.uid, req.body.source_key, req.body.version, req.body.revision); res.json({ deleted: true }); } catch (err) { next(err); }
});
router.post('/status', async (req, res, next) => {
  try { res.json({ sources: await Notebook.status(req.user.uid, req.body && req.body.sources) }); } catch (err) { next(err); }
});
router.post('/expand', async (req, res, next) => {
  try { res.json({ note: await Notebook.expand(req.user.uid, req.body || {}) }); } catch (err) { next(err); }
});
router.post('/auto-expand', async (req, res, next) => {
  try { res.json(await require('../lib/UserNotebook').autoExpandDraft(req.body || {})); } catch (err) { next(err); }
});
router.post('/preview', (req, res) => {
  const text = req.body && req.body.markdown;
  if (typeof text !== 'string') return res.status(400).json({ error: 'Invalid Markdown.' });
  res.json({ html: Notebook.render(text) });
});
router.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Could not access your notebook. Please try again.', code: err.code });
});
module.exports = router;
