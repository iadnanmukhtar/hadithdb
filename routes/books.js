/* jslint node:true, esversion:8 */
'use strict';

const express = require('express');
const asyncify = require('express-asyncify');


const router = asyncify(express.Router());

router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  res.render('books', {
    books: global.books
  });
});

module.exports = router;

