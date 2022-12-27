/* jslint node:true, esversion:8 */
'use strict';

const stringSimilarity = require("string-similarity");

const path = require('path');
const HomeDir = require('os').homedir();
const createError = require('http-errors');
const express = require('express');
const asyncify = require('express-asyncify');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser')
const ExpressAdmin = require('express-admin');
const MySQL = require('mysql');
const si = require('search-index');
const util = require('util');
const Arabic = require('./lib/Arabic');
const Utils = require('./lib/Utils');
const Hadith = require('./lib/Hadith');

global.utils = Utils;
global.arabic = Arabic;

var app = asyncify(express());

var ExpressAdminConfig = {
  dpath: './express-admin/',
  config: require(`${HomeDir}/.hadithdb/express-admin/config.json`),
  settings: require('./express-admin/settings.json'),
  custom: require(`${HomeDir}/.hadithdb/express-admin/custom.json`),
  users: require(`${HomeDir}/.hadithdb/express-admin/users.json`)
};

ExpressAdmin.init(ExpressAdminConfig, function (err, admin) {
  if (err) return console.log(err);

  app.use('/admin', admin);

  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');

  //app.use(logger('dev'));
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());
  app.use(cookieParser());
  app.use('/', express.static(path.join(__dirname, 'public')));

  const toolsRouter = require('./routes/tools');
  const recentRouter = require('./routes/recent');
  const booksRouter = require('./routes/books');
  const indexRouter = require('./routes/index');
  app.use('/tools', toolsRouter);
  app.use('/recent', recentRouter);
  app.use('/books', booksRouter);
  app.use('/', indexRouter);

  app.use(function (req, res, next) {
    next(createError(404, 'Requested resource not found'));
  });

  app.use(function (err, req, res, next) {
    res.locals.req = req;
    res.locals.res = res;
    res.locals.message = err.message;
    res.locals.error = err;
    res.status(err.status || 500);
    res.render('error');
  });

});

// initialize data load
global.MySQLConfig = require(HomeDir + '/.hadithdb/store.json');
global.books = [{
  id: -1,
  alias: 'none',
  shortName_en: 'Loading...',
  shortName: "",
  name_en: 'Loading...',
  name: '',
}];
global.grades = [{
  id: -1,
  hadithId: -1,
  grade_en: 'N/A',
  grade: '',
}];
global.graders = [{
  id: -1,
  shortName_en: 'N/A',
  shortName: '',
  name_en: '',
  name: '',
}];
global.tags = [];

