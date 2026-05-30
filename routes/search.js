/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:search');
const express = require('express');
const createError = require('http-errors');
const crypto = require('crypto');
const fs = require('fs');
const fm = require('front-matter');
const ejs = require('ejs');
const Search = require('../lib/Search');
const Hadith = require('../lib/Hadith');
const HadithRevision = require('../lib/HadithRevision');
const Utils = require('../lib/Utils');
const { Section, Chapter, Heading, Item, Library, Record } = require('../lib/Model');
const Index = require('../lib/Index');
const Arabic = require('../lib/Arabic');
const { homedir } = require('os');

const router = express.Router();
const CAPTCHA_TTL_MS = 5 * 60 * 1000;

function captchaSecret() {
  return global.settings.captchaSecret || global.settings.admin.key;
}

function signCaptchaPayload(payload) {
  return crypto
    .createHmac('sha256', captchaSecret())
    .update(payload)
    .digest('base64url');
}

function createCaptchaToken(answer) {
  const payload = Buffer.from(JSON.stringify({
    answer: answer.toString(),
    exp: Date.now() + CAPTCHA_TTL_MS,
    nonce: crypto.randomBytes(12).toString('base64url')
  })).toString('base64url');
  return `${payload}.${signCaptchaPayload(payload)}`;
}

function verifyCaptchaToken(token, answer) {
  if (!token || answer === undefined || answer === null)
    return false;
  const parts = token.toString().split('.');
  if (parts.length !== 2)
    return false;
  const [payload, signature] = parts;
  const expected = signCaptchaPayload(payload);
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected))
    return false;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
    return false;
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (err) {
    return false;
  }
  if (!decoded || decoded.exp < Date.now())
    return false;
  return answer.toString().trim() === decoded.answer;
}

router.get('/captcha/translate', function (req, res) {
  const a = crypto.randomInt(2, 10);
  const b = crypto.randomInt(2, 10);
  res.json({
    question: `What is ${a} + ${b}?`,
    token: createCaptchaToken(a + b)
  });
});

router.post('/captcha/translate/verify', function (req, res) {
  if (!verifyCaptchaToken(req.body && req.body.captchaToken, req.body && req.body.captchaAnswer)) {
    res.status(403).json({
      code: 403,
      verified: false,
      message: 'Incorrect CAPTCHA answer.'
    });
    return;
  }
  res.json({
    code: 200,
    verified: true
  });
});

router.get('/autocomplete', async function (req, res, next) {
  try {
    var q = Search.truncateQuery(req.query.q || req.query.term || '');
    var bookFilters = req.query.b || req.query['b[]'];
    if (bookFilters && (typeof bookFilters) != 'object')
      bookFilters = [bookFilters];
    var suggestions = await Search.a_autocomplete(q, bookFilters, req.query.limit);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(suggestions));
  } catch (err) {
    var message = `Error fetching autocomplete suggestions [${req.query.q || req.query.term}]`;
    debug(message + `\n${err.stack}`);
    return next(createError(500, message));
  }
});

router.get('/reinit', async function (req, res, next) {
  await Hadith.a_reinit();
  res.write('Done');
  res.end();
  return;
});

router.all('/do/:id', async function (req, res, next) {
  try {
    if (req.query.cmd == 'tr') {
      var id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id < 1)
        return next(createError(400, 'Invalid hadith id'));

      var item = (await global.query(`SELECT * FROM v_hadiths WHERE hId=${id}`))[0];
      if (!item)
        return next(createError(404, `Hadith not found: ${id}`));

      if (Utils.isTruthy(item.body_en)) {
        res.json({
          code: 200,
          message: 'Translation already available',
          translated: true,
          revised: false,
          body_en: item.body_en,
          body_en_html: Utils.markdownToHtml(item.body_en)
        });
        return;
      }

      if (!verifyCaptchaToken(req.body && req.body.captchaToken, req.body && req.body.captchaAnswer)) {
        res.status(403).json({
          code: 403,
          captchaRequired: true,
          message: 'Please complete the CAPTCHA before translating.'
        });
        return;
      }

      await global.query(`UPDATE hadiths SET requested=(requested+1), lastfixed=CURRENT_TIMESTAMP() WHERE id=${id}`);
      var revised = await HadithRevision.reviseHadith(item);
      res.json({
        code: 200,
        message: 'Translation complete',
        translated: true,
        revised: true,
        body_en: revised.item.body_en,
        body_en_html: Utils.markdownToHtml(revised.item.body_en),
        chain_en: revised.item.chain_en,
        footnote_en: revised.item.footnote_en,
        footnote_en_html: Utils.markdownToHtml(revised.item.footnote_en),
        title_en: revised.item.title_en
      });
      return;
    } else if (req.query.cmd == 'comment') {
      // comment clicked
      var id = parseInt(req.params.id);
      await global.query(`UPDATE hadiths SET commented=(commented+1), lastfixed=CURRENT_TIMESTAMP() WHERE id=${id}`);
      console.log(`commented on id ${id}`);
    }
    res.sendStatus(204);
    res.end();
    return;
  } catch (err) {
    if (req.query.cmd == 'tr' && req.method === 'POST') {
      res.status(500).json({
        code: 500,
        message: err.message || 'Unable to translate hadith'
      });
      return;
    }
    var message = `Error in action [${req.params.id}?${req.query.action}]`;
    debug(message + `\n${err.stack}`);
    return next(createError(500, message));
  }
});

