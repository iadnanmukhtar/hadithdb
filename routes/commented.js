/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:requests');
const express = require('express');
const asyncify = require('express-asyncify').default;
const { Item } = require('../lib/Model');


const router = asyncify(express.Router());

router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var results = [];
  results = await global.query(`SELECT * FROM v_hadiths WHERE hId IN 
    (SELECT id FROM hadiths WHERE commented > 0)
    ORDER BY lastmod DESC
    LIMIT ${global.settings.search.itemsPerPage}`);
  results = results.map(item => new Item(item));
  res.render('highlights', {
    results: results
  });
});

module.exports = router;