/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:requests');
const express = require('express');
const asyncify = require('express-asyncify').default;
const Hadith = require('../lib/Hadith');


const router = asyncify(express.Router());

router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var results = [];
  results = await Hadith.a_dbGetTranslationRequests();
  res.render('requests', {
    results: results
  });
});

module.exports = router;
