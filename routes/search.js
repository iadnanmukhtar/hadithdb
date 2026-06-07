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
const Books = require('../lib/Books');
const Surahs = require('../lib/Surahs');
const QuranCorpus = require('../lib/QuranCorpus');
const { homedir } = require('os');

const router = express.Router();
const CAPTCHA_TTL_MS = 5 * 60 * 1000;
function redirectArabicDigitPath(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return next();

  var path = req.path;
  try {
    path = decodeURI(path);
  } catch (err) {
    path = req.path;
  }
  if (/^\/(?!passage:)[^/]+:/.test(path))
    return next();

  var normalizedPath = Arabic.toLatinDigits(path);
  if (normalizedPath === path)
    return next();

  return res.redirect(301, `${normalizedPath}${appendOriginalQuery(req)}`);
}

function findSurah(ref) {
  return Surahs.find(ref);
}

function appendOriginalQuery(req) {
  var queryIndex = req.originalUrl.indexOf('?');
  return queryIndex >= 0 ? req.originalUrl.substring(queryIndex) : '';
}

function sendCachedHtml(req, res, cachedFile) {
  res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  res.end(Utils.injectCachedAdminControls(fs.readFileSync(cachedFile), req));
}

function redirectCanonicalReferencePath(req, res, canonicalPath) {
  if (req.path === canonicalPath)
    return false;
  var redirectPath = (!Utils.isLocalhostRequest(req) && Utils.isQuranUrlPath(canonicalPath))
    ? Utils.quranUrl(req, canonicalPath)
    : canonicalPath;
  res.redirect(301, `${redirectPath}${appendOriginalQuery(req)}`);
  return true;
}

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

router.get(['/captcha/translate', '/quran/captcha/translate'], function (req, res) {
  const a = crypto.randomInt(2, 10);
  const b = crypto.randomInt(2, 10);
  res.json({
    question: `What is ${a} + ${b}?`,
    token: createCaptchaToken(a + b)
  });
});