// SITEMAP
router.get('/sitemap\.txt', async function (req, res, next) {
  var txt = '';
  var domain = global.settings.site.url;
  res.setHeader('content-type', 'text/plain');
  txt += `${domain}\n`;
  txt += `${domain}/books\n`;
  txt += `${domain}/highlights\n`;
  txt += `${domain}/titled\n`;
  txt += `${domain}/commented\n`;
  txt += `${domain}/requests\n`;
  txt += `${domain}/blog\n`;
  const files = fs.readdirSync(global.settings.blog.dir);
  for (var file of files) {
    if (file.endsWith('.md')) {
      try {
        const { attributes } = fm(fs.readFileSync(`${global.settings.blog.dir}/${file}`).toString());
        txt += `${domain}/blog/${file.replace(/.md$/, '')}\n`;
      } catch (e) {
      }
    }
  }
  var results = await global.query(`
    select b.alias, null as h1, null as h2 from books b
    union
    select b.alias, t.h1, t.h2 from toc t, books b
    where t.bookId = b.id and t.level < 3
    union
    select concat(b.alias, ':', num) as alias, null h1, null as h2 from hadiths h, books b
    where h.bookId = b.id and h.title_en is not null
    -- union
    -- select distinct 'tag' as alias,t.text_en as h1, null as h2 from tags t, hadiths_tags ht
    -- where t.id = ht.tagId
    order by alias, h1, h2
  `);
  for (var i = 0; i < results.length; i++) {
    var alias = results[i].alias;
    var h1 = Utils.emptyIfNull(results[i].h1).toString().replace(/\.0+$/, '');
    var h2 = Utils.emptyIfNull(results[i].h2).toString();
    var url = `${domain}/${alias}${(h1 ? '/' + h1 : '')}${(h2 ? '/' + h2 : '')}\n`;
    txt += url;
  }
  res.end(txt);
  return;
});

// HOME (SEARCH OR SHOW RANDOM HADITH)
router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var results = [];
  var totalResults = 0;

  // search
  if (req.query.q) {
    req.query.q = Search.truncateQuery(req.query.q);
    // is it a item ref number?
    if (!Search.isExpressionQuery(req.query.q) && req.query.q.match(/^([a-z]+:\d+|\d+)/)) {
      if (Library.instance.findBook(req.query.q.split(/:/)[0])) {
        res.redirect('/' + req.query.q);
        return;
      }
    } else if (!Search.isExpressionQuery(req.query.q) && req.query.q.match(/^[a-z]+\//)) {
      if (Library.instance.findBook(req.query.q.split(/\//)[0])) {
        res.redirect('/' + req.query.q);
        return;
      }
    }
    try {
      if (req.query.b && (typeof req.query.b) != 'object')
        req.query.b = [req.query.b];
      var offset = req.query.o ? parseInt(req.query.o.toString()) : 0;
      offset = Math.floor(offset / global.settings.search.itemsPerPage) * global.settings.search.itemsPerPage;
      results = await Search.a_searchText(req.query.q, req.query.b, offset);
      totalResults = Number.isFinite(results.total) ? results.total : results.length;
      if (results.length > global.settings.search.itemsPerPage) {
        results.next = offset + global.settings.search.itemsPerPage;
        results.pop();
      }
      if (offset >= global.settings.search.itemsPerPage)
        results.prev = offset - global.settings.search.itemsPerPage;
      results.map(function (hadith) {
        if (hadith.chapter) {
          hadith.chapter.offset = Math.floor(hadith.numInChapter / global.settings.search.itemsPerPage) * global.settings.search.itemsPerPage;
          if (hadith.chapter.offset > 0)
            hadith.chapter.offset = '?o=' + hadith.chapter.offset;
          else
            hadith.chapter.offset = '';
        }
      });
    } catch (err) {
      var message = `Error searching [${req.query.q} ${req.query.b}]`;
      debug(message + `\n${err.stack}`);
      return next(createError(500, message));
    }

    if ('json' in req.query) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(results));
    } else if ('tsv' in req.query) {
      res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
      var keyNames = Object.keys(results[0]);
      if ('keys' in req.query)
        keyNames = req.query.keys.split(/,/);
      res.end(Utils.toTSV(results, keyNames));
    } else if ('md' in req.query) {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.end(Utils.toMarkdown(results));
    } else {
      res.render('search', {
        results: results,
        totalResults: totalResults,
        q: req.query.q,
        b: (req.query.b ? req.query.b : []),
        bookFilterLabels: Search.describeBookFilters(req.query.b),
      });
    }

    // show random and highlighted ahadith
  } else {
    // results = await Hadith.a_dbGetRecentUpdates(5);
    var random = await Index.docRandomnly(Item.INDEX, `books:/.+/`);
    if (random.length > 0) {
      random = new Item(random[0]);
      random.single = true;
      var admin = (req.cookies.admin == global.settings.admin.key);
      var editMode = (admin && req.cookies.editMode == 1);
      if (editMode)
        await addVirtualReferences([random]);
    }
    res.render('index', {
      random: random,
      results: null, // results,
      totalResults: 0,
      b: [],
    });
  }
});

