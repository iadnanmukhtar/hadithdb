/* jslint node:true, esversion:6 */
'use strict';

const fs = require('fs');
const express = require('express');
const Search = require('../lib/Search');
const Hadith = require('../lib/Hadith');

const router = express.Router();

router.get('/reinit', function (req, res, next) {
  Hadith.reinit();
  res.send('<h1>NOTE</h1><p>Database is initializing, please wait a few seconds before your changes will take effect.</p>');
});

router.get('/', function (req, res, next) {
  var results = [];
  if (req.query.q) {
    req.query.q = req.query.q.trim();
    if (req.query.q.match(/^([a-z]+:\d+|\d+)/)) {
      res.redirect('/' + req.query.q);
      return;
    }
    results = Search.searchText(req.query.q);
    res.render('search', {
      q: req.query.q,
      results: results
    });
  } else {
    results = [Search.getRandom()];
    if (results.length > 0) {
      res.render('search', {
        book: results[0].book,
        q: req.query.q,
        results: results
      });
    } else {
      res.render('search', {
        results: results
      });
    }
  }
});

router.get('/:ref', function (req, res, next) {
  if (req.params.ref) {
    var results = Search.lookupByRef(req.params.ref.trim());
    if (results.length > 0) {
      res.render('search', {
        book: results[0].book,
        q: req.query.q,
        results: results
      });
    } else {
      res.render('search', {
        q: req.query.q,
        results: results
      });
    }
  } else
    res.render('index', {
    });
});

module.exports = router;
