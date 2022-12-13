/* jslint node:true, esversion:8 */
'use strict';

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
    next(createError(404));
  });

  app.use(function (err, req, res, next) {
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};
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

  var bookId = 12 ;

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
  
  // restore db from search index
  // var docs = await global.searchIdx.ALL_DOCUMENTS(110000);
  // for (var i = 0; i < docs.length; i++) {
  //   var doc = docs[i]._doc;
  //   console.log(`restoring ${doc._id} ${doc.bookId}:${doc.num}`);
  //   await global.query(`update hadiths set chain='${doc.chain}', body='${doc.body}'
  //       WHERE id=${doc._id}`);
  // }

}
a_dbInitApp();

module.exports = app;