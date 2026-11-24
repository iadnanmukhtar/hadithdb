'use strict';
const express = require('express');
const Access = require('../lib/AdminAccess');
const BookDownloads = require('../lib/BookDownloads');
const router = express.Router();
router.use(Access.privateResponse);
router.use(Access.authorize);
router.post('/session', Access.createSession);
// Keep native attachment downloads on the host that issued the scoped admin cookie.
router.get('/downloads/:bookAlias.:format(json|epub)', BookDownloads.temporarilyUnavailable);
router.get('/downloads/quran/:translationAlias.:format(json|epub)', BookDownloads.temporarilyUnavailable);
router.get('/downloads/quran/tafsir/:tafsirAlias.:format(json|epub)', BookDownloads.temporarilyUnavailable);
router.get('/downloads/sharh/:alias.:format(json|epub)', BookDownloads.temporarilyUnavailable);
router.get('/book-aliases', async (req, res, next) => {
  try { res.json(await require('../lib/BookAliases').list()); } catch (error) { next(error); }
});
router.get('/legacy-graders', async (req, res, next) => {
  try { res.json(await require('../lib/LegacyGraders').list()); } catch (error) { next(error); }
});
router.get('/', (req, res) => {
  res.locals.req = req;
  res.locals.res = res;
  res.render('admin');
});
module.exports = router;
