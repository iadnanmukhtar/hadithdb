/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const asyncify = require('express-asyncify');
const Arabic = require('../lib/Arabic');
const Hadith = require('../lib/Hadith');

const router = asyncify(express.Router());
  
router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var result = '';
  if (req.query.s) {
    result = Arabic.toALALC(req.query.s);
    res.render('tools', {
      s: req.query.s,
      alalc: Arabic.toALALC(req.query.s),
      trans: Hadith.translateNarrators(req.query.s)
    });
  } else {
    res.render('tools', {
      s: null,
      alalc: null,
      trans: null
    });
  }
});

module.exports = router;

