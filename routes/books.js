/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const asyncify = require('express-asyncify');


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
  } else {
    res.render('books', {
      books: results
    });
  }
});

module.exports = router;

