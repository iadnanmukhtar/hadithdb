/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:tag');
const express = require('express');
const createError = require('http-errors');
const { homedir } = require('os');
const fs = require('fs');
const ejs = require('ejs');
const Hadith = require('../lib/Hadith');
const Arabic = require('../lib/Arabic');
const Utils = require('../lib/Utils');
const Index = require('../lib/Index');
const { Item } = require('../lib/Model');

const router = express.Router();

router.get('/:tag', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;

  if (req.params.tag == '_list') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    var result = global.tags;
    if (req.query.s) {
      result = global.tags.filter(function (t) {
        return t.text_en.includes(req.query.s);
      });
    }
    res.end(JSON.stringify(result.map(function (t) {
      return { id: t.text_en, label: t.text_en, value: t.text_en };
    })));
    return;
  }

  var admin = (req.cookies.admin == global.settings.admin.key);
  var editMode = (admin && req.cookies.editMode == 1);
  var cachedFile = `${homedir}/.hadithdb/cache/${Utils.reqToFilename(req)}.html`;
  if (!('flush' in req.query) && !editMode && fs.existsSync(cachedFile)) {
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.end(fs.readFileSync(cachedFile));
    return;
  }

  var offset = 0;
  if (req.query.o)
    offset = Math.floor(parseFloat(req.query.o) / global.settings.search.itemsPerPage) * global.settings.search.itemsPerPage;
  
  var queryString = '';
  var tags = req.params.tag.split(/\+/);
  for (var i in tags) {
    if (i > 0)
      queryString += ' AND ';
    queryString += `(tags:"{${tags[i]}}" OR part:"${tags[i]}")`;
  }
  var results = await Index.docsFromQueryString(Item.INDEX, queryString, 0, 5000);
  results = results.map(item => new Item(item));

  var count = results.length;
  results.map(function (h) {
    h.bodyBackup = `${h.body}`;
    h.body = Arabic.disemvowelArabic(h.body);
  });
  var groupedResults = [];
  var groupNo = 1;
  while (results.length > 0) {
    var hadith1 = new Item(Object.assign({}, results.splice(0, 1)[0]));
    hadith1.groupNo = groupNo;
    hadith1.rating = 1.1;
    var group = [hadith1];
    for (var j = 0; j < results.length - 1; j++) {
      var r = Hadith.findBestMatch(hadith1, results[j]).bestMatch.rating;
      if (r >= 0.60) {
        var hadith2 = new Item(Object.assign({}, results[j]));
        hadith2.groupNo = groupNo;
        hadith2.rating = r;
        group.push(hadith2);
        results.splice(j--, 1);
      }
    }
    group.sort(function (x, y) {
      return x.book_id - y.book_id;
    });
    groupedResults.push(group);
    groupNo++;
  }
  if (results.length > 0) {
    results.sort(function (x, y) {
      return x.book_id - y.book_id;
    });
    groupedResults.push(results);
  }
  groupedResults.sort(function (x, y) {
    return x[0].book_id - y[0].book_id;
  });
  var flattenedGroups = [];
  groupedResults.forEach(function (group) {
    group.forEach(function (hadith) {
      flattenedGroups.push(hadith);
    })
  });
  results = flattenedGroups;
  results.map(function (h) {
    h.body = h.ar.body = `${h.bodyBackup}`;
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
    var size = global.settings.search.itemsPerPage;
    var end = offset + size + 1;
    if (end > (results.length - 1))
      end = results.length;
    results = results.slice(offset, end);
    // set offset based attributes
		results.page = {
			offset: offset,
			number: (offset / size) + 1,
			hasNext: (results.length > size),
			prevOffset: ((offset - size) < size) ? 0 : offset - size,
			nextOffset: offset + size,
			hasPrev: ((offset - size) >= 0),
		};
		if (results.page.hasNext)
			results.pop();
    // results.pg = (offset / global.settings.search.itemsPerPage) + 1;
    // results.offset = offset;
    // results.hasNext = (results.length > global.settings.search.itemsPerPage);
    // if (results.hasNext)
    //   results.pop();
    // results.prevOffset = ((offset - global.settings.search.itemsPerPage) < global.settings.search.itemsPerPage) ? 0 : offset - global.settings.search.itemsPerPage;
    // results.nextOffset = offset + global.settings.search.itemsPerPage;
    // results.hasPrev = ((offset - global.settings.search.itemsPerPage) >= 0);
    // if (!results.hasNext)
    //   delete results.nextOffset;
    if (results.length == 0)
      throw createError(404, `Page ${results.pg} of Tag '${tag.text_en}' does not exist`);

    // cache response
    var html = await ejs.renderFile(`${__dirname}/../views/tag.ejs`, {
      tag: tags,
      results: results,
      count: count,
      req: req,
      res: res
    });
    fs.writeFileSync(cachedFile, html);

    res.render('tag', {
      tag: tags,
      results: results,
      count: count
    });
  }
});

module.exports = router;

