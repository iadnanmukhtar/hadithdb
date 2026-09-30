'use strict';
const express = require('express');
const Access = require('../lib/AdminAccess');
const router = express.Router();
router.use(Access.privateResponse);
router.use(Access.authorize);
router.post('/session', Access.createSession);
router.get('/legacy-graders', async (req, res, next) => {
  try { res.json(await require('../lib/LegacyGraders').list()); } catch (error) { next(error); }
});
router.get('/', (req, res) => {
  res.locals.req = req;
  res.locals.res = res;
  res.render('admin');
});
module.exports = router;
