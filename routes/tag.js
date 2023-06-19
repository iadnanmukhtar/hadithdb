/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const createError = require('http-errors');
const asyncify = require('express-asyncify');
const Hadith = require('../lib/Hadith');
// const lev = require('fast-levenshtein');
const Arabic = require('../lib/Arabic');
const Utils = require('../lib/Utils');

const router = asyncify(express.Router());

router.get('/:tag', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var tag = global.tags.find(function (val) {
    return (val.text_en == req.params.tag);
  });
  if (!tag)
    throw createError(404, `Tag '${req.params.tag}' not found`);

  var offset = 0;
  if (req.query.o)
    offset = Math.floor(parseFloat(req.query.o) / global.MAX_PER_PAGE) * global.MAX_PER_PAGE;
  var results = await Hadith.a_GetAllHadithsWithTag(tag.id);
  var count = results.length;
  results.map(function (h) {
    h.bodyBackup = `${h.body}`;
    h.body = Arabic.disemvowelArabic(h.body);
  });
  var groupedResults = [];
  var groupNo = 1;
  while (results.length > 0) {
    var hadith1 = Object.assign({}, results.splice(0, 1)[0]);
    hadith1.groupNo = groupNo;
    hadith1.rating = 1.1;
    var group = [hadith1];
    for (var j = 0; j < results.length - 1; j++) {
      var r = Hadith.findBestMatch(hadith1, results[j]).bestMatch.rating;
      if (r >= 0.65) {
        var hadith2 = Object.assign({}, results[j]);
        hadith2.groupNo = groupNo;
        hadith2.rating = r;
        group.push(hadith2);
        results.splice(j--, 1);
      }
    }
    group.sort(function (x, y) {
      return x.bookId - y.bookId;
    });
    groupedResults.push(group);
    groupNo++;
  }
  if (results.length > 0) {
    results.sort(function (x, y) {
      return x.bookId - y.bookId;
    });
    groupedResults.push(results);
  }
  groupedResults.sort(function (x, y) {
    return x[0].bookId - y[0].bookId;
  });
  var flattenedGroups = [];
  groupedResults.forEach(function (group) {
    group.forEach(function (hadith) {
      flattenedGroups.push(hadith);
    })
  });
  results = flattenedGroups;
  results.map(function (h) {
    h.body = `${h.bodyBackup}`;
    delete h.bodyBackup;
    var chain = Utils.emptyIfNull(h.chain_en).split(/>/g).reverse();
    chain.map(function (n) {
      return n.trim();
    });
    h.chain_en_reverse = chain.join(' > ');
    return h;
  });
  if ('json' in req.query) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(results));
  } else if ('chains' in req.query) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    var out = '';
    for (var i = 0; i < results.length; i++) {
      var chain = Utils.emptyIfNull(results[i].chain_en).split(/>/g).reverse();
      for (var j = 0; j < chain.length; j++) {
        for (var k = 0; k < j; k++) out += '\t';
        out += '* ' + chain[j].trim().replace(/ /g, '_');
        out += '\n';
      }
    }
    res.end(out);
  } else if ('tsv' in req.query) {
    res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
    var keyNames = Object.keys(results[0]);
    if ('keys' in req.query)
      keyNames = req.query.keys.split(/,/);
    res.end(Utils.toTSV(results, keyNames));
  } else {
    results = results.slice(offset, offset + global.MAX_PER_PAGE + 1);
    results.pg = (offset / global.MAX_PER_PAGE) + 1;
    results.offset = offset;
    results.hasNext = (results.length > global.MAX_PER_PAGE);
    if (results.hasNext)
      results.pop();
    results.prevOffset = ((offset - global.MAX_PER_PAGE) < global.MAX_PER_PAGE) ? 0 : offset - global.MAX_PER_PAGE;
    results.nextOffset = offset + global.MAX_PER_PAGE;
    results.hasPrev = ((offset - global.MAX_PER_PAGE) >= 0);
    if (!results.hasNext)
      delete results.nextOffset;
    if (results.length == 0)
      throw createError(404, `Page ${results.pg} of Tag '${tag.text_en}' does not exist`);
    res.render('tag', {
      tag: tag,
      results: results,
      count: count
    });
  }
});

module.exports = router;

