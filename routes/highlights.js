/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:recent');
const express = require('express');
const asyncify = require('express-asyncify').default;
const Hadith = require('../lib/Hadith');

const router = asyncify(express.Router());

router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var results = [];
  results = await Hadith.a_dbGetRecentUpdates();
  if ('rss' in req.query && results.length > 0) {
    res.type('application/rss+xml; charset=utf-8')
    res.render('highlights_rss', {
      results: results
    });
  } else {
    res.render('highlights', {
      results: results
    });
  }
});

module.exports = router;