// QURAN (RANGE)
router.get('/passage\::surah\::ayah1-:ayah2', async function (req, res, next) {
  return await a_getPassage(req.params.surah, req.params.ayah1, req.params.ayah2, req, res, next);
});

router.get('/passage\::surah\::ayah1', async function (req, res, next) {
  return await a_getPassage(req.params.surah, req.params.ayah1, req.params.ayah1, req, res, next)
});

async function a_getPassage(surah, ayah1, ayah2, req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  ayah1 = Arabic.toLatinDigits(ayah1);
  ayah2 = Arabic.toLatinDigits(ayah2);
  surah = global.surahs.find(function (value) {
    return (value.alias === surah || value.num == surah);
  });
  if (!surah)
    return next(createError(404, `Reference 'passage:${surah}:${ayah1}-${ayah2}' does not exist`));
  var selectedAyahs = await Index.docsFromQueryString(Item.INDEX, `book_alias:quran AND h1:${surah.num} AND numInChapter:[${ayah1} TO ${ayah2}]`, 0, ayah2 - ayah1 + 1, 'numInChapter');
  selectedAyahs = selectedAyahs.map(item => new Item(item));
  var results = selectedAyahs;
  var section;
  var chapter;
  var quranSubsections = [];
  if (selectedAyahs.length > 0) {
    section = await selectedAyahs[0].getSection();
    // await section.getPrev();
    // await section.getNext();
    chapter = await section.getChapter();
    await chapter.getPrev();
    await chapter.getNext();
    await chapter.getSections();
    section.prev = section.next = undefined;
    section.page = {
      offset: 0,
      number: 0
    };
  }
  if ('json' in req.query) {
    res.setHeader('Content-Type', 'application/json');
    if (selectedAyahs.length < 1)
      return res.end(JSON.stringify({}));
    var ayahs_en = [];
    var ayahs = [];
    var footnotes_en = [];
    var footnotes = [];
    for (var i = 0; i < selectedAyahs.length; i++) {
      if (i == 0)
        ayahs_en.push(selectedAyahs[i].num + ' ' + selectedAyahs[i].en.body);
      else
        ayahs_en.push(Utils.regexExtract(selectedAyahs[i].num, /\d+:(\d+)/) + ' ' + selectedAyahs[i].en.body);
      ayahs.push(selectedAyahs[i].ar.body + ' ۝ ');
      footnotes_en.push(Utils.regexExtract(selectedAyahs[i].num, /\d+:(\d+)'/) + ' ' + selectedAyahs[i].en.footnote);
      footnotes.push(Arabic.toArabicDigits(i) + ' ' + selectedAyahs[i].ar.footnote);
    }
    selectedAyahs[0].body_en = selectedAyahs[0].en.body = ayahs_en.join(' ').trim();
    selectedAyahs[0].body = selectedAyahs[0].ar.body = ayahs.join(' ').trim();
    selectedAyahs[0].footnote_en = selectedAyahs[0].en.footnote = footnotes_en.join('\n').trim();
    selectedAyahs[0].footnote = selectedAyahs[0].ar.footnote = footnotes.join('\n').trim();
    res.end(JSON.stringify(selectedAyahs[0]));
  } else if ('tsv' in req.query) {
    res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
    var keyNames = Object.keys(results[0]);
    if ('keys' in req.query)
      keyNames = req.query.keys.split(/,/);
    res.end(Utils.toTSV(results, keyNames));
  } else {

    var defaultPassage = req.query.passage != undefined || req.path.startsWith('/passage:') || req.params.bookAlias === 'quran';
    if (defaultPassage) {
      var containingSections = await getQuranSectionsForAyahRange(surah.num, ayah1, ayah2, selectedAyahs[0]);
      if (containingSections.length > 0) {
        section = containingSections[0];
        chapter = await section.getChapter();
        await chapter.getPrev();
        await chapter.getNext();
        await chapter.getSections();
        results = [];
        quranSubsections = [];
        for (const containingSection of containingSections) {
          results.push(...(await getQuranSectionPassageItems(containingSection, 0, 1000)));
          quranSubsections.push(...(await getQuranSectionSubsections(containingSection)));
        }
      }
      res.render('section_quran', {
        section: section,
        results: results,
        selectedAyah: (ayah1 == ayah2 && selectedAyahs.length > 0) ? selectedAyahs[0] : undefined,
        selectedAyahs: selectedAyahs,
        quranSubsections: quranSubsections
      });
    } else {
      res.render('section', {
        section: section,
        results: results
      });
    }

  }
}

// HADITH (SINGLE)
router.get('/:bookAlias\::num', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  req.params.num = Arabic.toLatinDigits(req.params.num);
  var quranBookAliasMatch = req.params.bookAlias.match(/^quran:(.+)$/);
  if (quranBookAliasMatch) {
    req.params.bookAlias = 'quran';
    req.params.num = `${quranBookAliasMatch[1]}:${req.params.num}`;
  }
  if (req.params.bookAlias === 'quran') {
    if (/\d+-\d+$/.test(req.params.num)) {
      var toks = req.params.num.split(/[:\-]/);
      return await a_getPassage(toks[0], toks[1], toks[2], req, res, next);
    } else {
      var toks = req.params.num.split(/:/);
      var surah = toks[0];
      var num = 1;
      if (toks.length > 1)
        num = toks[1];
      surah = global.surahs.find(function (value) {
        return (value.alias === surah || value.num == surah);
      });
      if (!surah)
        return next(createError(404, `Surah '${toks[0]}' not found`));
      req.params.num = `${surah.num}:${num}`;
    }
  } else {
    var book = global.books.find(function (value) {
      return value.alias === req.params.bookAlias;
    });
    if (await redirectVirtualHadithReference(book, req.params.num, req, res))
      return;
    if (!book) {
      var surah = global.surahs.find(function (value) {
        return (value.alias === req.params.bookAlias || value.num == req.params.bookAlias);
      });
      if (surah) {
        req.params.bookAlias = 'quran';
        req.params.num = `${surah.num}:${req.params.num}`;
      }
    }
  }
  var results = await Index.docsFromKeyValue(Item.INDEX, { ref: `${req.params.bookAlias}:${req.params.num}` });
  if (results.length == 0) {
    results = await Index.docsFromKeyValue(Item.INDEX, { ref: `${req.params.bookAlias}:${req.params.num}a` });
    if (results.length == 0)
      return next(createError(404, `Item ${req.params.bookAlias}:${req.params.num} not found`));
  }

  results = results.map(item => new Item(item));
  results[0].single = true;
  if (results[0].book_alias === 'quran'
    && !('json' in req.query)
    && !('tsv' in req.query)
    && !('md' in req.query)
    && req.query.ayat === undefined
    && req.query.sharepreview === undefined
    && req.query.share === undefined) {
    return await renderQuranAyahPassage(results[0], req, res);
  }
  var admin = (req.cookies.admin == global.settings.admin.key);
  var editMode = (admin && req.cookies.editMode == 1);
  if (editMode)
    await addVirtualReferences(results);
  for (var i = 0; i < results.length; i++) {
    results[i].similar = await Hadith.a_dbGetSimilarCandidates(new Item(results[i]));
    var bookSet = new Set();
    for (var j = 0; results[i].similar && j < results[i].similar.length; j++) {
      results[i].similar[j].parentId = results[i].id;
      var book = global.books.find(function (value) {
        return results[i].similar[j].bookId == value.id;
      });
      if (book) bookSet.add(book);
    }
    results[i].similarBooks = Array.from(bookSet);
    results[i].similarBooks.sort(function (book1, book2) {
      return book1.ordinal - book2.ordinal;
    });
  }
  if (results.length > 0) {
    if ('json' in req.query) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(results));
    } else if ('tsv' in req.query) {
      res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
      var keyNames = Object.keys(results[0]);
      if ('keys' in req.query)
        keyNames = req.query.keys.split(/,/);
      res.end(Utils.toTSV(results, keyNames));
    } else if ('md' in req.query) {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.end(Utils.toMarkdown(results));
    } else {
      if (req.query.sharepreview !== undefined || req.query.share !== undefined) {
        var cleanParams = [];
        Object.keys(req.query).forEach((key) => {
          if (key === 'sharepreview' || key === 'share')
            return;
          var values = Array.isArray(req.query[key]) ? req.query[key] : [req.query[key]];
          values.forEach((value) => {
            cleanParams.push(value === '' ? encodeURIComponent(key) : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
          });
        });
        var cleanQuery = cleanParams.join('&');
        var cleanUrl = req.path + (cleanQuery ? `?${cleanQuery}` : '');
        res.redirect(302, cleanUrl || `/${results[0].ref}`);
      } else {
        res.render('search', {
          results: results,
          book: results[0].book,
          q: req.query.q,
          b: [],
        });
      }
    }
  } else {
    res.render('search', {
      results: results,
      q: req.query.q,
      b: [],
    });
  }
});

