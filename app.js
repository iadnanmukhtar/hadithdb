/* jslint node:true, esversion:9 */
'use strict';

const stringSimilarity = require("string-similarity");

const path = require('path');
const HomeDir = require('os').homedir();
const createError = require('http-errors');
const express = require('express');
const asyncify = require('express-asyncify');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const ExpressAdmin = require('express-admin');
const MySQL = require('mysql');
const si = require('search-index');
const util = require('util');
const Arabic = require('./lib/Arabic');
const Utils = require('./lib/Utils');
const Hadith = require('./lib/Hadith');
const { title } = require("process");

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
  const tagRouter = require('./routes/tag');
  const searchRouter = require('./routes/search');
  app.use('/tools', toolsRouter);
  app.use('/recent', recentRouter);
  app.use('/books', booksRouter);
  app.use('/tag', tagRouter);
  app.use('/', searchRouter);

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
  await Hadith.a_reinit();
  global.searchIdx = await si({ name: `${HomeDir}/.hadithdb/si` });
  global.search = util.promisify(global.searchIdx.SEARCH).bind();

  var bookId = 14;

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

  // // update hadiths heading numbers based on toc
  // var toc = await global.query(`SELECT * FROM toc WHERE bookId=${bookId} ORDER BY h1,h2,h3`);
  // var sql = '';
  // for (var i = 0; i < toc.length; i++) {
  //   if (i < (toc.length - 1)) {
  //     sql = global.utils.sql(`
  //       UPDATE hadiths
  //       SET h1=${toc[i].h1},h2=${toc[i].h2},h3=${toc[i].h3}
  //       WHERE bookId=${bookId} AND num0 BETWEEN ${toc[i].start0} AND ${toc[i + 1].start0-1+0.9999}
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

  // // update hadiths counts in toc
  // var toc = await global.query(`SELECT * FROM toc WHERE bookId=${bookId} AND level=1 ORDER BY h1`);
  // var sql = '';
  // for (var i = 0; i < toc.length; i++) {
  //   var h1 = await global.query(`SELECT count(*) AS count FROM hadiths WHERE bookId=${bookId} AND h1=${toc[i].h1}`);
  //   sql = global.utils.sql(`UPDATE toc SET count=${h1[0].count} WHERE id=${toc[i].id}`);
  //   console.log(sql);
  //   await global.query(sql);
  // }

  // // update numInChapter
  // var prevH1 = 0;
  // var numInChapter = 0;
  // var hadiths = await global.query(`SELECT * FROM hadiths WHERE bookId = ${bookId} ORDER BY h1,h2,h3,num0`);
  // var inserts = '';
  // var insertCnt = 0;
  // for (var i = 0; i < hadiths.length; i++) {
  //   if (hadiths[i].h1 != prevH1)
  //     numInChapter = 0;
  //   prevH1 = hadiths[i].h1;
  //   numInChapter++;
  //   console.log(`updating numInChapter for ${hadiths[i].bookId}:${hadiths[i].num}`);
  //   if (insertCnt > 0)
  //     inserts += ` UNION ALL `;
  //   inserts += ` SELECT ${hadiths[i].id} AS id, ${numInChapter} AS new`;
  //   if (insertCnt > 100) {
  //     await global.query(`UPDATE hadiths h JOIN ( ${inserts} ) vals ON h.id=vals.id SET numInChapter=new`);
  //     inserts = ``;
  //     insertCnt = 0;
  //   } else
  //     insertCnt++;
  // }
  // if (insertCnt > 0)
  //   await global.query(`UPDATE hadiths h JOIN ( ${inserts} ) vals ON h.id=vals.id SET numInChapter=new`);

  // // split chain and body where missing
  // var rows = await global.query(`SELECT * FROM hadiths
  //   WHERE bookId=${bookId} AND (chain IS null OR chain = '')
  //   ORDER BY bookId, h1, h2, h3, num0`);
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

  // // // restore body_en from search index
  // var docs = await global.searchIdx.ALL_DOCUMENTS(143187);
  // for (var i = 0; i < docs.length; i++) {
  //   var doc = docs[i]._doc;
  //   if (doc.body_en && doc.body_en.length > 0) {
  //     console.log(`restoring ${doc._id} ${doc.book_id}:${doc.num}`);
  //     var grader = global.graders.find(function (val) {
  //       return val.shortName_en == doc.grader_en;
  //     });
  //     await global.query(`update hadiths set body_en='${Utils.escSQL(doc.body_en)}'
  //       WHERE id=${doc._id}`);
  //     // break;
  //   }
  // }

  var shamela = 'b';

  // // concat split up hadith without hno
  // var rows = await global.query(`select * from ${shamela} where toc=0 order by id`);
  // for (var i = 1; i < rows.length; i++) {
  //   if (i == rows.length - 1) break;
  //   if (rows[i].hno != null && rows[i+1].hno == null) {
  //     var nextNass = Utils.escSQL(rows[i+1].nass);
  //     console.log(`concating id:${rows[i].id}:H${rows[i].hno} w/ id:${rows[i+1].id}`);
  //     await global.query(`update ${shamela} set nass=concat(nass, '\\n${nextNass}') where id=${rows[i].id}`);
  //     await global.query(`delete from ${shamela} where id=${rows[i+1].id}`);
  //     i++;
  //   }
  // }

  // // concat split up hadith without same hno
  // var rows = await global.query(`select * from ${shamela} where toc=0 order by id`);
  // for (var i = 1; i < rows.length; i++) {
  //   if (i == rows.length - 1) break;
  //   if (rows[i].hno != null && rows[i].hno == rows[i+1].hno) {
  //     var nextNass = Utils.escSQL(rows[i+1].nass);
  //     console.log(`concating id:${rows[i].id}:H${rows[i].hno} w/ id:${rows[i+1].id}:H${rows[i+1].hno}`);
  //     await global.query(`update ${shamela} set nass=concat(nass, '\\n${nextNass}') where id=${rows[i].id}`);
  //     await global.query(`delete from ${shamela} where id=${rows[i+1].id}`);
  //     i++;
  //     // break;
  //   }
  // }

  // // update headings with hadith starts
  // var rows = await global.query(`select * from ${shamela} order by id`);
  // var hno = null;
  // for (var i = 1; i < rows.length; i++) {
  //   if (rows[i].toc == 1 && rows[i].hno == null && rows[i+1].hno != null) {
  //     console.log(`updating w/ ${rows[i+1].hno} ${rows[i].nass}`);
  //     await global.query(`update ${shamela} set hno=${rows[i+1].hno} where id=${rows[i].id}`);
  //     // break;
  //   }
  // }

  // // update h1, h2 for all toc
  // var rows = await global.query(`select * from ${shamela} order by id`);
  // var h1 = null;
  // var h2 = 1;
  // for (var i = 1; i < rows.length; i++) {
  //   if (rows[i].toc == 1 && rows[i].level == 1 && rows[i].h1 != null) {
  //     h1 = rows[i].h1;
  //     h2 = 1;
  //   }  else if (rows[i].toc == 1 && rows[i].level == 2) {
  //     console.log(`updating w/ ${h1}:${h2} ${rows[i].nass}`);
  //     await global.query(`update ${shamela} set h1=${h1},h2=${h2++} where id=${rows[i].id}`);
  //     // break;
  //   }
  // }

  // var titles = await global.query(`select tit from ${shamela}_t`);
  // titles.map(function (val) {
  //   val.tit = Arabic.removeArabicDiacritics(Arabic.removeDelimeters(val.tit));
  // });
  // var rows = await global.query(`select id, nass_clean from ${shamela} order by id`);
  // // var reH = /(\d+ ?\/ ?\d+ ?-) ?(["«»])(.+)(["«»])?(\n|$)?/;
  // var reHNO = /((\d+) ?\/ ?(\d+) ?-?)/;
  // var n = 1;
  // var text = '';
  // var num = '';
  // for (var i = 0; i < rows.length; i++) {
  //   console.log(`% ${i / rows.length * 100}`);
  //   var lines = rows[i].nass_clean.split(/\n/g);
  //   for (var j = 0; j < lines.length; j++) {
  //     if (reHNO.test(lines[j])) {
  //       if (text.length > 0) {
  //         text = text.replace(reHNO, '');
  //         await global.query(`insert ignore into b_jami (id, num, text, source) values (${n++}, '${num}', '${Utils.escSQL(text)}', '${Utils.escSQL(rows[i].nass_clean)}')`);
  //       }
  //       var hno = reHNO.exec(lines[j]);
  //       num = hno[3] + '-' + hno[2];
  //       text = lines[j];
  //     } else {
  //       var lineClean = Arabic.removeArabicDiacritics(Arabic.removeDelimeters(lines[j]));
  //       if (!titles.find(function (val) {
  //         return lineClean.includes(val.tit);
  //       }))
  //         text += '\n' + lines[j];
  //     }
  //   }
  // }
  // await global.query(`insert ignore into b_jami (id, num, text, source) values (${n++}, '${num}', '${Utils.escSQL(text)}', '')`);

  console.log('done');

}
a_dbInitApp();

module.exports = app;