router.post(['/captcha/translate/verify', '/quran/captcha/translate/verify'], function (req, res) {
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

router.use(redirectArabicDigitPath);

router.get(['/autocomplete', '/quran/autocomplete'], async function (req, res, next) {
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

router.all(['/do/:id', '/quran/do/:id'], async function (req, res, next) {
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
      // Legacy endpoint retained for older clients. Comment counts are updated when comments are saved.
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
  var quranDomain = Utils.quranBaseUrl();
  var quranOnly = Utils.isQuranSubdomainRequest(req);
  var bookSitemapFilter = quranOnly ? `= 'quran'` : `<> 'quran'`;
  var sitemapUrl = function (alias, h1, h2) {
    if (alias === 'quran')
      return `${quranDomain}/quran${(h1 ? '/' + h1 : '')}${(h2 ? '/' + h2 : '')}\n`;
    if (alias.indexOf('quran:') === 0)
      return `${quranDomain}/${alias}\n`;
    return `${domain}/${alias}${(h1 ? '/' + h1 : '')}${(h2 ? '/' + h2 : '')}\n`;
  };
  res.setHeader('content-type', 'text/plain');
  if (!quranOnly) {
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
  }
  var results = await global.query(`
    select b.alias, null as h1, null as h2 from books b
    where b.alias ${bookSitemapFilter}
    union
    select b.alias, t.h1, t.h2 from toc t, books b
    where t.bookId = b.id and t.level < 3 and b.alias ${bookSitemapFilter}
    union
    select concat(b.alias, ':', num) as alias, null h1, null as h2 from hadiths h, books b
    where h.bookId = b.id and h.title_en is not null and b.alias ${bookSitemapFilter}
    -- union
    -- select distinct 'tag' as alias,t.text_en as h1, null as h2 from tags t, hadiths_tags ht
    -- where t.id = ht.tagId
    order by alias, h1, h2
  `);
  for (var i = 0; i < results.length; i++) {
    var alias = results[i].alias;
    var h1 = Utils.emptyIfNull(results[i].h1).toString().replace(/\.0+$/, '');
    var h2 = Utils.emptyIfNull(results[i].h2).toString();
    txt += sitemapUrl(alias, h1, h2);
  }
  res.end(txt);
  return;
});

function normalizeRequestBookFilters(req) {
  if (!req.query.b)
    return [];
  var filters = Array.isArray(req.query.b) ? req.query.b : [req.query.b];
  filters = filters.flatMap(filter => filter.toString().split(','));
  filters = Array.from(new Set(filters.map(filter => filter.trim()).filter(Boolean)));
  req.query.b = filters;
  return filters;
}

async function renderSearchResults(req, res, next, options = {}) {
  var results = [];
  var totalResults = 0;

  req.query.q = Search.truncateQuery(req.query.q);
  if (options.defaultBookFilters && !req.query.b)
    req.query.b = options.defaultBookFilters.slice();
  if (options.forceBookFilters)
    req.query.b = options.forceBookFilters.slice();

  if (options.redirectReferences !== false) {
    var bookReference = !Search.isExpressionQuery(req.query.q) && Books.findReference(req.query.q, global.books);
    if (bookReference) {
      res.redirect('/' + bookReference.ref);
      return true;
    }
    // is it a item ref number?
    if (!Search.isExpressionQuery(req.query.q) && req.query.q.match(/^([a-z]+:\d+|\d+)/)) {
      if (Library.instance.findBook(req.query.q.split(/:/)[0])) {
        res.redirect('/' + req.query.q);
        return true;
      }
    } else if (!Search.isExpressionQuery(req.query.q) && req.query.q.match(/^[a-z]+\//)) {
      if (Library.instance.findBook(req.query.q.split(/\//)[0])) {
        res.redirect('/' + req.query.q);
        return true;
      }
    }
  }

  try {
    normalizeRequestBookFilters(req);
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
    var keyNames = Object.keys(results[0] || {});
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
      searchAction: options.searchAction || '/',
      quranSearchProxy: options.quranSearchProxy || false,
    });
  }
  return true;
}

// HOME (SEARCH OR SHOW RANDOM HADITH)
router.get('/', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;

  // search
  if (req.query.q) {
    return await renderSearchResults(req, res, next);

    // show random and highlighted ahadith
  } else {
    // results = await Hadith.a_dbGetRecentUpdates(5);
    var random = await Index.docRandomnly(Item.INDEX, `books:/.+/`);
    if (random.length > 0) {
      random = new Item(random[0]);
      random.single = true;
      var admin = (req.admin);
      var editMode = (admin && req.editMode);
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

function setQuranCorpusCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Origin, X-Requested-With, Content-Type, Accept');
}

router.use(['/quran/corpus', '/quran-corpus'], function (req, res, next) {
  setQuranCorpusCorsHeaders(res);
  if (req.method === 'OPTIONS')
    return res.sendStatus(204);
  next();
});

router.get(['/quran/corpus/:surah/:sectionNum', '/quran-corpus/:surah/:sectionNum'], async function (req, res, next) {
  var surah = findSurah(req.params.surah);
  if (!surah)
    return next(createError(404, `Surah '${req.params.surah}' not found`));
  var sectionNum = Number(Arabic.toLatinDigits(req.params.sectionNum));
  if (!Number.isInteger(sectionNum))
    return next(createError(400, `Invalid Quran section '${req.params.sectionNum}'`));
  var section = await Section.sectionFromRef(`quran/${surah.num}/${sectionNum}`);
  var range = await getQuranHeadingAyahRange(section);
  if (!range)
    return next(createError(404, `Quran section ${surah.num}/${sectionNum} has no ayah range`));
  var startAyah = range.startAyah;
  var endAyah = startAyah + range.count - 1;
  var rows = await QuranCorpus.wordsForRange(surah.num, startAyah, endAyah);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.end(JSON.stringify({
    surah: surah.num,
    h2: sectionNum,
    startAyah: startAyah,
    endAyah: endAyah,
    wordsByAyah: QuranCorpus.wordsByAyah(rows)
  }));
});

async function a_getPassage(surah, ayah1, ayah2, req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  ayah1 = Arabic.toLatinDigits(ayah1);
  ayah2 = Arabic.toLatinDigits(ayah2);
  surah = findSurah(surah);
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
    if (selectedAyahs.length === 1)
      await addQuranAdjacentRefs(selectedAyahs[0]);
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
      return res.end(JSON.stringify([]));
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
    res.end(JSON.stringify([selectedAyahs[0]]));
  } else if ('tsv' in req.query) {
    res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
    var keyNames = Object.keys(results[0]);
    if ('keys' in req.query)
      keyNames = req.query.keys.split(/,/);
    res.end(Utils.toTSV(results, keyNames));
  } else {

    var defaultPassage = req.query.passage != undefined || req.path.startsWith('/passage:') || req.params.bookAlias === 'quran';
    if (defaultPassage) {
      var quranSurahs = await getQuranSurahsFromIndex();
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
          var containingSubsections = await getQuranSectionSubsections(containingSection);
          quranSubsections.push(...containingSubsections);
          results.push(...(await getQuranSectionPassageItems(containingSection, 0, 1000)));
        }
        await addQuranPassageBoundaryRefs(results);
      }
      res.render('section_quran', {
        section: section,
        results: results,
        selectedAyah: (ayah1 == ayah2 && selectedAyahs.length > 0) ? selectedAyahs[0] : undefined,
        selectedAyahs: selectedAyahs,
        quranSubsections: quranSubsections,
        quranSurahs: quranSurahs
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
  var originalNum = req.params.num;
  req.params.num = Arabic.toLatinDigits(req.params.num);
  var quranBookAliasMatch = req.params.bookAlias.match(/^quran:(.+)$/);
  if (quranBookAliasMatch) {
    req.params.bookAlias = 'quran';
    req.params.num = Arabic.toLatinDigits(`${quranBookAliasMatch[1]}:${req.params.num}`);
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
      surah = findSurah(surah);
      if (!surah)
        return next(createError(404, `Surah '${toks[0]}' not found`));
      if (redirectCanonicalReferencePath(req, res, `/quran:${surah.num}:${num}`))
        return;
      req.params.num = `${surah.num}:${num}`;
    }
  } else {
    if (originalNum !== req.params.num)
      return res.redirect(301, `/${req.params.bookAlias}:${req.params.num}${appendOriginalQuery(req)}`);
    var book = global.books.find(function (value) {
      return value.alias === req.params.bookAlias;
    });
    if (await redirectVirtualHadithReference(book, req.params.num, req, res))
      return;
    if (!book) {
      var surah = findSurah(req.params.bookAlias);
      if (surah) {
        return redirectCanonicalReferencePath(req, res, `/quran:${surah.num}:${req.params.num}`);
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
  if (results[0].book_alias === 'quran')
    await addQuranAdjacentRefs(results[0]);
  if (results[0].book_alias === 'quran'
    && !('json' in req.query)
    && !('tsv' in req.query)
    && !('md' in req.query)
    && req.query.ayat === undefined
    && req.query.sharepreview === undefined
    && req.query.share === undefined) {
    return await renderQuranAyahPassage(results[0], req, res);
  }
  var admin = (req.admin);
  var editMode = (admin && req.editMode);
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
  await addQuranAdjacentRefs(selectedAyah);
  var chapter = await section.getChapter();
  await Promise.all([
    section.getPrev(),
    section.getNext(),
    chapter.getPrev(),
    chapter.getNext(),
    chapter.getSections()
  ]);
  var quranSubsections = await getQuranSectionSubsections(section);
  var results = await getQuranSectionPassageItems(section, 0, 1000);
  await addQuranPassageBoundaryRefs(results);
  var quranSurahs = await getQuranSurahsFromIndex();

  res.render('section_quran', {
    section: section,
    results: results,
    selectedAyah: selectedAyah,
    selectedAyahs: [selectedAyah],
    quranSubsections: quranSubsections,
    quranSurahs: quranSurahs
  });
}

async function addQuranAdjacentRefs(selectedAyah) {
  if (!selectedAyah || selectedAyah.book_alias !== 'quran')
    return;
  selectedAyah.prev_ref = await getQuranAdjacentRef(selectedAyah, -1);
  selectedAyah.next_ref = await getQuranAdjacentRef(selectedAyah, 1);
}

async function addQuranPassageBoundaryRefs(results) {
  if (!results || results.length < 1)
    return;
  var first = results[0];
  var last = results[results.length - 1];
  if (first) {
    var prevRef = await getQuranAdjacentRef(first, -1);
    if (prevRef)
      first.prev_ref = prevRef;
  }
  if (last) {
    var nextRef = await getQuranAdjacentRef(last, 1);
    if (nextRef)
      last.next_ref = nextRef;
  }
}

async function getQuranAdjacentRef(selectedAyah, step) {
  var surahNum = parseInt(selectedAyah.h1 || (selectedAyah.num || '').toString().split(/:/)[0], 10);
  var ayahNum = parseInt(selectedAyah.numInChapter || (selectedAyah.num || '').toString().split(/:/).pop(), 10);
  if (!Number.isInteger(surahNum) || !Number.isInteger(ayahNum) || ayahNum < 1)
    return undefined;
  var firstSurah = global.surahs.find(item => Number(item.num) === 1);
  var lastSurah = global.surahs.find(item => Number(item.num) === 114);
  if (!firstSurah || !lastSurah)
    return undefined;
  var targetSurahNum = surahNum;
  var targetAyahNum = ayahNum + step;
  if (targetAyahNum < 1) {
    var prevSurah = global.surahs.find(item => Number(item.num) === surahNum - 1);
    if (!prevSurah)
      prevSurah = lastSurah;
    targetSurahNum = Number(prevSurah.num);
    targetAyahNum = Number(prevSurah.ayahs);
  } else {
    var surah = global.surahs.find(item => Number(item.num) === surahNum);
    if (surah && targetAyahNum > Number(surah.ayahs)) {
      var nextSurah = global.surahs.find(item => Number(item.num) === surahNum + 1);
      if (!nextSurah)
        nextSurah = firstSurah;
      targetSurahNum = Number(nextSurah.num);
      targetAyahNum = 1;
    }
  }
  return `quran:${targetSurahNum}:${targetAyahNum}`;
}

async function getQuranSectionForAyah(selectedAyah) {
  var ayah = parseInt(selectedAyah.numInChapter || (selectedAyah.num || '').toString().split(/:/).pop(), 10);
  var fallbackRef = `${selectedAyah.book_alias}/${selectedAyah.h1}/${selectedAyah.h2}`;
  if (!Number.isInteger(ayah))
    return await Section.sectionFromRef(fallbackRef);
  var indexedSection = await getQuranSectionForAyahFromIndex(selectedAyah, ayah);
  if (indexedSection)
    return indexedSection;
  var rows = await global.query(`SELECT section.*
    FROM v_toc section
    WHERE section.book_alias='quran'
      AND section.level=2
      AND section.h1=${Number(selectedAyah.h1)}
      AND section.h2_start IS NOT NULL
      AND section.h2_count IS NOT NULL
      AND (
        ${ayah} BETWEEN CAST(SUBSTRING_INDEX(section.h2_start, ':', -1) AS UNSIGNED)
          AND CAST(SUBSTRING_INDEX(section.h2_start, ':', -1) AS UNSIGNED) + section.h2_count - 1
        OR EXISTS (
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
        )
      )
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
  var indexedSections = await getQuranSectionsForAyahRangeFromIndex(surah, ayah1, ayah2);
  if (indexedSections.length > 0)
    return indexedSections;
  var rows = await global.query(`SELECT section.*
    FROM v_toc section
    WHERE section.book_alias='quran'
      AND section.level=2
      AND section.h1=${surah}
      AND section.h2_start IS NOT NULL
      AND section.h2_count IS NOT NULL
      AND (
        (
          CAST(SUBSTRING_INDEX(section.h2_start, ':', -1) AS UNSIGNED) <= ${ayah2}
          AND CAST(SUBSTRING_INDEX(section.h2_start, ':', -1) AS UNSIGNED) + section.h2_count - 1 >= ${ayah1}
        )
        OR EXISTS (
          SELECT 1
          FROM v_toc subsection
          WHERE subsection.book_alias='quran'
            AND subsection.level=3
            AND subsection.h1=section.h1
            AND subsection.h2=section.h2
            AND subsection.h3_start IS NOT NULL
            AND subsection.h3_count IS NOT NULL
            AND CAST(SUBSTRING_INDEX(subsection.h3_start, ':', -1) AS UNSIGNED) <= ${ayah2}
            AND CAST(SUBSTRING_INDEX(subsection.h3_start, ':', -1) AS UNSIGNED) + subsection.h3_count - 1 >= ${ayah1}
        )
      )
    ORDER BY section.h2`);
  if (rows.length > 0)
    return rows.map(row => Heading.toLevel(row));
  return fallbackAyah ? [await getQuranSectionForAyah(fallbackAyah)] : [];
}

async function getQuranSectionForAyahFromIndex(selectedAyah, ayah) {
  var surah = Number(selectedAyah.h1);
  if (!Number.isInteger(surah) || !Number.isInteger(ayah))
    return null;
  var headings = await getQuranSurahRangeHeadingsFromIndex(surah);
  if (!headings)
    return null;
  var matches = matchingQuranSectionsForRange(headings, ayah, ayah);
  if (matches.length < 1)
    return null;
  matches.sort((a, b) => {
    if (a.subsectionMatch !== b.subsectionMatch)
      return a.subsectionMatch ? -1 : 1;
    if (Number(a.section.h2) === Number(selectedAyah.h2) && Number(b.section.h2) !== Number(selectedAyah.h2))
      return -1;
    if (Number(b.section.h2) === Number(selectedAyah.h2) && Number(a.section.h2) !== Number(selectedAyah.h2))
      return 1;
    return Number(a.section.h2) - Number(b.section.h2);
  });
  return matches[0].section;
}

async function getQuranSectionsForAyahRangeFromIndex(surah, ayah1, ayah2) {
  var headings = await getQuranSurahRangeHeadingsFromIndex(surah);
  if (!headings)
    return [];
  return matchingQuranSectionsForRange(headings, ayah1, ayah2)
    .sort((a, b) => Number(a.section.h2) - Number(b.section.h2))
    .map(match => match.section);
}

async function getQuranSurahRangeHeadingsFromIndex(surah) {
  try {
    var docs = await Index.docsFromQuery(Heading.INDEX, {
      bool: {
        filter: [
          { term: { book_alias: 'quran' } },
          { term: { h1: surah } },
          { terms: { level: [2, 3] } }
        ]
      }
    }, 0, 1000, 'level,h2,h3,ordinal');
    var headings = docs.map(doc => Heading.toLevel(doc));
    return {
      sections: headings.filter(heading => Number(heading.level) === 2),
      subsections: headings.filter(heading => Number(heading.level) === 3)
    };
  } catch (err) {
    debug(`Quran heading index lookup failed for surah ${surah}: ${err.message}`);
    return null;
  }
}

async function getQuranSurahsFromIndex() {
  try {
    var docs = await Index.docsFromQuery(Heading.INDEX, {
      bool: {
        filter: [
          { term: { book_alias: 'quran' } },
          { term: { level: 1 } }
        ]
      }
    }, 0, 200, 'ordinal');
    return docs
      .map(doc => Heading.toLevel(doc))
      .map(heading => {
        var fallback = findSurah(heading.h1);
        return {
          num: Number(heading.h1),
          name_en: fallback?.name_en || heading.title_en || '',
          name_ar: fallback?.name_ar || heading.title || '',
          ayahs: Number(fallback?.ayahs)
        };
      })
      .filter(surah => Number.isInteger(surah.num))
      .sort((a, b) => a.num - b.num);
  } catch (err) {
    debug(`Quran surah index lookup failed: ${err.message}`);
    return (global.surahs || []).map(surah => ({
      num: Number(surah.num),
      name_en: surah.name_en,
      name_ar: surah.name_ar,
      ayahs: Number(surah.ayahs)
    }));
  }
}

function matchingQuranSectionsForRange(headings, ayah1, ayah2) {
  var sections = headings.sections || [];
  var subsections = headings.subsections || [];
  var subsectionsByH2 = new Map();
  subsections.forEach(subsection => {
    var h2 = Number(subsection.h2);
    if (!subsectionsByH2.has(h2))
      subsectionsByH2.set(h2, []);
    subsectionsByH2.get(h2).push(subsection);
  });
  return sections
    .map(section => {
      var sectionSubsections = subsectionsByH2.get(Number(section.h2)) || [];
      var sectionMatch = quranHeadingOverlapsAyahRange(section, ayah1, ayah2);
      var subsectionMatch = sectionSubsections.some(subsection => quranHeadingOverlapsAyahRange(subsection, ayah1, ayah2));
      if (!sectionMatch && !subsectionMatch)
        return null;
      section.quranSubsections = sectionSubsections.sort((a, b) => Number(a.ordinal) - Number(b.ordinal) || Number(a.h3) - Number(b.h3));
      return {
        section: section,
        subsectionMatch: subsectionMatch
      };
    })
    .filter(Boolean);
}

function quranHeadingOverlapsAyahRange(heading, ayah1, ayah2) {
  var startAyah = quranAyahFromHeadingStart(heading.start);
  var count = parseInt(heading.count, 10);
  if (!Number.isInteger(startAyah) || !Number.isInteger(count) || count < 1)
    return false;
  var endAyah = startAyah + count - 1;
  return startAyah <= ayah2 && endAyah >= ayah1;
}

async function getQuranSectionPassageItems(section, offset, size) {
  offset = Number.isInteger(parseInt(offset, 10)) ? parseInt(offset, 10) : 0;
  var range = await getQuranHeadingAyahRange(section);
  if (!range)
    return await section.getItems(offset, size);
  var startAyah = range.startAyah;
  var count = range.count;
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
  results = results.map(item => new Item(item));
  return results;
}

async function getQuranHeadingAyahRange(section) {
  var startAyah = quranAyahFromHeadingStart(section.start);
  var count = parseInt(section.count, 10);
  var endAyah = Number.isInteger(startAyah) && Number.isInteger(count) && count > 0
    ? startAyah + count - 1
    : null;

  if (section && section.book_alias === 'quran' && parseInt(section.level, 10) === 2) {
    var rows = Array.isArray(section.quranSubsections)
      ? section.quranSubsections
      : await getQuranSectionSubsections(section);
    for (const row of rows) {
      var subsectionStart = quranAyahFromHeadingStart(row.start);
      var subsectionCount = parseInt(row.count, 10);
      if (!Number.isInteger(subsectionStart) || !Number.isInteger(subsectionCount) || subsectionCount < 1)
        continue;
      var subsectionEnd = subsectionStart + subsectionCount - 1;
      startAyah = Number.isInteger(startAyah) ? Math.min(startAyah, subsectionStart) : subsectionStart;
      endAyah = Number.isInteger(endAyah) ? Math.max(endAyah, subsectionEnd) : subsectionEnd;
    }
  }

  if (!Number.isInteger(startAyah) || !Number.isInteger(endAyah) || endAyah < startAyah)
    return null;
  return {
    startAyah: startAyah,
    count: endAyah - startAyah + 1
  };
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
  var headings = await getQuranSurahRangeHeadingsFromIndex(surah);
  if (headings && headings.sections.length > 0) {
    var firstSection = headings.sections
      .filter(section => Number.isInteger(Number(section.h2)))
      .sort((a, b) => Number(a.ordinal) - Number(b.ordinal) || Number(a.h2) - Number(b.h2))[0];
    if (firstSection)
      return Number(firstSection.h2);
  }
  var rows = await global.query(`SELECT MIN(h2) AS h2
    FROM v_toc
    WHERE book_alias='quran' AND level=2 AND h1=${surah}`);
  var h2 = rows && rows[0] ? Number(rows[0].h2) : NaN;
  return Number.isInteger(h2) && h2 > 0 ? h2 : null;
}

async function getQuranSectionSubsections(section) {
  if (!section || section.book_alias !== 'quran' || parseInt(section.level, 10) !== 2)
    return [];
  if (Array.isArray(section.quranSubsections))
    return section.quranSubsections;
  var headings = await getQuranSurahRangeHeadingsFromIndex(Number(section.h1));
  if (headings) {
    section.quranSubsections = headings.subsections
      .filter(subsection => Number(subsection.h2) === Number(section.h2))
      .sort((a, b) => Number(a.ordinal) - Number(b.ordinal) || Number(a.h3) - Number(b.h3));
    return section.quranSubsections;
  }
  var rows = await global.query(`SELECT * FROM v_toc
    WHERE book_alias='quran' AND level=3 AND h1=${Number(section.h1)} AND h2=${Number(section.h2)}
    ORDER BY ordinal, h3`);
  section.quranSubsections = rows.map(row => Heading.toLevel(row));
  return section.quranSubsections;
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

// QURAN SEARCH PROXY
router.get('/quran', async function (req, res, next) {
  if (!req.query.q)
    return next();

  res.locals.req = req;
  res.locals.res = res;
  return await renderSearchResults(req, res, next, {
    forceBookFilters: ['quran', 'commentaries'],
    redirectReferences: false,
    searchAction: '/quran',
    quranSearchProxy: true,
  });
});

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

  var admin = (req.admin);
  var editMode = (admin && req.editMode);

  try {
    var results = [];
    var bookAlias = req.params.bookAlias;
    if (bookAlias === 'quran') {
      var surah = findSurah(req.params.chapterNum);
      if (surah && redirectCanonicalReferencePath(req, res, `/quran/${surah.num}`))
        return;
    }
    var chapterNum = Number(Arabic.toLatinDigits(req.params.chapterNum));
    var offset = req.query.o ? parseInt(req.query.o.toString()) : 0;
    if (bookAlias === 'quran' && shouldRedirectQuranSurahPath(req)) {
      var firstSectionNum = await firstQuranSectionNumber(chapterNum);
      if (firstSectionNum)
        return res.redirect(302, Utils.quranUrl(req, `/quran/${chapterNum}/${firstSectionNum}`));
    }

    var cacheSuffix = (bookAlias === 'quran' && req.query.passage != undefined) ? '.tafsirs-v57-font-hierarchy-ayah' : '';
    var cachedFile = `${homedir}/.hadithdb/cache/${Utils.reqToFilename(req)}${cacheSuffix}.html`;
    if ('flush' in req.query)
      Utils.flushCachedFile(cachedFile);
    if (!('flush' in req.query) && !editMode && fs.existsSync(cachedFile)) {
      sendCachedHtml(req, res, cachedFile);
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

  var admin = (req.admin);
  var editMode = (admin && req.editMode);

  try {
    var results = [];
    var bookAlias = req.params.bookAlias;
    if (bookAlias === 'quran') {
      var surah = findSurah(req.params.chapterNum);
      if (surah && redirectCanonicalReferencePath(req, res, `/quran/${surah.num}/${req.params.sectionNum}`))
        return;
    }
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

    var cacheSuffix = (bookAlias === 'quran' && req.query.ayat == undefined) ? '.tafsirs-v57-font-hierarchy-ayah' : '';
    var cachedFile = `${homedir}/.hadithdb/cache/${Utils.reqToFilename(req)}${cacheSuffix}.html`;
    if ('flush' in req.query)
      Utils.flushCachedFile(cachedFile);
    if (!('flush' in req.query) && !editMode && fs.existsSync(cachedFile)) {
      sendCachedHtml(req, res, cachedFile);
      return;
    }

    var section = await Section.sectionFromRef(`${bookAlias}/${chapterNum}/${sectionNum}`);
    await section.getPrev();
    await section.getNext();
    var chapter = await section.getChapter();
    await chapter.getPrev();
    await chapter.getNext();
    await chapter.getSections();
    var quranSubsections = (bookAlias === 'quran' && req.query.ayat == undefined)
      ? await getQuranSectionSubsections(section)
      : [];
    var quranSurahs = (bookAlias === 'quran' && req.query.ayat == undefined)
      ? await getQuranSurahsFromIndex()
      : [];
    if (bookAlias === 'quran' && req.query.ayat == undefined)
      results = await getQuranSectionPassageItems(section, offset);
    else
      results = await section.getItems(offset);
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
        quranSurahs: quranSurahs,
        req: req,
        res: res
      });
      fs.writeFileSync(cachedFile, html);

      res.render('section_quran', {
        section: section,
        results: results,
        quranSubsections: quranSubsections,
        quranSurahs: quranSurahs
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
  if (p.bookAlias === 'quran') {
    var surah = findSurah(p.chapterNum);
    if (surah)
      p.chapterNum = surah.num;
  }
  res.redirect(301, `/${p.bookAlias}/${p.chapterNum}/${p.sectionNum}#S${p.sectionNum}-${p.subsectionNum}`);
  return;
});

module.exports = router;