async function renderQuranAyahPassage(selectedAyah, req, res) {
  var section = await getQuranSectionForAyah(selectedAyah);
  await section.getPrev();
  await section.getNext();
  var chapter = await section.getChapter();
  await chapter.getPrev();
  await chapter.getNext();
  await chapter.getSections();
  var results = await getQuranSectionPassageItems(section, 0, 1000);
  var quranSubsections = await getQuranSectionSubsections(section);

  res.render('section_quran', {
    section: section,
    results: results,
    selectedAyah: selectedAyah,
    selectedAyahs: [selectedAyah],
    quranSubsections: quranSubsections
  });
}

async function getQuranSectionForAyah(selectedAyah) {
  var ayah = parseInt(selectedAyah.numInChapter || (selectedAyah.num || '').toString().split(/:/).pop(), 10);
  var fallbackRef = `${selectedAyah.book_alias}/${selectedAyah.h1}/${selectedAyah.h2}`;
  if (!Number.isInteger(ayah))
    return await Section.sectionFromRef(fallbackRef);
  var rows = await global.query(`SELECT section.*
    FROM v_toc section
    WHERE section.book_alias='quran'
      AND section.level=2
      AND section.h1=${Number(selectedAyah.h1)}
      AND section.h2_start IS NOT NULL
      AND section.h2_count IS NOT NULL
      AND ${ayah} BETWEEN CAST(SUBSTRING_INDEX(section.h2_start, ':', -1) AS UNSIGNED)
        AND CAST(SUBSTRING_INDEX(section.h2_start, ':', -1) AS UNSIGNED) + section.h2_count - 1
    ORDER BY
      EXISTS (
        SELECT 1
        FROM v_toc subsection
        WHERE subsection.book_alias='quran'
          AND subsection.level=3
          AND subsection.h1=section.h1
          AND subsection.h2=section.h2
          AND subsection.h3_start IS NOT NULL
          AND subsection.h3_count IS NOT NULL
          AND ${ayah} BETWEEN CAST(SUBSTRING_INDEX(subsection.h3_start, ':', -1) AS UNSIGNED)
            AND CAST(SUBSTRING_INDEX(subsection.h3_start, ':', -1) AS UNSIGNED) + subsection.h3_count - 1
      ) DESC,
      (section.h2=${Number(selectedAyah.h2)}) DESC,
      section.h2
    LIMIT 1`);
  if (rows.length > 0)
    return Heading.toLevel(rows[0]);
  return await Section.sectionFromRef(fallbackRef);
}

