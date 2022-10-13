/* jslint node:true, esversion:8 */
'use strict';

const express = require('express');
const asyncify = require('express-asyncify');
const Hadith = require('../lib/Hadith');


const router = asyncify(express.Router());

router.get('/', async function (req, res, next) {
  var results = [];
  results = await Hadith.a_getRecentUpdates();
  res.render('recent', {
    results: results
  });
});

module.exports = router;