global.dbPool = MySQL.createPool(global.MySQLConfig.connection);
global.query = util.promisify(global.dbPool.query).bind(global.dbPool);
global.quran = [];
async function a_dbInitApp() {
  console.error('loading books...');
  global.books = await global.query('SELECT * FROM books ORDER BY id');
  console.error('loading quran...');
  global.quran = await global.query('SELECT * FROM v_hadiths WHERE bookId=0 ORDER BY h1, numInChapter');
  for (var i = 0; i < global.quran.length; i++)
    global.quran[i].search_body = Arabic.normalize(Arabic.removeArabicDiacritics(global.quran[i].body));
  console.error('loading tags...');
  global.tags = await global.query('SELECT * FROM tags');
  console.error('loading grades...');
  global.grades = await global.query('SELECT * FROM grades');
  console.error('loading graders...');
  global.graders = await global.query('SELECT * FROM graders');
  console.error('done loading hadith data');
  console.error('initializing search index');
  global.searchIdx = await si({ name: `${HomeDir}/.hadithdb/si` });
  global.search = util.promisify(global.searchIdx.SEARCH).bind();

  var bookId = 8;

  // console.log('fix hadith decimal numbers');
  // var rows = await global.query(`SELECT * FROM hadiths WHERE num REGEXP "[^0-9]" ORDER BY bookId`);
  // console.log(`fixing ${rows.length} numbers`);
  // for (var i = 0; i < rows.length; i++) {
  //   var numDec = Hadith.hadithNumtoDecimal(rows[i].num);
  //   console.log(`fixing ${rows[i].bookId}:${rows[i].num} to ${numDec}`);
  //   await global.query(`
  //     UPDATE hadiths SET num0="${numDec}"
  //     WHERE id=${rows[i].id}
  //   `);
  // }

  // update hadiths heading numbers based on toc
  // var toc = await global.query(`SELECT * FROM toc WHERE bookId=${bookId} ORDER BY h1,h2,h3`);
  // var sql = '';
  // for (var i = 0; i < toc.length; i++) {
  //   // if (toc[i].h1 < 24)
  //   //   continue;
  //   if (i < (toc.length - 1)) {
  //     sql = global.utils.sql(`
  //       UPDATE hadiths
  //       SET h1=${toc[i].h1},h2=${toc[i].h2},h3=${toc[i].h3}
  //       WHERE bookId=${bookId} AND num0 BETWEEN ${toc[i].start0} AND ${toc[i + 1].start0}
  //     `);
  //     if (toc[i+1].start0 < toc[i].start0) {
  //       console.error(sql);
  //       console.error(toc[i+1]);
  //       console.error(`next hadith range (${toc[i+1].start0}) is less than the previous (${toc[i].start0})`);
  //       break;
  //     }
  //   } else {
  //     sql = global.utils.sql(`
  //       UPDATE hadiths
  //       SET h1=${toc[i].h1},h2=${toc[i].h2},h3=${toc[i].h3}
  //       WHERE bookId=${bookId} AND num0 >= ${toc[i].start0}
  //     `);
  //   }
  //   console.log(sql);
  //   await global.query(sql);
  // }

  // // update numInChapter
  // var prevH1 = 0;
  // var numInChapter = 0;
  // var hadiths = await global.query(`SELECT * FROM hadiths WHERE bookId=${bookId} ORDER BY h1,h2,h3,num0`);
  // for (var i = 0; i < hadiths.length; i++) {
  //   if (hadiths[i].h1 != prevH1)
  //     numInChapter = 0;
  //   prevH1 = hadiths[i].h1;
  //   numInChapter++;
  //   var sql = global.utils.sql(`
  //     UPDATE hadiths
  //     SET numInChapter=${numInChapter}
  //     WHERE id=${hadiths[i].id}
  //   `);
  //   console.log(sql);
  //   await global.query(sql);
  // }

  // split chain and body where missing
  // var rows = await global.query(`SELECT * FROM hadiths
  //   WHERE bookId > 0 AND (chain IS null OR chain = '')
  //   ORDER BY bookId, numInChapter`);
  // for (var i = 0; i < rows.length; i++) {
  //   if (rows[i].body) {
  //     rows[i].text = rows[i].body;
  //     var text = Hadith.splitHadithText(rows[i]);
  //     console.log(`updating ${rows[i].bookId}:${rows[i].num}`);
  //     await global.query(`update hadiths set chain='${text.chain}', body='${text.body}'
  //       WHERE id=${rows[i].id}`);
  //   }
  // }

  // // restore db from search index
  // var docs = await global.searchIdx.ALL_DOCUMENTS(110000);
  // for (var i = 0; i < docs.length; i++) {
  //   var doc = docs[i]._doc;
  //   console.log(`restoring ${doc._id} ${doc.bookId}:${doc.num}`);
  //   await global.query(`update hadiths set chain='${doc.chain}', body='${doc.body}'
  //       WHERE id=${doc._id}`);
  // }

  // // restore grader from search index
  // var docs = await global.searchIdx.ALL_DOCUMENTS(110000);
  // for (var i = 0; i < docs.length; i++) {
  //   var doc = docs[i]._doc;
  //   if (doc.bookId == 3 || doc.bookId == 4) {
  //     console.log(`restoring ${doc._id} ${doc.bookId}:${doc.num}`);
  //     var grader = global.graders.find(function (val) {
  //       return val.shortName_en == doc.grader_en;
  //     });
  //     await global.query(`update hadiths set graderId='${grader.id}'
  //       WHERE id=${doc._id}`);
  //   }
  // }

  // // match muslim ahadith of lulu marjan
  // var lulu = await global.query('select id, hno, nass_matched as body, muslim_h1, muslim_h2 from b10619 where hno is not null');
  // var sah = await global.query('select * from hadiths h where h.bookId=2 and remark=0 order by ordinal');
  // for (var i = 0; i < lulu.length; i++) {
  //   // console.log(`lulu ${lulu[i].hno}`);
  //   lulu[i] = Hadith.disemvoweledHadith(lulu[i]);
  //   var maxi = 0;
  //   var maxRating = 0;
  //   for (var j = 0; j < sah.length; j++) {
  //     if (sah[j].h1 == lulu[i].muslim_h1 && sah[j].h2 == lulu[i].muslim_h2) {
  //       sah[j] = Hadith.disemvoweledHadith(sah[j]);
  //       var match = Hadith.findBestMatch(lulu[i], sah[j]);
  //       if (match.bestMatch.rating > maxRating) {
  //         maxRating = match.bestMatch.rating;
  //         maxi = j;
  //       }
  //     }
  //   }
  //   console.log(`${sah[maxi].id}\t${lulu[i].hno}\t${sah[maxi].bookId}:${sah[maxi].num0}\t${maxRating}`);
  //   await global.query(`update b10619 set muslim_id=${sah[maxi].id}, muslim_rating=${maxRating} where id=${lulu[i].id}`);
  // }

//  // match bukhari ahadith of lulu marjan
//  var lulu = await global.query('select id, hno, nass_matched as body, bukhari_h1, bukhari_h2 from b10619 where hno is not null and bukhari_id is null');
//  var sah = await global.query('select * from hadiths h where h.bookId=1 and remark=0 order by ordinal');
//  for (var i = 0; i < lulu.length; i++) {
//    // console.log(`lulu ${lulu[i].hno}`);
//    lulu[i] = Hadith.disemvoweledHadith(lulu[i]);
//    var maxi = 0;
//    var maxRating = 0;
//    for (var j = 0; j < sah.length; j++) {
//      //if (!lulu[i].bukhari_h1 || (sah[j].h1 == lulu[i].bukhari_h1 && sah[j].h2 == lulu[i].bukhari_h2)) {
//        sah[j] = Hadith.disemvoweledHadith(sah[j]);
//        var match = Hadith.findBestMatch(lulu[i], sah[j]);
//        if (match.bestMatch.rating > maxRating) {
//          maxRating = match.bestMatch.rating;
//          maxi = j;
//        }
//      //}
//    }
//    console.log(`${sah[maxi].id}\t${lulu[i].hno}\t${sah[maxi].bookId}:${sah[maxi].num0}\t${maxRating}`);
//    await global.query(`update b10619 set bukhari_id=${sah[maxi].id}, bukhari_rating=${maxRating} where id=${lulu[i].id}`);
//  }

  // // match muslim titles lulu marjan
  // var lulu = await global.query('select id, nass from b10619 where hno is null and muslim_h1 is null');
  // var toc = await global.query('select * from toc where bookId=2 and level=1 order by h1, h2');
  // for (var i = 0; i < lulu.length; i++) {
  //   // console.log(`lulu ${lulu[i].hno}`);
  //   lulu[i].nass = Arabic.removeArabicDiacritics(lulu[i].nass);
  //   var maxi = 0;
  //   var maxRating = 0;
  //   for (var j = 0; j < toc.length; j++) {
  //     toc[j].title = Arabic.removeArabicDiacritics(toc[j].title).replace(/باب /, '');
  //     var rating = stringSimilarity.compareTwoStrings(lulu[i].nass, toc[j].title);
  //     if (rating > maxRating) {
  //       maxRating = rating;
  //       maxi = j;
  //     }
  //   }
  //   console.log(`${toc[maxi].id}\t${lulu[i].nass}\t${toc[maxi].bookId}:${toc[maxi].title}\t${maxRating}`);
  //   await global.query(`update b10619 set muslim_toc_id=${toc[maxi].id},muslim_toc_rating=${maxRating} where id=${lulu[i].id}`);
  // }

  // // copy muslim h1 and h2 to hadith
  // var lulu = await global.query('select * from b10619 order by id');
  // var h1 = null;
  // var h2 = null;
  // for (var i = 0; i < lulu.length; i++) {
  //   if (lulu[i].muslim_h1) {
  //     h1 = lulu[i].muslim_h1;
  //     h2 = lulu[i].muslim_h2;
  //   } else {
  //     console.log(`${lulu[i].id}\t${lulu[i].hno}\t${h1}\t${h2}`);
  //     await global.query(`update b10619 set muslim_h1=${h1},muslim_h2=${h2} where id=${lulu[i].id}`);
  //   }
  // }

}
a_dbInitApp();

module.exports = app;