async function getQuranSectionsForAyahRange(surah, ayah1, ayah2, fallbackAyah) {
  surah = Number(surah);
  ayah1 = Number(ayah1);
  ayah2 = Number(ayah2);
  if (!Number.isInteger(surah) || !Number.isInteger(ayah1) || !Number.isInteger(ayah2))
    return fallbackAyah ? [await getQuranSectionForAyah(fallbackAyah)] : [];
  var rows = await global.query(`SELECT section.*
    FROM v_toc section
    WHERE section.book_alias='quran'
      AND section.level=2
      AND section.h1=${surah}
      AND section.h2_start IS NOT NULL
      AND section.h2_count IS NOT NULL
      AND CAST(SUBSTRING_INDEX(section.h2_start, ':', -1) AS UNSIGNED) <= ${ayah2}
      AND CAST(SUBSTRING_INDEX(section.h2_start, ':', -1) AS UNSIGNED) + section.h2_count - 1 >= ${ayah1}
    ORDER BY section.h2`);
  if (rows.length > 0)
    return rows.map(row => Heading.toLevel(row));
  return fallbackAyah ? [await getQuranSectionForAyah(fallbackAyah)] : [];
}

async function getQuranSectionPassageItems(section, offset, size) {
  offset = Number.isInteger(parseInt(offset, 10)) ? parseInt(offset, 10) : 0;
  var startAyah = quranAyahFromHeadingStart(section.start);
  var count = parseInt(section.count, 10);
  if (!Number.isInteger(startAyah) || !Number.isInteger(count) || count < 1)
    return await section.getItems(offset, size);
  if (offset >= count)
    return [];
  if (!Number.isInteger(parseInt(size, 10)))
    size = count - offset;
  else
    size = Math.min(parseInt(size, 10), count - offset);
  section.page = {
    offset: offset,
    number: size > 0 ? (offset / size) + 1 : 1,
    hasNext: offset + size < count,
    prevOffset: Math.max(0, offset - size),
    nextOffset: offset + size,
    hasPrev: offset > 0
  };
  var queryStart = startAyah + offset;
  var queryEnd = startAyah + count - 1;
  var results = await Index.docsFromQueryString(
    Item.INDEX,
    `book_alias:quran AND h1:${Number(section.h1)} AND numInChapter:[${queryStart} TO ${queryEnd}]`,
    0,
    size,
    'numInChapter'
  );
  return results.map(item => new Item(item));
}

