/* jslint node:true, esversion:8 */
'use strict';

const express = require('express');
const createError = require('http-errors');
const asyncify = require('express-asyncify');
const Hadith = require('../lib/Hadith');


const router = asyncify(express.Router());

router.get('/:tag', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var tag = global.tags.find(function (val) {
    return (val.text_en == req.params.tag);
  });
  if (!tag)
    throw createError(404, `Tag '${req.params.tag}' not found`);
  var results = await Hadith.a_dbGetAllHadithsWithTag(tag.id);
  res.render('tag', {
    tag: tag,
    results: results
  });
});

module.exports = router;

