/* jslint node:true, esversion:6 */

"use strict";
const fs = require('fs');
const express = require('express');
const LineReaderSync = require('line-reader-sync');
const Hadith = require('../lib/Hadith');

global.books = JSON.parse(fs.readFileSync(__dirname + '/../data/books.json'));
global.db = [];

var dbsearchable = [];
var recordReader = new LineReaderSync(__dirname + '/../data/hadiths-final.csv');
for (var record = recordReader.readline(); record != null; record = recordReader.readline()) {
  db.push(record);
  dbsearchable.push(removeDiacritics(record));
}

String.prototype.toArabicDigits = function () {
  var s = this.replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
  s = s.replace('a', ' أ').replace('b', ' ب').replace('c', ' ج').replace('d', ' د').replace('e', ' ه').replace('f', ' و').replace('g', ' ز');
  return s;
};

const router = express.Router();

router.get('/', function (req, res, next) {
  if (req.query.q) {
    var results = searchWrapper(req.query.q.trim());
    res.render('search', {
      q: req.query.q,
      results: results
    });
  } else
    res.render('index', {
    });
});

router.get('/:ref', function (req, res, next) {
  if (req.params.ref) {
    var results = searchNumber(req.params.ref.trim());
    res.render('search', {
      q: req.query.q,
      results: results
    });
  } else
    res.render('index', {
    });
});

function searchWrapper(qs) {
  if (qs.match(/^([a-z]+:\d+|\d+)/))
    return searchNumber(qs);
  return search(toQueryPattern(qs));
}

function toQueryPattern(s) {
  s = removeDiacritics(s);
  s = s.replace(/[اءأآإ]/g, '[اءأآإ]');
  s = s.replace(/[يىئ]/g, '[يىئ]');
  s = s.replace(/[ؤو]/g, '[ؤو]');
  return s;
}

function removeDiacritics(s) {
  return s.replace(/[\u064B\u064C\u064D\u064E\u064F\u0650\u0651\u0652\u0670]+/g, '');
}

function search(qs) {
  var results = [];
  // search exact
  var q = new RegExp('(' + qs + ')', 'ig');
  results = results.concat(searchQ(q));
  // search proximity
  var prevq = q;
  var qt = qs.split(/[\s\-\_\,\.\']+/);
  q = '';
  for (var i = 0; i < qt.length; i++) {
    q += qt[i];
    if (i < qt.length - 1)
      q += '.*?';
  }
  q = new RegExp('(' + q + ')', 'ig');
  if (prevq != q) {
    results = results.concat(searchQ(q).filter(function (value) {
      var add = true;
      for (var i = 0; i < results.length; i++) {
        if (results[i].bookId == value.bookId && results[i].hadithNum == value.hadithNum) {
          add = false;
          break;
        }
      }
      return add;
    }));
  }
  // search either or
  prevq = q;
  qt = qs.split(/[\s\-\_\,\.\']+/);
  q = '';
  for (var i = 0; i < qt.length; i++) {
    q += qt[i];
    if (i < qt.length - 1)
      q += '|';
  }
  q = new RegExp('(' + q + ')', 'ig');
  if (prevq != q) {
    results = results.concat(searchQ(q).filter(function (value) {
      var add = true;
      for (var i = 0; i < results.length; i++) {
        if (results[i].bookId == value.bookId && results[i].hadithNum == value.hadithNum) {
          add = false;
          break;
        }
      }
      return add;
    }));
  }

  return results;
}

function searchQ(q) {
  var results = [];
  for (var i = 0; i < db.length; i++) {
    var record = db[i];
    var recordPlain = dbsearchable[i];
    if (results.length > 1000)
      break;
    var recordHilited = '';
    if (recordPlain.match(q)) {
      var re = new RegExp(q, 'gi');
      var m = null;
      var hilites0 = [];
      var hilites1 = [];
      while ((m = re.exec(recordPlain)) !== null) {
        var start = m.index;
        var end = m.index + m[0].length - 1;
        // find starting token
        for (var j = 1; (start - j) > 0; j++)
          if (recordPlain[start - j].match(/[\s]/))
            break;
        if (j < 0) j = 0;
        hilites0.push(recordPlain.substring(0, start - j).split(/ /).length);
        // find ending token
        for (var j = 1; (end + j) < (recordPlain.length - 1); j++)
          if (recordPlain[end + j].match(/\s/))
            break;
        if (j >= recordPlain.length) j = recordPlain.length;
        hilites1.push(recordPlain.substring(0, end + j).split(/ /).length - 1);
      }
      // hilite tokens
      var toks = record.split(/ /);
      for (var j = 0; j < toks.length; j++) {
        if (hilites0.indexOf(j) >= 0)
          recordHilited += '<i>';
        recordHilited += toks[j] + ' ';
        if (hilites1.indexOf(j) >= 0)
          recordHilited += '</i>';
      }
      results.push(new Hadith(i, recordHilited));
    }
  }
  return results;
}

function searchNumber(q) {
  var results = [];
  var toks = q.split(/:/);
  var book = null;
  var bookRef = '';
  var hadithNum = 0;
  if (toks.length == 2) {
    bookRef = toks[0];
    hadithNum = toks[1];
    book = books.filter(function (value) {
      return (value.alias == bookRef || value.id == bookRef);
    });
    var re = new RegExp('^' + book[0].id + '\\t' + hadithNum + '([a-z]?|/[^\\t]*)\\t', 'i');
    for (var i = 0; i < db.length; i++) {
      if (db[i].match(re))
        results.push(new Hadith(i, db[i]));
    }
  } else {
    hadithNum = toks[0];
    var re = new RegExp('^\\d+\\t' + hadithNum + '([a-z]?|/[^\\t]*)\\t', 'i');
    for (var i = 0; i < db.length; i++) {
      if (db[i].match(re))
        results.push(new Hadith(i, db[i]));
    }
  }
  return results;
}

module.exports = router;
