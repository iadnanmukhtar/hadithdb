/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:books');
const express = require('express');
const asyncify = require('express-asyncify').default;
const Utils = require('../lib/Utils');

const router = asyncify(express.Router());

router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var results = global.books.filter(function (val) {
    return (val.hidden == 0);
  });
  if ('json' in req.query) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(results));
  } else if ('tsv' in req.query) {
    res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
    var keyNames = Object.keys(results[0]);
    if ('keys' in req.query)
      keyNames = req.query.keys.split(/,/);
    res.end(Utils.toTSV(results, keyNames));
  } else {
    res.render('books', {
      books: results
    });
  }
});

module.exports = router;

