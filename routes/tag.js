/* jslint node:true, esversion:9 */
'use strict';

const createError = require('http-errors');
const express = require('express');

const router = express.Router();

router.all('/:tag', function (req, res, next) {
  next(createError(405, 'Tag pages are not available.'));
});

module.exports = router;