function quranAyahFromHeadingStart(start) {
  var parts = Utils.trimToEmpty(start).split(/:/);
  return parseInt(Arabic.toLatinDigits(parts[parts.length - 1] || ''), 10);
}

function shouldRedirectQuranSurahPath(req) {
  return req.query.json === undefined
    && req.query.tsv === undefined
    && req.query.md === undefined
    && req.query.download === undefined;
}

async function firstQuranSectionNumber(surah) {
  surah = Number(surah);
  if (!Number.isInteger(surah) || surah <= 0)
    return null;
  var rows = await global.query(`SELECT MIN(h2) AS h2
    FROM v_toc
    WHERE book_alias='quran' AND level=2 AND h1=${surah}`);
  var h2 = rows && rows[0] ? Number(rows[0].h2) : NaN;
  return Number.isInteger(h2) && h2 > 0 ? h2 : null;
}

async function getQuranSectionSubsections(section) {
  if (!section || section.book_alias !== 'quran' || parseInt(section.level, 10) !== 2)
    return [];
  var rows = await global.query(`SELECT * FROM v_toc
    WHERE book_alias='quran' AND level=3 AND h1=${Number(section.h1)} AND h2=${Number(section.h2)}
    ORDER BY ordinal, h3`);
  return rows.map(row => Heading.toLevel(row));
}

async function addVirtualReferences(items) {
  var ids = items
    .map(item => parseInt(item.actual ? item.actual.id : item.hId || item.id, 10))
    .filter(id => Number.isInteger(id));
  ids = Array.from(new Set(ids));
  if (ids.length < 1)
    return;

  var rows = await global.query(`
    SELECT DISTINCT
      hv.hadithId AS hId_ref,
      b.id AS book_id,
      b.alias AS book_alias,
      b.shortName_en AS book_shortName_en,
      hv.h1,
      ch.title_en AS h1_title_en,
      hv.h2,
      sec.title_en AS h2_title_en
    FROM hadiths_virtual hv
    JOIN books b ON b.id = hv.bookId
    LEFT JOIN toc ch ON ch.bookId = hv.bookId AND ch.level = 1 AND ch.h1 = hv.h1
    LEFT JOIN toc sec ON sec.bookId = hv.bookId AND sec.level = 2 AND sec.h1 = hv.h1 AND sec.h2 = hv.h2
    WHERE hv.hadithId IN (${ids.join(',')})
    ORDER BY b.id, hv.h1, hv.h2`);
  var refsByHadithId = new Map();
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var book = global.books.find(book => book.alias === row.book_alias);
    if (book && book.hidden == 1)
      continue;
    if (!refsByHadithId.has(row.hId_ref))
      refsByHadithId.set(row.hId_ref, []);
    refsByHadithId.get(row.hId_ref).push({
      book_alias: row.book_alias,
      book_shortName_en: row.book_shortName_en,
      h1: row.h1,
      h1_title_en: row.h1_title_en,
      h2: row.h2,
      h2_title_en: row.h2_title_en,
      path: buildVirtualReferencePath(row)
    });
  }

  for (var j = 0; j < items.length; j++) {
    var id = parseInt(items[j].actual ? items[j].actual.id : items[j].hId || items[j].id, 10);
    items[j].virtualReferences = refsByHadithId.get(id) || [];
  }
}

function buildVirtualReferencePath(row) {
  var parts = [row.book_alias, row.h1];
  if (row.h2)
    parts.push(row.h2);
  return parts.join('/');
}

async function redirectVirtualHadithReference(book, num, req, res) {
  if (!book || book.virtual != 1)
    return false;

  var candidateNums = [num];
  if (/^\d+(?:\.\d+)?$/.test(num))
    candidateNums.push(`${num}a`);
  else if (/^\d+(?:\.\d+)?[a-z]$/i.test(num))
    candidateNums.push(num.replace(/[a-z]$/i, ''));
  candidateNums = Array.from(new Set(candidateNums));

  var conditions = candidateNums.map(candidate => `hv.num='${Utils.escSQL(candidate)}'`);
  var num0 = Number(num);
  if (Number.isFinite(num0))
    conditions.push(`hv.num0=${num0}`);
  var orderConditions = candidateNums.map((candidate, idx) => `WHEN hv.num='${Utils.escSQL(candidate)}' THEN ${idx}`);

  var rows = await global.query(`
    SELECT b.alias AS book_alias, h.num
    FROM hadiths_virtual hv
    JOIN hadiths h ON h.id = hv.hadithId
    JOIN books b ON b.id = h.bookId
    WHERE hv.bookId=${book.id}
      AND (${conditions.join(' OR ')})
    ORDER BY CASE ${orderConditions.join(' ')} ELSE ${candidateNums.length} END, hv.num0, hv.id
    LIMIT 1`);
  if (rows.length < 1)
    return false;

  var queryIndex = req.originalUrl.indexOf('?');
  var queryString = queryIndex >= 0 ? req.originalUrl.substring(queryIndex) : '';
  res.redirect(302, `/${rows[0].book_alias}:${rows[0].num}${queryString}`);
  return true;
}

