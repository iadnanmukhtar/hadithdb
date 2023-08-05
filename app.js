/* jslint node:true, esversion:9 */
'use strict';

require('./lib/Globals');
const path = require('path');
const createError = require('http-errors');
const express = require('express');
const asyncify = require('express-asyncify').default;
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit').default;
const Hadith = require('./lib/Hadith');

const app = asyncify(express());

const limiter = rateLimit({
  keyGenerator: (request, response) => request.ip,
  standardHeaders: true,
  legacyHeaders: false,
  windowMs: 60000,
  max: 50,
});

(async () => {
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');

  app.use(express.json());
  app.use(cookieParser());
  app.use('/', express.static(path.join(__dirname, 'public')));
  app.use(limiter);

  const toolsRouter = require('./routes/tools');
  const recentRouter = require('./routes/recent');
  const requestsRouter = require('./routes/requests');
  const booksRouter = require('./routes/books');
  const tagRouter = require('./routes/tag');
  const searchRouter = require('./routes/search');
  const updateRouter = require('./routes/update');

  app.use('/tools', toolsRouter);
  app.use('/recent', recentRouter);
  app.use('/requests', requestsRouter);
  app.use('/books', booksRouter);
  app.use('/tag', tagRouter);
  app.use('/update', updateRouter);
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

  await Hadith.a_reinit();

  // // clean suyuti duplicated footnotes from body
  // var codes = [
  //   ['خ', 'البخاري', 'Bukhārī'],
  //   ['م', 'مسلم', 'Muslim'],
  //   ['حب', 'ابن حبّان', 'Ibn Ḥibbān'],
  //   ['ك', 'الحاكم في المستدرك', 'Ḥākim'],
  //   ['ض', 'ضياء المقدسي في مختاره', `Ḍ Maqdisī's Mukhtār`],
  //   ['د', 'أبو داود', 'Abū Dawūd'],
  //   ['ت', 'الترمذي', 'Tirmdhī'],
  //   ['ن', 'النسائي', 'Nasaʾī'],
  //   ['هـ', 'ابن ماجة', 'Ibn Mājah'],
  //   ['ط', 'الطيالسي', 'Ṭayālisī'],
  //   ['حم', 'أحمد', 'Aḥmad'],
  //   ['عم', 'زيادات عبد الله بن أحمد', `Ibn Aḥmad's Ziyadāt`],
  //   ['عب', 'عبد الرازق', 'ʿAbd al-Razzāq'],
  //   ['ص', 'سعيد بن منصور', 'Saʿīd b. Manṣūr'],
  //   ['ش', 'ابن أبى شيبة', 'Ibn Abū Shaybah'],
  //   ['ع', 'أبو يعلى', 'Abū Yaʿlá'],
  //   ['طب', 'الطبرانى في الكبير', `Ṭabarānī's Kabīr`],
  //   ['طك', 'الطبرانى في الكبير', `Ṭabarānī's Kabīr`],
  //   ['طس', 'الطبرانى في الأوسط', `Ṭabarānī's Awṣaṭ`],
  //   ['طص', 'الطبرانى في الصغير', `Ṭabarānī's Saghīr`],
  //   ['ز', 'البزّار في سننه', `Bazzār's Sunan`],
  //   ['بز', 'البزّار في سننه', `Bazzār's Sunan`],
  //   ['قط', 'الدارقطنى في السنن', 'Dārquṭnī'],
  //   ['حل', 'أبى نعيم في الحلية', `Abū Nuʿaym's Ḥīlah`],
  //   ['ق', 'البيهقى في السنن', `Bayhaqī Sunan`],
  //   ['هق', 'البيهقى في السنن', `Bayhaqī Sunan`],
  //   ['هب', 'البيهقى في شعب الإيمان', 'Bayhaqī Shuʿab'],
  //   ['عق', 'العقيلى في الضعفاء', `ʿUqaylī's Duʿafāʾ`],
  //   ['عد', 'ابن عدى في الكامل', `Ibn ʿAdī's Kāmil`],
  //   ['خط', 'الخطيب', 'Kaṭīb al-Baghdād¯ʼ'],
  //   ['كر', 'ابن عساكر في تاريخه', 'Ibn ʿAsākir'],
  //   ['فر', ' الديلمى في الفردوس', 'Daylamī'],
  //   ['خد', 'البخارى في الأدب المفرد', `Bukhārī's Adab`],
  //   ['تخ', 'البخارى في تاريخه', `Bukhārī's Tārīkh`]
  // ];
  // var rows = await global.query(`SELECT id, num, footnote FROM hadiths WHERE bookId=1000 order by ordinal`);
  // for (var i = 0; i < rows.length; i++) {
  //   var footnote = Utils.emptyIfNull(rows[i].footnote).trim();
  //   for (var j = 0; j < codes.length; j++) {
  //     var code = codes[j][0];
  //     var desc = codes[j][1];
  //     footnote = footnote.replace(new RegExp(`(^|[ \\.،\\-:"'\\(])${code}([ \\.،\\-:"'\\)]|$)`, 'g'), ` [${code}] ${desc} `)
  //       .replace(/ +/g, ' ');
  //     footnote = footnote.replace(/- رضي الله عنهما -/g, ' ');
  //     footnote = footnote.replace(/-رضي الله عنهما-/g, ' ');
  //     footnote = footnote.replace(/- رضي الله عنهم -/g, ' ');
  //     footnote = footnote.replace(/-رضي الله عنهم-/g, ' ');
  //     footnote = footnote.replace(/- رضي الله عنهن -/g, ' ');
  //     footnote = footnote.replace(/-رضي الله عنهن-/g, ' ');
  //     footnote = footnote.replace(/- رضي الله عنها -/g, ' ');
  //     footnote = footnote.replace(/-رضي الله عنها-/g, ' ');
  //     footnote = footnote.replace(/- رضي الله عنه -/g, ' ');
  //     footnote = footnote.replace(/-رضي الله عنه-/g, ' ');
  //     footnote = footnote.replace(/- صلى الله عليه وسلم -/g, ' ﷺ ');
  //     footnote = footnote.replace(/-صلى الله عليه وسلم-/g, ' ﷺ ');
  //     footnote = footnote.replace(/\. ?$/g, '').trim();
  //   }
  //   console.log(`cleaning ${rows[i].id} 1000:${rows[i].num}`);
  //   if (updateCnt > 0)
  //     updates += ` UNION ALL `;
  //   updates += ` (SELECT ${rows[i].id} AS id, '${Utils.escSQL(footnote)}' AS new_fn)`;
  //   updateCnt++;
  //   if (updateCnt > 1000) {
  //     console.log(`updating %${i / rows.length * 100} = ${i}/${rows.length}`);
  //     await global.query(`UPDATE hadiths h JOIN ( ${updates} ) vals ON h.id=vals.id SET footnote=new_fn`);
  //     updates = '';
  //     updateCnt = 0;
  //   }
  // }
  // if (updateCnt > 0) {
  //   console.log(`updating %${i / rows.length * 100} = ${i}/${rows.length}`);
  //   await global.query(`UPDATE hadiths h JOIN ( ${updates} ) vals ON h.id=vals.id SET footnote=new_fn`);
  //   updates = '';
  //   updateCnt = 0;
  // }

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
  // var hadiths = await global.query(`SELECT * FROM hadiths_virtual WHERE bookId = 49 ORDER BY h1,h2,h3,num0`);
  // var inserts = '';
  // var updateCnt = 0;
  // for (var i = 0; i < hadiths.length; i++) {
  //   if (hadiths[i].h1 != prevH1)
  //     numInChapter = 0;
  //   prevH1 = hadiths[i].h1;
  //   numInChapter++;
  //   console.log(`updating numInChapter for ${hadiths[i].bookId}:${hadiths[i].num}`);
  //   if (updateCnt > 0)
  //     inserts += ` UNION ALL `;
  //   inserts += ` SELECT ${hadiths[i].id} AS id, ${numInChapter} AS new`;
  //   if (updateCnt > 100) {
  //     await global.query(`UPDATE hadiths_virtual h JOIN ( ${inserts} ) vals ON h.id=vals.id SET numInChapter=new`);
  //     inserts = ``;
  //     updateCnt = 0;
  //   } else
  //     updateCnt++;
  // }
  // if (updateCnt > 0)
  //   await global.query(`UPDATE hadiths_virtual h JOIN ( ${inserts} ) vals ON h.id=vals.id SET numInChapter=new`);

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

  // // restore ALL db from search index
  // updateCnt = 0;
  // updates = '';
  // var docs = await global.searchIdx.ALL_DOCUMENTS(200000);
  // for (var i = 0; i < docs.length; i++) {
  //   var doc = docs[i]._doc;
  //   console.log(`restoring ${doc._id} ${doc.book_alias}:${doc.num}`);
  //   if (updateCnt > 0)
  //     updates += ` UNION ALL `;
  //   updates += ` (SELECT ${doc._id} AS id, '${Utils.escSQL(doc.chain)}' AS new_chain, '${Utils.escSQL(doc.body)}' AS new_body)`;
  //   updateCnt++;
  //   if (updateCnt > 1000) {
  //     console.log(`updating %${i/docs.length*100} = ${i}/${docs.length}`);
  //     await global.query(`UPDATE hadiths h JOIN ( ${updates} ) vals ON h.id=vals.id SET chain=new_chain, body=new_body`);
  //     updates = '';
  //     updateCnt = 0;
  //   }
  //   // break;
  // }
  // if (updateCnt > 0) {
  //   console.log(`updating %100`);
  //   await global.query(`UPDATE hadiths h JOIN ( ${updates} ) vals ON h.id=vals.id SET chain=new_chain, body=new_body`);
  //   updates = '';
  //   updateCnt = 0;
  // }

  // // restore body of specific ids to db from search index
  // var rows = await global.query(`
  //   select distinct h.id, b.alias, h.num, h.lastmod
  //   from hadiths h, books b
  //   where h.bookId=b.id and h.bookId > 0 and h.lastmod >= '2023-01-28 18:17:00' and h.lastmod <= '2023-01-28 18:17:50'
  //   order by lastmod desc;`);
  // console.log(`restoring ${rows.length} ahadith`);
  // for (var i = 0; i < rows.length; i++) {
  //   var docs = await global.searchIdx.QUERY({
  //     AND: [
  //       {
  //         FIELD: [ 'hId' ],
  //         VALUE: rows[i].id
  //       }
  //     ]
  //   }, { DOCUMENTS: true });
  //   if (docs.RESULT.length == 1) {
  //     var doc = docs.RESULT[0]._doc;
  //     console.log(`restoring ${doc._id} ${doc.book_alias}:${doc.num} ${(i/rows.length*100.).toFixed(2)}%`);
  //     await global.query(`UPDATE hadiths SET body='${Utils.escSQL(doc.body)}' WHERE id=${doc._id}`);
  //   } else {
  //     console.log(`${docs.RESULT.length} results found for book_alias:${rows[i].alias} num:${rows[i].num} ${(i/rows.length*100.).toFixed(2)}%`);
  //   }
  // }

  // // restore grader from search index
  // var docs = await global.searchIdx.ALL_DOCUMENTS(200000);
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
  // var docs = await global.searchIdx.ALL_DOCUMENTS(200000);
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

  // // update body startsWith
  // var startsWith = 'حَدَّثَهُ';
  // var rows = await global.query(`select * from hadiths where body regexp '^${startsWith} ' order by ordinal`);
  // for (var i = 1; i < rows.length; i++) {
  //   console.log(`updating ${startsWith} ${rows[i].bookId}:${rows[i].num}`);
  //   var body = rows[i].body.replace(new RegExp(`^${startsWith} `), '');
  //   var chain = rows[i].chain + ` ${startsWith}`;
  //   if (updateCnt > 0)
  //     updates += ` UNION ALL `;
  //   updates += ` (SELECT ${rows[i].id} AS id, '${Utils.escSQL(chain)}' AS new_chain, '${Utils.escSQL(body)}' AS new_body)`;
  //   updateCnt++;
  //   if (updateCnt > 1000) {
  //     console.log(`updating %${i/rows.length*100} = ${i}/${rows.length}`);
  //     await global.query(`UPDATE hadiths h JOIN ( ${updates} ) vals ON h.id=vals.id SET chain=new_chain, body=new_body`);
  //     updates = '';
  //     updateCnt = 0;
  //   }
  // }
  // if (updateCnt > 0) {
  //   console.log(`updating %100`);
  //   await global.query(`UPDATE hadiths h JOIN ( ${updates} ) vals ON h.id=vals.id SET chain=new_chain, body=new_body`);
  //   updates = '';
  //   updateCnt = 0;
  // }

  //  // fix  body startsWith qala Rasullah/Nabi
  //  var startsWith = 'قَالَ';
  //  var rows = await global.query(`select * from hadiths where chain regexp ' قَالَ$' and body regexp '^(النَّبِيُّ|رَسُولُ اللَّهِ) ' order by ordinal`);
  //  for (var i = 1; i < rows.length; i++) {
  //    console.log(`updating 'qala Rasullah' ${rows[i].bookId}:${rows[i].num}`);
  //    var body = startsWith + ' ' + rows[i].body;
  //    var chain = rows[i].chain.replace(new RegExp(` ${startsWith}$`), '');
  //    if (updateCnt > 0)
  //      updates += ` UNION ALL `;
  //    updates += ` (SELECT ${rows[i].id} AS id, '${Utils.escSQL(chain)}' AS new_chain, '${Utils.escSQL(body)}' AS new_body)`;
  //    updateCnt++;
  //    if (updateCnt > 1000) {
  //      console.log(`updating %${i/rows.length*100} = ${i}/${rows.length}`);
  //      await global.query(`UPDATE hadiths h JOIN ( ${updates} ) vals ON h.id=vals.id SET chain=new_chain, body=new_body`);
  //      updates = '';
  //      updateCnt = 0;
  //    }
  //  }
  //  if (updateCnt > 0) {
  //    console.log(`updating %100`);
  //    await global.query(`UPDATE hadiths h JOIN ( ${updates} ) vals ON h.id=vals.id SET chain=new_chain, body=new_body`);
  //    updates = '';
  //    updateCnt = 0;
  //  }

  //   var books = await global.query(`select * from books where id > 0 order by id`);
  //   for (var i = 0; i < books.length; i++) {
  //     var name_en = Arabic.removeLatinDiacritics(books[i].name_en);
  //     var name = Arabic.removeArabicDiacritics(books[i].name);
  //     var shortName_en = Arabic.removeLatinDiacritics(books[i].shortName_en);
  //     var shortName = Arabic.removeArabicDiacritics(books[i].shortName);
  //     var data =
  // `---
  // aliases:
  //   - ${shortName}
  //   - ${name}
  //   - ${name_en}
  //   - ${shortName_en}
  // ---
  // [[Ḥadīth]] [[${books[i].author}]]
  // `
  //     fs.writeFileSync('/Users/adnanmukhtar/Library/Mobile Documents/iCloud~md~obsidian/Documents/notes/Ḥadīth/' + books[i].shortName_en + '.md', data);
  //   }

  // // find similar hadith between two tables
  // var rows1 = await global.query(`select * from hadiths_malik order by id`);
  // var rows2 = await global.query(`select * from hadiths where bookId=7 order by h1, numInChapter`);
  // rows1.map(row => Hadith.disemvoweledHadith(row));
  // rows2.map(row => { row.body = ((row.chain || '').trim() + ' ' + (row.body || '')).trim() });
  // rows2.map(row => Hadith.disemvoweledHadith(row));
  // for (var i = 0; i < rows1.length; i++) {
  //   var matchedj = -1;
  //   var maxRating = -1;
  //   for (var j = 0; j < rows2.length; j++) {
  //     var rating = Hadith.findBestMatch(rows1[i], rows2[j]).bestMatch.rating;
  //     if (rating > maxRating) {
  //       maxRating = rating;
  //       matchedj = j;
  //     }
  //   }
  //   console.log(`updating ${rows1[i].num} with ${rows2[matchedj].num}`);
  //   await global.query(`update hadiths_malik set num_match="${rows2[matchedj].num}", match_rating=${maxRating} where id=${rows1[i].id}`);
  // }

  // var rows = await global.query(`select id, title, title_en from toc where bookId=5 order by h1,h2,h3`);
  // rows.forEach(row => {
  //   console.log(`${row.id}\t"${Utils.sql(row.title)}"\t"${Utils.sql(row.title_en)}"`);
  // });

  // // read from a TSV file and process rows
  // var tsv = fs.readFileSync(`${HomeDir}/Downloads/qt.tsv`).toString().split(/[\n\r]+/g);
  // var numInChapter = 0;
  // var prevTocId = -1;
  // for (var n = 0; n < tsv.length; n++) {
  //   var cols = tsv[n].split(/\t/g);
  //   var tocId = parseInt(cols[0])
  //   if (tocId != prevTocId)
  //     numInChapter = 1;
  //   else
  //     numInChapter++;
  //   prevTocId = tocId;
  //   var surah = parseInt(cols[1]);
  //   var ayah = parseInt(cols[2]);
  //   var len = parseInt(cols[3]);
  //   // console.log(`${tocId} ${surah}:${ayah}-${ayah + (len - 1)}`);
  //   for (var i = ayah; i <= (ayah + (len-1)); i++) {
  //     console.log(`${tocId} ${numInChapter}-quran:${surah}:${i}`);
  //     await global.query(`INSERT INTO hadiths_virtual
  //       (bookId, tocId, numInChapter, num, num0, ref_num) VALUES
  //       (49, ${tocId}, ${numInChapter}, "${surah}:${i}", ${surah + (i/1000.)}, 'quran:${surah}:${i}')`);
  //     numInChapter++;
  //   }
  // }

  // // read URLs to load
  // const cheerio = require('cheerio');
  // const http = require('sync-request');
  // var urls = fs.readFileSync(`./data/quranverses.txt`).toString().split(/[\n\r]+/g);
  // for (var n = 0; n < urls.length; n++) {
  //   var $ = cheerio.load(http('GET', urls[n]).getBody().toString());
  //   var headings = [];
  //   $('#breadcrumb a').each(function () {
  //     headings.push($(this).text());
  //   });
  //   headings.push($('#breadcrumb span').text());
  //   var ref_num = [];
  //   $('div.soura').each(function () {
  //     var heading = $(this).text().split(/[ -]/);
  //     var surah = heading[0];
  //     var title = heading[1] + ' ' + heading[2];
  //     ref_num.push({ title: title, ayahs: [] });
  //     var ayah = parseInt(heading[3]);
  //     var ayah2 = (heading.length > 4) ? parseInt(heading[4]) : ayah;
  //     for (; ayah <= ayah2; ayah++) {
  //       ref_num[ref_num.length-1].ayahs.push({ surah: surah, ayah: ayah });
  //     }
  //   });
  //   var sql = `INSERT INTO toc (bookId,level,h1,h2,h3,title,start,start0) VALUES
  //     (49, 1, null, null, '${headings[1]} > ${headings[2]}', '${ref_num[0].ayahs[0].surah}:${ref_num[0].ayahs[0].ayah}', ${ref_num[0].ayahs[0].surah + ref_num[0].ayahs[0].ayah/1000.})`;
  //   sql = `INSERT INTO toc (bookId,level,h1,h2,h3,title,start,start0) VALUES
  //     (49, 2, null, null, '${headings[1]} > ${headings[2]}', '${ref_num[0].ayahs[0].surah}:${ref_num[0].ayahs[0].ayah}', ${ref_num[0].ayahs[0].surah + ref_num[0].ayahs[0].ayah/1000.})`;
  //   Utils.msleep(500);
  // }

  console.error('done');

})();

module.exports = app;