// BOOK: TABLE OF CONTENTS
router.get('/:bookAlias', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var books = global.books.filter(book => {
    return book.hidden == 0;
  });
  var book = books.find(function (value) {
    return (value.alias == req.params.bookAlias || value.id == req.params.bookAlias);
  });
  if (book) {
    var prevBook = null;
    var nextBook = null;
    var bookIdx = books.findIndex(function (value, index, arr) {
      return (value.id == book.id);
    });
    if (bookIdx > 0)
      prevBook = books[bookIdx - 1];
    if (bookIdx < (books.length - 1))
      nextBook = books[bookIdx + 1];

    var results;
    var random;
    if ('download' in req.query && 'tsv' in req.query) {
      debug(`downloading ${req.params.bookAlias}`);
      if (!book.virtual)
        results = await global.query(`SELECT * from v_hadiths WHERE book_id=${book.id} ORDER BY ordinal`);
      else
        results = await global.query(`SELECT * from v_hadiths_virtual WHERE book_id=${book.id} ORDER BY ordinal`);
    } else {
      results = await Library.instance.findBook(req.params.bookAlias).getChapters();
      if (!book.virtual)
        random = await Index.docRandomnly(Item.INDEX, `book_alias:${req.params.bookAlias}`);
      else
        random = await Index.docRandomnly(Item.INDEX, `books:"{${req.params.bookAlias}}"`);
      if (random && random.length > 0)
        random = new Item(random[0]);
    }

    if ('json' in req.query) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(results));
    } else if ('tsv' in req.query) {
      res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
      var keyNames = Object.keys(results[0]);
      if ('keys' in req.query)
        keyNames = req.query.keys.split(/,/);
      res.end(Utils.toTSV(results, keyNames));
    } else {
      res.render('toc', {
        book: book,
        prevBook: prevBook,
        nextBook: nextBook,
        toc: results,
        random: random
      });
    }
  } else
    return next(createError(404, `Book '${req.params.bookAlias}' does not exist`));
});

// BOOK: CHAPTER
router.get('/:bookAlias/:chapterNum', async function (req, res, next) {

  res.locals.req = req;
  res.locals.res = res;

  var admin = (req.cookies.admin == global.settings.admin.key);
  var editMode = (admin && req.cookies.editMode == 1);

  try {
    var results = [];
    var bookAlias = req.params.bookAlias;
    var chapterNum = Number(Arabic.toLatinDigits(req.params.chapterNum));
    var offset = req.query.o ? parseInt(req.query.o.toString()) : 0;
    if (bookAlias === 'quran' && shouldRedirectQuranSurahPath(req)) {
      var firstSectionNum = await firstQuranSectionNumber(chapterNum);
      if (firstSectionNum)
        return res.redirect(302, `/quran/${chapterNum}/${firstSectionNum}`);
    }

    var cachedFile = `${homedir}/.hadithdb/cache/${Utils.reqToFilename(req)}.html`;
    if ('flush' in req.query)
      Utils.flushCachedFile(cachedFile);
    if (!('flush' in req.query) && !admin && !editMode && fs.existsSync(cachedFile)) {
      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
      res.end(fs.readFileSync(cachedFile));
      return;
    }

    var chapter = await Chapter.chapterFromRef(`${bookAlias}/${chapterNum}`);
    await chapter.getPrev();
    await chapter.getNext();
    await chapter.getSections();
    results = await chapter.getItems(offset);

    if ('json' in req.query) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(results));
    } else if ('tsv' in req.query) {
      res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
      var keyNames = Object.keys(results[0]);
      if ('keys' in req.query)
        keyNames = req.query.keys.split(/,/);
      res.end(Utils.toTSV(results, keyNames));
    } else if ('md' in req.query) {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.end(Utils.toMarkdown(results));
    } else {

      if (bookAlias === 'quran' && req.query.passage != undefined) {
        // cache response
        var refs = [];
        for (const item of results)
          refs.push(item.ref);
        Utils.indexCachedItem(refs, cachedFile);
        var html = await ejs.renderFile(`${__dirname}/../views/section_quran.ejs`, {
          noadmin: true,
          chapter: chapter,
          section: chapter,
          results: results,
          req: req,
          res: res
        });
        fs.writeFileSync(cachedFile, html);

        res.render('section_quran', {
          chapter: chapter,
          section: chapter,
          results: results
        });
        return;
      }

      // cache response
      var refs = [];
      for (const item of results)
        refs.push(item.ref);
      Utils.indexCachedItem(refs, cachedFile);
      var html = await ejs.renderFile(`${__dirname}/../views/chapter.ejs`, {
        noadmin: true,
        chapter: chapter,
        results: results,
        req: req,
        res: res
      });
      fs.writeFileSync(cachedFile, html);

      res.render('chapter', {
        chapter: chapter,
        results: results
      });
    }

  } catch (e) {
    if (e instanceof ReferenceError)
      return next(createError(404, e.message));
    else {
      debug(e.stack);
      return next(createError(500, e.message));
    }
  }

});

// BOOK: SECTION
router.get('/:bookAlias/:chapterNum/:sectionNum', async function (req, res, next) {

  res.locals.req = req;
  res.locals.res = res;

  var admin = (req.cookies.admin == global.settings.admin.key);
  var editMode = (admin && req.cookies.editMode == 1);

  try {
    var results = [];
    var bookAlias = req.params.bookAlias;
    var chapterNum = Number(Arabic.toLatinDigits(req.params.chapterNum));
    var sectionNum = Number(Arabic.toLatinDigits(req.params.sectionNum));
    var offset = req.query.o ? parseInt(req.query.o.toString()) : 0;
    if (bookAlias !== 'quran' && req.query.passage != undefined) {
      delete req.query.passage;
      var urlParts = req.url.split('?');
      if (urlParts.length > 1) {
        var queryParams = new URLSearchParams(urlParts[1]);
        queryParams.delete('passage');
        var queryString = queryParams.toString();
        req.url = queryString ? `${urlParts[0]}?${queryString}` : urlParts[0];
      }
    }

    var cachedFile = `${homedir}/.hadithdb/cache/${Utils.reqToFilename(req)}.html`;
    if ('flush' in req.query)
      Utils.flushCachedFile(cachedFile);
    if (!('flush' in req.query) && !admin && !editMode && fs.existsSync(cachedFile)) {
      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
      res.end(fs.readFileSync(cachedFile));
      return;
    }

    var section = await Section.sectionFromRef(`${bookAlias}/${chapterNum}/${sectionNum}`);
    await section.getPrev();
    await section.getNext();
    var chapter = await section.getChapter();
    await chapter.getPrev();
    await chapter.getNext();
    await chapter.getSections();
    if (bookAlias === 'quran' && req.query.ayat == undefined)
      results = await getQuranSectionPassageItems(section, offset);
    else
      results = await section.getItems(offset);
    var quranSubsections = (bookAlias === 'quran' && req.query.ayat == undefined)
      ? await getQuranSectionSubsections(section)
      : [];
    if (results.length == 0) {
      var item = new Item(section);
      item.id = item.hId = undefined;
      results.push(item);
    }

    if (bookAlias === 'quran' && req.query.ayat == undefined) {

      // cache response
      var refs = [];
      for (const item of results)
        refs.push(item.ref);
      Utils.indexCachedItem(refs, cachedFile);
      var html = await ejs.renderFile(`${__dirname}/../views/section_quran.ejs`, {
        noadmin: true,
        section: section,
        results: results,
        quranSubsections: quranSubsections,
        req: req,
        res: res
      });
      fs.writeFileSync(cachedFile, html);

      res.render('section_quran', {
        section: section,
        results: results,
        quranSubsections: quranSubsections
      });
    } else {

      if ('json' in req.query) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(results));
      } else if ('tsv' in req.query) {
        res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
        var keyNames = Object.keys(results[0]);
        if ('keys' in req.query)
          keyNames = req.query.keys.split(/,/);
        res.end(Utils.toTSV(results, keyNames));
      } else if ('md' in req.query) {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.end(Utils.toMarkdown(results));
      } else {

        // cache response
        var refs = [];
        for (const item of results)
          refs.push(item.ref);
        Utils.indexCachedItem(refs, cachedFile);
        var html = await ejs.renderFile(`${__dirname}/../views/section.ejs`, {
          noadmin: true,
          section: section,
          results: results,
          req: req,
          res: res
        });
        fs.writeFileSync(cachedFile, html);

        res.render('section', {
          section: section,
          results: results
        });

      }

    }

  } catch (e) {
    if (e instanceof ReferenceError)
      return next(createError(404, e.message));
    else {
      debug(e.stack);
      return next(createError(500, e.message));
    }
  }

});

// BOOK: SECTION
router.get('/:bookAlias/:chapterNum/:sectionNum/:subsectionNum', async function (req, res, next) {
  var p = req.params;
  res.redirect(301, `/${p.bookAlias}/${p.chapterNum}/${p.sectionNum}#S${p.sectionNum}-${p.subsectionNum}`);
  return;
});

module.exports = router;
