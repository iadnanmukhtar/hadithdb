/* jslint node:true, esversion:9 */
'use strict';

const debug = require('../lib/Debug')('hadithdb:Search');
const express = require('express');
const createError = require('http-errors');
const fs = require('fs');
const fm = require('front-matter');
const ejs = require('ejs');
const Search = require('../lib/Search');
const Hadith = require('../lib/Hadith');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');
const { Section, Chapter, Heading, Item, Library, Record } = require('../lib/Model');
const Index = require('../lib/Index');
const Arabic = require('../lib/Arabic');
const Books = require('../lib/Books');
const BookDownloads = require('../lib/BookDownloads');
const Surahs = require('../lib/Surahs');
const QuranCorpus = require('../lib/QuranCorpus');
const { homedir } = require('os');

const router = express.Router();
const sitemapBuilds = new Map();
const SITEMAP_PAGE_SIZE = 50000;

function parsePositiveIntegerParam(value) {
  var normalized = Arabic.toLatinDigits((value || '').toString());
  if (!/^\d+$/.test(normalized))
    return NaN;
  var numeric = Number(normalized);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : NaN;
}

function parseHadithHeadingNumberParam(value) {
  var normalized = Arabic.toLatinDigits((value || '').toString());
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized))
    return null;
  var numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0)
    return null;
  return numeric.toString();
}

function parseQuranAyahParam(value) {
  var normalized = Arabic.toLatinDigits((value || '').toString());
  if (!/^\d+$/.test(normalized))
    return NaN;
  var numeric = Number(normalized);
  return Number.isSafeInteger(numeric) ? numeric : NaN;
}

function quranAyahCount(surah) {
  return Number(surah && (surah.ayahs || surah.ayat));
}

function visibleBookFromParam(value) {
  return (global.books || []).find(function (book) {
    return book
      && Number(book.hidden) === 0
      && (book.alias == value || book.id == value);
  }) || null;
}

function visibleBookByAlias(value) {
  return (global.books || []).find(function (book) {
    return book
      && Number(book.hidden) === 0
      && book.alias === value;
  }) || null;
}

async function applySameBookHeadingNavigation(heading) {
  if (!heading || !heading.book_alias || !Number.isFinite(Number(heading.ordinal)))
    return heading;
  var level = Number(heading.level);
  if (level !== 1 && level !== 2)
    return heading;
  var baseQuery = `book_alias:${heading.book_alias} AND level:${level}`;
  var prev = await Index.docsFromQueryString(Heading.INDEX, `${baseQuery} AND ordinal:<${heading.ordinal}`, 0, 1, 'ordinal DESC');
  var next = await Index.docsFromQueryString(Heading.INDEX, `${baseQuery} AND ordinal:>${heading.ordinal}`, 0, 1, 'ordinal ASC');
  heading.prev = prev.length > 0 ? Heading.toLevel(prev[0]) : null;
  heading.next = next.length > 0 ? Heading.toLevel(next[0]) : null;
  return heading;
}

function validQuranAyah(surah, ayah) {
  surah = findSurah(surah);
  ayah = parseQuranAyahParam(ayah);
  var ayahCount = quranAyahCount(surah);
  return !!surah && Number.isInteger(ayah) && ayah >= 1 && ayah <= ayahCount;
}

function routeParameterMessage(name, value, reason) {
  return `Invalid route parameter '${name}=${value}'${reason ? `: ${reason}` : ''}`;
}

function queryParameterMessage(name, value, reason) {
  return `Invalid query parameter '${name}=${value}'${reason ? `: ${reason}` : ''}`;
}

function rejectUnsafePathContent(req, res, next) {
  var path = req.path || '';
  try {
    path = decodeURI(path);
  } catch (err) {
    return next(createError(400, 'Invalid request path'));
  }
  if (/[<>"'`\\\x00-\x1f\x7f]/.test(path))
    return next(createError(400, 'Invalid request path'));
  return next();
}

function redirectEncodedReferencePath(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return next();

  var path = req.path;
  if (!/%3a/i.test(path))
    return next();

  var normalizedPath = path.replace(/%3a/ig, ':');
  if (normalizedPath === path || !/^\/(?:passage:|[^/]+:[^/]+)/.test(normalizedPath))
    return next();

  return res.redirect(301, `${normalizedPath}${appendOriginalQuery(req)}`);
}

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

function redirectCanonicalQueryParams(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return next();

  var queryIndex = req.originalUrl.indexOf('?');
  if (queryIndex < 0)
    return next();

  var queryParams = new URLSearchParams(req.originalUrl.substring(queryIndex + 1));
  var shouldRedirect = false;
  var offsetValues = queryParams.getAll('o');
  if (offsetValues.length > 0 && offsetValues.every(value => value === '0')) {
    queryParams.delete('o');
    shouldRedirect = true;
  }

  if (isDefaultQuranPassagePath(req.path) && queryParams.has('passage')) {
    queryParams.delete('passage');
    shouldRedirect = true;
  }

  if (!shouldRedirect)
    return next();

  var queryString = queryParams.toString();
  var cleanUrl = req.originalUrl.substring(0, queryIndex);
  var redirectUrl = queryString ? `${cleanUrl}?${queryString}` : cleanUrl;
  return res.redirect(301, redirectUrl);
}

function isDefaultQuranPassagePath(path) {
  if (/^\/quran:[^/]+:[^/]+/.test(path))
    return true;

  var parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'quran' || parts.length !== 3)
    return false;

  return Boolean(findSurah(parts[1]));
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
  res.end(Utils.readCachedHtml(cachedFile, req));
}

function cachedRenderLocals(res, locals) {
  return Object.assign(
    {},
    res.app ? res.app.locals : {},
    res.locals || {},
    locals || {}
  );
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

function requestWantsJson(req) {
  if ('json' in req.query)
    return true;
  if (req.xhr)
    return true;
  var accept = (req.get('accept') || '').toLowerCase();
  return accept.includes('application/json') && !accept.includes('text/html');
}

function itemPathForLegacyTranslation(item) {
  var path = item && (item.ref || item.path || '');
  if (!path && item && item.book_alias && item.num)
    path = `${item.book_alias}:${item.num}`;
  path = (path || '').toString().trim();
  if (!path)
    return '';
  return path.charAt(0) === '/' ? path : `/${path}`;
}

function addLegacyTranslationParams(path, itemId) {
  var parts = path.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  var pathname = parts ? parts[1] : path;
  var query = parts && parts[2] ? parts[2].substring(1) : '';
  var hash = parts && parts[3] ? parts[3] : '';
  var params = new URLSearchParams(query);
  params.set('translate', '1');
  params.set('translateItem', itemId.toString());
  params.set('translateType', 'hadith');
  var queryString = params.toString();
  return `${pathname}${queryString ? `?${queryString}` : ''}${hash}`;
}

async function legacyTranslationItemUrl(req) {
  var itemId = parsePositiveIntegerParam(req.params.id);
  if (!Number.isInteger(itemId))
    throw createError(400, routeParameterMessage('id', req.params.id, 'id must be a positive integer'));
  var rows = await Index.docsFromKeyValue(Item.INDEX, { hId: itemId }, 0, 1);
  if (rows.length < 1)
    return null;
  var item = new Item(rows[0]);
  var path = itemPathForLegacyTranslation(item);
  if (!path)
    return null;
  return Utils.urlFor(req, addLegacyTranslationParams(path, itemId));
}

router.use(rejectUnsafePathContent);
router.use(redirectEncodedReferencePath);
router.use(redirectArabicDigitPath);
router.use(redirectCanonicalQueryParams);

router.get(['/autocomplete', '/quran/autocomplete'], async function (req, res, next) {
  try {
    var q = Search.truncateQuery(req.query.q || req.query.term || '');
    var bookFilters = req.query.b || req.query['b[]'];
    if (bookFilters && (typeof bookFilters) != 'object')
      bookFilters = [bookFilters];
    bookFilters = expandShortcutBookFilters(normalizeBookFilterValues(bookFilters));
    var quranSearchProxy = req.path.indexOf('/quran/') === 0;
    if (!quranSearchProxy)
      bookFilters = stripQuranTafsirBookFilters(bookFilters);
    else if (bookFilters.length < 1)
      bookFilters = ['quran', 'commentaries'];
    var tafsirFilters = quranSearchProxy ? normalizeRequestTafsirFilters(req) : [];
    if (tafsirFilters.length > 0)
      bookFilters = ['commentaries'];
    var suggestions = await Search.a_autocomplete(q, bookFilters, req.query.limit, {
      tafsirAliases: tafsirFilters,
      excludeQuranAndTafsir: !quranSearchProxy
    });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(suggestions));
  } catch (err) {
    var message = `Error fetching autocomplete suggestions [${req.query.q || req.query.term}]`;
    debug.error(message + `\n${err.stack}`);
    return next(createError(500, message));
  }
});

router.get('/reinit', async function (req, res, next) {
  await Hadith.a_reinit();
  await flushMasterDataCaches();
  res.write('Done');
  res.end();
  return;
});

router.all(['/do/:id', '/quran/do/:id'], async function (req, res, next) {
  try {
    var cmd = (req.query.cmd || req.body?.cmd || '').toString();
    if (cmd === 'tr') {
      var itemUrl = await legacyTranslationItemUrl(req);
      if (!itemUrl)
        return next(createError(404, `Item ${req.params.id} not found`));
      if (requestWantsJson(req)) {
        res.status(410).json({
          code: 410,
          legacy: true,
          translated: false,
          revised: false,
          itemType: 'hadith',
          itemId: parsePositiveIntegerParam(req.params.id),
          itemUrl: itemUrl,
          replacement: itemUrl,
          contentTranslationEndpoint: '/content-translations',
          message: 'Legacy translation links now open the item translation workflow.'
        });
        return;
      }
      res.redirect(302, itemUrl);
      return;
    } else if (cmd === 'comment') {
      // Legacy endpoint retained for older clients. Comment counts are updated when comments are saved.
      return next(createError(501, 'Legacy comment actions are no longer available.'));
    }
    res.sendStatus(204);
    res.end();
    return;
  } catch (err) {
    var message = `Error in action [${req.params.id}?${req.query.action}]`;
    debug.error(message + `\n${err.stack}`);
    return next(createError(500, message));
  }
});

// SITEMAP
router.get('/sitemap\.txt', async function (req, res, next) {
  res.setHeader('content-type', 'text/plain');
  res.setHeader('Cache-Control', 'no-store');
  const urls = await sitemapUrls(req);
  res.end(sitemapText(urls));
});

router.get('/quran/sitemap\.txt', function (req, res) {
  res.redirect(301, quranSitemapUrl(req, '/sitemap.txt'));
});

router.get('/sitemap\.xml', async function (req, res, next) {
  res.setHeader('content-type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const urls = await sitemapUrls(req);
  res.end(sitemapXml(urls));
});

router.get('/quran/sitemap\.xml', function (req, res) {
  res.redirect(301, quranSitemapUrl(req, '/sitemap.xml'));
});

router.get('/sitemap-:page(\\d+)\.txt', async function (req, res, next) {
  res.setHeader('content-type', 'text/plain');
  res.setHeader('Cache-Control', 'no-store');
  const page = Number(req.params.page);
  if (!Number.isInteger(page) || page < 1)
    return next(createError(404, `Sitemap page ${req.params.page} not found`));
  const urls = await sitemapUrls(req);
  const start = (page - 1) * SITEMAP_PAGE_SIZE;
  const pagedUrls = urls.slice(start, start + SITEMAP_PAGE_SIZE);
  if (pagedUrls.length < 1)
    return next(createError(404, `Sitemap page ${page} not found`));
  res.end(sitemapText(pagedUrls));
});

router.get('/quran/sitemap-:page(\\d+)\.txt', function (req, res) {
  res.redirect(301, quranSitemapUrl(req, `/sitemap-${req.params.page}.txt`));
});

async function sitemapUrls(req) {
  const quranOnly = Utils.isQuranSubdomainRequest(req);
  const cachedFile = sitemapCacheFile(quranOnly);
  const flushCache = Utils.shouldFlushCache(req);
  if (!flushCache && fs.existsSync(cachedFile)) {
    const cachedText = fs.readFileSync(cachedFile);
    const cachedUrls = sitemapTextToUrls(cachedText);
    if (!sitemapCacheNeedsRebuild(cachedUrls))
      return cachedUrls;
  }
  const cacheKey = quranOnly ? 'quran' : 'hadith';
  if (!sitemapBuilds.has(cacheKey)) {
    sitemapBuilds.set(cacheKey, buildAndCacheSitemap(req, cachedFile).finally(function () {
      sitemapBuilds.delete(cacheKey);
    }));
  }
  const txt = await sitemapBuilds.get(cacheKey);
  return sitemapTextToUrls(txt);
}

async function buildAndCacheSitemap(req, cachedFile) {
  const txt = await buildSitemapText(req);
  fs.mkdirSync(`${homedir}/.hadithdb/cache`, { recursive: true });
  fs.writeFileSync(cachedFile, txt);
  return txt;
}

function sitemapCacheFile(quranOnly) {
  return Utils.cacheFileFromFilename(quranOnly ? 'quran' : 'hadith', 'txt');
}

function sitemapText(urls) {
  return urls.map(url => `${url}\n`).join('');
}

function sitemapTextToUrls(txt) {
  return txt.toString().split(/\r?\n/).map(url => url.trim()).filter(Boolean);
}

function sitemapCacheNeedsRebuild(urls) {
  return urls.some(url => !/^https?:\/\//i.test(url));
}

function sitemapXml(urls) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls.map(url => `  <url><loc>${escapeSitemapXml(url)}</loc></url>`).join('\n'),
    '</urlset>',
    ''
  ].join('\n');
}

function escapeSitemapXml(value) {
  return Utils.emptyIfNull(value).toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function flushMasterDataCaches() {
  await Utils.flushCachedFile(sitemapCacheFile(false));
  await Utils.flushCachedFile(sitemapCacheFile(true));
  await Utils.flushCacheContaining('quran');
  await Utils.flushCacheContaining('book:quran');
  await Utils.flushCacheContaining('tafsirs');
  await Utils.flushCacheContaining('tafsir:books');
}

async function buildSitemapText(req) {
  var txt = '';
  var domain = global.settings.site.url;
  var quranDomain = quranSitemapBaseUrl(req);
  var quranOnly = Utils.isQuranSubdomainRequest(req);
  var bookSitemapFilter = quranOnly ? `= 'quran'` : `<> 'quran'`;
  var sitemapUrl = function (alias, h1, h2) {
    if (alias === 'quran')
      return `${quranDomain}/quran${(h1 ? '/' + h1 : '')}${(h2 ? '/' + h2 : '')}\n`;
    if (alias.indexOf('quran:') === 0)
      return `${quranDomain}/${alias}\n`;
    return `${domain}/${alias}${(h1 ? '/' + h1 : '')}${(h2 ? '/' + h2 : '')}\n`;
  };
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
  if (quranOnly)
    txt += await quranCommentarySitemapUrls(quranDomain);
  return txt;
}

function quranSitemapBaseUrl(req) {
  const site = global.settings && global.settings.site ? global.settings.site : {};
  const baseUrl = site.quranUrl || quranSitemapRequestOrigin(req) || Utils.quranBaseUrl(req);
  return Utils.emptyIfNull(baseUrl).toString().replace(/\/+$/, '');
}

function quranSitemapUrl(req, path) {
  return `${quranSitemapBaseUrl(req)}${path}`;
}

function quranSitemapRequestOrigin(req) {
  const host = req && typeof req.get === 'function'
    ? (req.get('x-forwarded-host') || req.get('host') || '')
    : (req && req.headers ? (req.headers['x-forwarded-host'] || req.headers.host || '') : '');
  const cleanHost = Utils.emptyIfNull(Array.isArray(host) ? host[0] : host)
    .toString()
    .split(',')[0]
    .trim();
  if (!cleanHost)
    return '';
  const forwardedProto = req && typeof req.get === 'function'
    ? req.get('x-forwarded-proto')
    : (req && req.headers ? req.headers['x-forwarded-proto'] : '');
  const proto = Utils.emptyIfNull(Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)
    .toString()
    .split(',')[0]
    .trim()
    || (Utils.isLocalhostRequest(req) ? (req && req.protocol ? req.protocol : 'http') : 'https');
  return `${proto.replace(/:$/, '')}://${cleanHost}`;
}

async function quranCommentarySitemapUrls(quranDomain) {
  const urls = new Set([
    `${quranDomain}/quran/translations`,
    `${quranDomain}/quran/tafsir`
  ]);
  await addQuranTranslationSitemapUrls(urls, quranDomain);
  await addQuranTafsirSitemapUrls(urls, quranDomain);
  return Array.from(urls).map(url => `${url}\n`).join('');
}

async function addQuranTranslationSitemapUrls(urls, quranDomain) {
  const translations = await Tafsir.visibleTranslations();
  translations.forEach(function (translation) {
    urls.add(`${quranDomain}/quran/${encodeURIComponent(translation.quranBookSlug || translation.alias)}`);
  });
  quranAyahRefs().forEach(function (ref) {
    urls.add(`${quranDomain}/quran/translations/${ref.surah}/${ref.ayah}`);
  });
}

async function addQuranTafsirSitemapUrls(urls, quranDomain) {
  const tafsirs = await Tafsir.visibleTafsirs();
  for (const tafsir of tafsirs) {
    urls.add(`${quranDomain}${quranTafsirBookTocUrl(tafsir, tafsirs)}`);
    const passages = await Tafsir.sitemapPassages(tafsir, { source: 'db' });
    passages.forEach(function (passage) {
      urls.add(`${quranDomain}${Tafsir.browseUrl(tafsir, passage.surah, passage.ayah, tafsirs)}`);
    });
  }
}

function quranTafsirBookTocUrl(tafsir, tafsirs) {
  const slug = tafsir.slug || Tafsir.tafsirSlug(tafsir.alias);
  const hasLanguageCollision = (tafsirs || []).some(function (other) {
    return other && other !== tafsir && other.lang !== tafsir.lang
      && (other.slug || Tafsir.tafsirSlug(other.alias)) === slug;
  });
  const query = hasLanguageCollision && (tafsir.lang === 'ar' || tafsir.lang === 'en')
    ? `?lang=${encodeURIComponent(tafsir.lang)}`
    : '';
  return `/quran/tafsir/${encodeURIComponent(slug)}${query}`;
}

function quranAyahRefs() {
  return (global.surahs || []).flatMap(function (surah) {
    const surahNum = Number(surah.num);
    const ayahCount = Number(surah.ayahs);
    if (!Number.isInteger(surahNum) || !Number.isInteger(ayahCount) || ayahCount < 1)
      return [];
    return Array.from({ length: ayahCount }, function (_, index) {
      return {
        surah: surahNum,
        ayah: index + 1
      };
    });
  });
}

function normalizeRequestBookFilters(req) {
  if (!req.query.b)
    return [];
  var filters = normalizeBookFilterValues(req.query.b);
  filters = expandShortcutBookFilters(filters);
  filters = filters.filter(isVisibleBookFilter);
  req.query.b = filters;
  return filters;
}

function normalizeBookFilterValues(filters) {
  if (!filters)
    return [];
  filters = Array.isArray(filters) ? filters : [filters];
  filters = filters.flatMap(filter => filter.toString().split(','));
  return Array.from(new Set(filters.map(normalizeBookFilterValue).filter(Boolean)));
}

function normalizeBookFilterValue(filter) {
  filter = Utils.trimToEmpty(filter);
  if (filter === 'tafsir')
    return 'commentaries';
  return filter;
}

function expandShortcutBookFilters(filters) {
  var expanded = [];
  filters.forEach(function (filter) {
    if (filter === 'sahihayn') {
      expanded.push('bukhari', 'muslim');
      return;
    }
    if (filter === 'kutubarbaah') {
      expanded.push('abudawud', 'tirmidhi', 'nasai', 'ibnmajah');
      return;
    }
    if (filter === 'sixbooks') {
      expanded.push('bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah');
      return;
    }
    expanded.push(filter);
  });
  return orderBookFilters(Array.from(new Set(expanded)));
}

function orderBookFilters(filters) {
  var priority = new Map([['toc', -1], ['commentaries', Number.MAX_SAFE_INTEGER - 1]]);
  (global.books || []).forEach(function (book, index) {
    if (book && book.alias)
      priority.set(book.alias, index);
  });
  return filters.slice().sort(function (a, b) {
    var orderA = priority.has(a) ? priority.get(a) : Number.MAX_SAFE_INTEGER;
    var orderB = priority.has(b) ? priority.get(b) : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB)
      return orderA - orderB;
    return a.localeCompare(b);
  });
}

function stripQuranTafsirBookFilters(filters) {
  if (!filters)
    return [];
  filters = Array.isArray(filters) ? filters : [filters];
  return filters.flatMap(filter => filter.toString().split(','))
    .map(normalizeBookFilterValue)
    .filter(isVisibleBookFilter)
    .filter(filter => filter && filter !== 'quran' && filter !== 'commentaries');
}

function isVisibleBookFilter(filter) {
  if (!filter)
    return false;
  if (filter === 'toc' || filter === 'commentaries')
    return true;
  if (filter === 'sahihayn' || filter === 'kutubarbaah' || filter === 'sixbooks')
    return true;
  var book = (global.books || []).find(row => row && row.alias === filter);
  return !!book && Number(book.hidden) !== 1;
}

function normalizeRequestTafsirFilters(req) {
  var values = Array.isArray(req.query.tafsir) ? req.query.tafsir : (req.query.tafsir ? [req.query.tafsir] : []);
  values = values.flatMap(value => value.toString().split(',')).map(value => Utils.trimToEmpty(value)).filter(Boolean);
  if (values.length < 1)
    return [];
  var aliases = [];
  values.forEach(function (value) {
    var tafsir = Tafsir.visibleTafsirsSync().find(function (row) {
      return row.source === 'local'
        && (row.alias === value || row.slug === value || Tafsir.tafsirSlug(row.alias) === value);
    });
    if (tafsir)
      aliases.push(tafsir.alias);
  });
  aliases = Array.from(new Set(aliases));
  if (aliases.length < 1) {
    delete req.query.tafsir;
    return [];
  }
  req.query.tafsir = aliases;
  return aliases;
}

function tafsirSearchFilterOptions(selectedAliases) {
  selectedAliases = Array.isArray(selectedAliases) ? selectedAliases : (selectedAliases ? [selectedAliases] : []);
  var seen = new Set();
  return Tafsir.visibleTafsirsSync().filter(function (tafsir) {
    if (!tafsir || tafsir.source !== 'local' || !tafsir.alias || seen.has(tafsir.alias) || Number(tafsir.hidden) === 1)
      return false;
    seen.add(tafsir.alias);
    return true;
  }).map(function (tafsir) {
    return {
      alias: tafsir.alias,
      label: Tafsir.rawShortName(tafsir, 'en') || tafsir.shortName_en || tafsir.name_en || tafsir.alias,
      selected: selectedAliases.indexOf(tafsir.alias) >= 0
    };
  }).sort(compareTafsirFilterOptions);
}

function compareTafsirFilterOptions(a, b) {
  var labelOrder = a.label.localeCompare(b.label, 'en', { sensitivity: 'base' });
  if (labelOrder !== 0)
    return labelOrder;
  return a.alias.localeCompare(b.alias, 'en', { sensitivity: 'base' });
}

function tafsirSearchFilterLabel(alias) {
  if (!alias)
    return '';
  var tafsir = Tafsir.visibleTafsirsSync().find(row => row.alias === alias && Number(row.hidden) !== 1);
  if (!tafsir)
    return alias;
  return Tafsir.rawShortName(tafsir, 'en') || tafsir.shortName_en || tafsir.name_en || alias;
}

function searchFilterPills(bookFilters, tafsirAliases) {
  tafsirAliases = Array.isArray(tafsirAliases) ? tafsirAliases : (tafsirAliases ? [tafsirAliases] : []);
  var filters = Array.isArray(bookFilters) ? bookFilters : (bookFilters ? [bookFilters] : []);
  var pills = filters.filter(Boolean).map(function (filter) {
    return {
      param: 'b',
      value: searchFilterDisplayValue(filter),
      label: Search.describeBookFilters([filter])[0] || filter,
      removeTafsir: filter === 'commentaries'
    };
  });
  tafsirAliases.forEach(function (tafsirAlias) {
    pills.push({
      param: 'tafsir',
      value: tafsirAlias,
      label: tafsirSearchFilterLabel(tafsirAlias),
      removeTafsir: false
    });
  });
  return pills;
}

function searchFilterDisplayValues(bookFilters) {
  var filters = Array.isArray(bookFilters) ? bookFilters : (bookFilters ? [bookFilters] : []);
  return filters.map(searchFilterDisplayValue);
}

function searchFilterDisplayValue(filter) {
  return filter === 'commentaries' ? 'tafsir' : filter;
}

async function renderSearchResults(req, res, next, options = {}) {
  var results = [];
  var totalResults = 0;

  req.query.q = Search.truncateQuery(req.query.q);
  if (options.forceBookFilters)
    req.query.b = options.forceBookFilters.slice();
  var tafsirFilters = options.quranSearchProxy ? normalizeRequestTafsirFilters(req) : [];
  if (!options.quranSearchProxy)
    delete req.query.tafsir;
  if (tafsirFilters.length > 0)
    req.query.b = ['commentaries'];

  if (options.redirectReferences !== false) {
    var bookReference = !Search.isExpressionQuery(req.query.q) && Books.findReference(req.query.q, global.books);
    if (bookReference && (options.quranSearchProxy || bookReference.book.alias !== 'quran')) {
      res.redirect('/' + bookReference.ref);
      return true;
    }
    // is it a item ref number?
    if (!Search.isExpressionQuery(req.query.q) && req.query.q.match(/^([a-z]+:\d+|\d+)/)) {
      var referenceBook = Library.instance.findBook(req.query.q.split(/:/)[0]);
      if (referenceBook && (options.quranSearchProxy || referenceBook.alias !== 'quran')) {
        res.redirect('/' + req.query.q);
        return true;
      }
    } else if (!Search.isExpressionQuery(req.query.q) && req.query.q.match(/^[a-z]+\//)) {
      var pathReferenceBook = Library.instance.findBook(req.query.q.split(/\//)[0]);
      if (pathReferenceBook && (options.quranSearchProxy || pathReferenceBook.alias !== 'quran')) {
        res.redirect('/' + req.query.q);
        return true;
      }
    }
  }

  try {
    normalizeRequestBookFilters(req);
    if (!options.quranSearchProxy)
      req.query.b = stripQuranTafsirBookFilters(req.query.b);
    var effectiveBookFilters = req.query.b;
    if ((!effectiveBookFilters || effectiveBookFilters.length < 1) && options.defaultBookFilters)
      effectiveBookFilters = options.defaultBookFilters.slice();
    var offset = req.query.o ? parseInt(req.query.o.toString()) : 0;
    offset = Math.floor(offset / global.settings.search.itemsPerPage) * global.settings.search.itemsPerPage;
    results = await Search.a_searchText(req.query.q, effectiveBookFilters, offset, {
      tafsirAliases: tafsirFilters,
      excludeQuranAndTafsir: !options.quranSearchProxy
    });
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
    debug.error(message + `\n${err.stack}`);
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
      b: searchFilterDisplayValues(req.query.b),
      bookFilterLabels: Search.describeBookFilters(req.query.b).concat(tafsirFilters.map(tafsirSearchFilterLabel)),
      searchFilterPills: searchFilterPills(req.query.b, tafsirFilters),
      searchAction: options.searchAction || '/',
      quranSearchProxy: options.quranSearchProxy || false,
      tafsirFilters: tafsirFilters,
      tafsirFilter: tafsirFilters[0] || '',
      tafsirFilterOptions: options.quranSearchProxy ? tafsirSearchFilterOptions(tafsirFilters) : [],
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
  var sectionNum = parsePositiveIntegerParam(req.params.sectionNum);
  if (!Number.isInteger(sectionNum))
    return next(createError(400, routeParameterMessage('sectionNum', req.params.sectionNum, 'Quran section must be a positive integer')));
  var section;
  try {
    section = await Section.sectionFromRef(`quran/${surah.num}/${sectionNum}`);
  } catch (err) {
    if (err instanceof ReferenceError)
      return next(createError(404, err.message));
    return next(err);
  }
  var range = await getQuranHeadingAyahRange(section);
  if (!range)
    return next(createError(404, `Quran section ${surah.num}/${sectionNum} has no ayah range`));
  var startAyah = range.startAyah;
  var endAyah = startAyah + range.count - 1;
  var rows = await QuranCorpus.wordsForRange(surah.num, startAyah, endAyah);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
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
  var requestedSurah = surah;
  ayah1 = parseQuranAyahParam(ayah1);
  ayah2 = parseQuranAyahParam(ayah2);
  surah = findSurah(surah);
  if (!surah)
    return next(createError(404, routeParameterMessage('surah', requestedSurah, 'Quran surah was not found')));
  var ayahCount = quranAyahCount(surah);
  if (!Number.isInteger(ayah1) || !Number.isInteger(ayah2) || ayah1 < 1 || ayah2 < ayah1 || ayah2 > ayahCount)
    return next(createError(404, `Invalid route parameters 'ayah1=${req.params.ayah1 || ayah1}'${req.params.ayah2 ? ` and 'ayah2=${req.params.ayah2}'` : ''}: ayah range must be between 1 and ${ayahCount} for Quran ${surah.num}`));
  var selectedAyahs = await Index.docsFromQueryString(Item.INDEX, `book_alias:quran AND h1:${surah.num} AND numInChapter:[${ayah1} TO ${ayah2}]`, 0, ayah2 - ayah1 + 1, 'numInChapter');
  selectedAyahs = selectedAyahs.map(item => new Item(item));
  var results = selectedAyahs;
  var section;
  var chapter;
  var quranSubsections = [];
  if ('json' in req.query) {
    res.setHeader('Content-Type', 'application/json');
    if (selectedAyahs.length < 1)
      return res.end(JSON.stringify([]));
    if (selectedAyahs.length === 1)
      await addQuranAdjacentRefs(selectedAyahs[0]);
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
    return res.end(JSON.stringify([selectedAyahs[0]]));
  }
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
  if ('tsv' in req.query) {
    res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
    if (results.length < 1)
      return res.end('');
    var keyNames = Object.keys(results[0]);
    if ('keys' in req.query)
      keyNames = req.query.keys.split(/,/);
    res.end(Utils.toTSV(results, keyNames));
  } else {

    var defaultPassage = req.query.passage != undefined || req.path.startsWith('/passage:') || req.params.bookAlias === 'quran';
    if (selectedAyahs.length < 1)
      return next(createError(404, `Route parameters 'surah=${surah.num}', 'ayah1=${ayah1}'${ayah2 !== ayah1 ? `, and 'ayah2=${ayah2}'` : ''} did not match any Quran ayat`));
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
        Tafsir: Tafsir,
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
      if (!validQuranAyah(surah.num, num))
        return next(createError(404, `Quran ayah ${surah.num}:${num} not found`));
      if (redirectCanonicalReferencePath(req, res, `/quran:${surah.num}:${num}`))
        return;
      req.params.num = `${surah.num}:${num}`;
    }
  } else {
    if (originalNum !== req.params.num)
      return res.redirect(301, `/${req.params.bookAlias}:${req.params.num}${appendOriginalQuery(req)}`);
    var book = visibleBookByAlias(req.params.bookAlias);
    if (await redirectVirtualHadithReference(book, req.params.num, req, res))
      return;
    if (!book) {
      var surah = findSurah(req.params.bookAlias);
      if (surah) {
        if (!validQuranAyah(surah.num, req.params.num))
          return next(createError(404, `Quran ayah ${surah.num}:${req.params.num} not found`));
        return redirectCanonicalReferencePath(req, res, `/quran:${surah.num}:${req.params.num}`);
      }
      return next(createError(404, `Book '${req.params.bookAlias}' does not exist`));
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
  if (results[0].book_alias === 'quran' && 'json' in req.query) {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(results));
  }
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
    Tafsir: Tafsir,
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
    debug.error(`Quran heading index lookup failed for surah ${surah}: ${err.message}\n${err.stack || ''}`);
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
    debug.error(`Quran surah index lookup failed: ${err.message}\n${err.stack || ''}`);
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
  if (offset < 0)
    offset = 0;
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

function shouldRedirectHadithChapterPath(req) {
  return req.query.json === undefined
    && req.query.tsv === undefined
    && req.query.md === undefined
    && req.query.download === undefined
    && req.query.epub === undefined;
}

function appendChapterSectionRedirectQuery(req) {
  var queryIndex = req.originalUrl.indexOf('?');
  if (queryIndex < 0)
    return '';
  var queryParams = new URLSearchParams(req.originalUrl.substring(queryIndex + 1));
  queryParams.delete('o');
  queryParams.delete('passage');
  var queryString = queryParams.toString();
  return queryString ? `?${queryString}` : '';
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

// RANDOM BOOK TOC ITEM FRAGMENT
router.get('/:bookAlias/random', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;

  var book = visibleBookFromParam(req.params.bookAlias);
  if (!book)
    return next(createError(404, `Book '${req.params.bookAlias}' does not exist`));

  var random;
  if (!book.virtual)
    random = await Index.docRandomnly(Item.INDEX, `book_alias:${book.alias}`);
  else
    random = await Index.docRandomnly(Item.INDEX, `books:"{${book.alias}}"`);
  if (!random || random.length < 1)
    return next(createError(404, `Random item in ${book.shortName_en || book.alias} not found`));
  random = new Item(random[0]);
  var quranCommentaryBook = null;
  if (book.alias === 'quran' && typeof req.query.translation === 'string' && /^[A-Za-z0-9_-]+$/.test(req.query.translation)) {
    quranCommentaryBook = (global.commentaries || []).find(function (commentaryBook) {
      return commentaryBook
        && Number(commentaryBook.hidden) === 0
        && commentaryBook.type === 'trans'
        && commentaryBook.alias === req.query.translation;
    }) || null;
    if (quranCommentaryBook)
      await applyRandomQuranTranslation(random, quranCommentaryBook);
  }

  var site = Object.assign({}, global.settings.site);
  site.admin = false;
  site.editMode = false;
  var page = {
    menu: 'Books',
    title_en: book.alias === 'quran' ? 'Quran | Table of Contents' : Utils.hadithBookTitle(book),
    canonical: `/${book.alias}`,
    context: {
      book: book,
      quranCommentaryBook: quranCommentaryBook
    }
  };

  res.setHeader('Cache-Control', 'no-store');
  res.render('sub-views/random_toc_item', {
    book: book,
    page: page,
    quranCommentaryBook: quranCommentaryBook,
    random: random,
    site: site
  });
});

async function applyRandomQuranTranslation(random, translationBook) {
  var ref = Arabic.toLatinDigits((random && (random.en?.num || random.num || random.ref) || '').toString()).replace(/^quran:/, '');
  var parts = ref.split(/[:/-]/).filter(Boolean).map(value => Number(value));
  var surah = parts[0];
  var ayah = parts[1];
  if (!Number.isInteger(surah) || !Number.isInteger(ayah))
    return;
  var translation = await Tafsir.localTranslationEntry(translationBook, surah, ayah).catch(function (err) {
    debug.error(`random quran translation failed alias=${translationBook.alias} ref=${surah}:${ayah}: ${err.message}\n${err.stack || ''}`);
    return null;
  });
  if (!translation || !translation.html)
    return;
  random.body_en = translation.html;
  if (random.en)
    random.en.body = translation.html;
}

// QURAN SEARCH PROXY
router.get('/:bookAlias.:format(json|epub)', BookDownloads.sendHadithBook);

router.get('/quran/:translationAlias.:format(json|epub)', BookDownloads.sendTranslationBook);

router.get('/quran', async function (req, res, next) {
  if (!req.query.q)
    return next();

  res.locals.req = req;
  res.locals.res = res;
  return await renderSearchResults(req, res, next, {
    defaultBookFilters: ['quran', 'commentaries'],
    redirectReferences: false,
    searchAction: '/quran',
    quranSearchProxy: true,
  });
});

// BOOK: TABLE OF CONTENTS
router.get('/:bookAlias', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var books = (global.books || []).filter(book => Number(book.hidden) === 0);
  var book = visibleBookFromParam(req.params.bookAlias);
  if (book) {
    if ('download' in req.query && ('json' in req.query || 'epub' in req.query)) {
      req.params.format = 'epub' in req.query ? 'epub' : 'json';
      return BookDownloads.sendHadithBook(req, res, next);
    }
    var prevBook = null;
    var nextBook = null;
    var bookIdx = books.findIndex(function (value, index, arr) {
      return (value.id == book.id);
    });
    if (bookIdx > 0)
      prevBook = books[bookIdx - 1];
    if (bookIdx < (books.length - 1))
      nextBook = books[bookIdx + 1];

    var admin = req.admin;
    var editMode = admin && req.editMode;
    var cacheableHtml = !('download' in req.query) && !('json' in req.query) && !('tsv' in req.query) && !('epub' in req.query);
    var cachedFile = Utils.htmlCacheFile(req);
    const flushCache = Utils.shouldFlushCache(req);
    if (flushCache)
      await Utils.flushCachedFile(cachedFile);
    if (cacheableHtml && !flushCache && !editMode && fs.existsSync(cachedFile)) {
      sendCachedHtml(req, res, cachedFile);
      return;
    }

    var results;
    var random;
    var tafsirs;
    if ('download' in req.query && ('json' in req.query || 'epub' in req.query || 'tsv' in req.query)) {
      debug(`downloading ${req.params.bookAlias}`);
      if (!book.virtual)
        results = await global.query(`SELECT * from v_hadiths WHERE book_id=${book.id} ORDER BY ordinal`);
      else
        results = await global.query(`SELECT * from v_hadiths_virtual_snapshot WHERE book_id=${book.id} ORDER BY ordinal`);
    } else {
      results = await Library.instance.findBook(book.alias).getChapters();
      if (cacheableHtml) {
        random = undefined;
      } else if (!book.virtual)
        random = await Index.docRandomnly(Item.INDEX, `book_alias:${book.alias}`);
      else
        random = await Index.docRandomnly(Item.INDEX, `books:"{${book.alias}}"`);
      if (random && random.length > 0)
        random = new Item(random[0]);
      if (book.alias === 'quran')
        tafsirs = await Tafsir.visibleTafsirs();
    }

    if ('download' in req.query && 'json' in req.query) {
      Utils.sendJsonDownload(res, `hadithunlocked_${Utils.safeFilename(book.alias)}.json`, results);
    } else if ('download' in req.query && 'epub' in req.query) {
      Utils.sendEpubDownload(res, `hadithunlocked_${Utils.safeFilename(book.alias)}.epub`, book, results);
    } else if ('json' in req.query) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(results));
    } else if ('tsv' in req.query) {
      res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
      var keyNames = Object.keys(results[0]);
      if ('keys' in req.query)
        keyNames = req.query.keys.split(/,/);
      res.end(Utils.toTSV(results, keyNames));
    } else {
      if (cacheableHtml && !editMode) {
        fs.mkdirSync(`${homedir}/.hadithdb/cache`, { recursive: true });
        var refs = [book.alias, `book:${book.alias}`];
        var html = await ejs.renderFile(`${__dirname}/../views/toc.ejs`, cachedRenderLocals(res, {
          noadmin: true,
          book: book,
          BookDownloads: BookDownloads,
          prevBook: prevBook,
          nextBook: nextBook,
          toc: results,
          random: random,
          Tafsir: Tafsir,
          tafsirs: tafsirs,
          req: req,
          res: res
        }));
        Utils.writeCachedHtml(cachedFile, html);
        await Utils.indexCachedItem(refs, cachedFile);
      }
      res.render('toc', {
        book: book,
        BookDownloads: BookDownloads,
        prevBook: prevBook,
        nextBook: nextBook,
        toc: results,
        random: random,
        Tafsir: Tafsir,
        tafsirs: tafsirs
      });
    }
  } else
    return next(createError(404, `Book '${req.params.bookAlias}' does not exist`));
});

// QURAN COMMENTARY BOOK: TABLE OF CONTENTS
router.get('/quran/:commentaryAlias', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;

  var alias = (req.params.commentaryAlias || '').toString();
  var quranCommentaryBook = await resolveQuranCommentaryBook(alias);
  if (!quranCommentaryBook)
    return next();

  var book = global.books.find(function (value) {
    return value && value.alias === 'quran' && value.hidden == 0;
  });
  if (!book)
    return next(createError(404, `Book 'quran' does not exist`));

  var results = await Library.instance.findBook('quran').getChapters();
  var tafsirs = quranCommentaryBook.type === 'tafsir' ? await Tafsir.visibleTafsirs() : [];
  var translations = quranCommentaryBook.type === 'trans' ? await Tafsir.visibleTranslations() : [];
  var renderLocals = {
    book: book,
    BookDownloads: BookDownloads,
    prevBook: null,
    nextBook: null,
    toc: results,
    random: undefined,
    Tafsir: Tafsir,
    tafsirs: tafsirs,
    translations: translations,
    quranCommentaryBooks: quranCommentaryBook.type === 'trans' ? translations : tafsirs,
    quranCommentaryBook: quranCommentaryBook
  };

  if ('json' in req.query) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(results));
    return;
  }
  if ('tsv' in req.query) {
    res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
    var keyNames = Object.keys(results[0]);
    if ('keys' in req.query)
      keyNames = req.query.keys.split(/,/);
    res.end(Utils.toTSV(results, keyNames));
    return;
  }

  res.render('toc', renderLocals);
});

async function resolveQuranCommentaryBook(alias) {
  if (!alias)
    return null;
  var translation = (global.commentaries || []).find(function (book) {
    return book && Number(book.hidden) === 0 && book.type === 'trans' && book.alias === alias;
  });
  if (translation)
    return { ...translation, quranBookSlug: alias };
  return null;
}

// BOOK: CHAPTER
router.get('/:bookAlias/:chapterNum', async function (req, res, next) {

  res.locals.req = req;
  res.locals.res = res;

  var admin = (req.admin);
  var editMode = (admin && req.editMode);

  try {
    var results = [];
    var bookAlias = req.params.bookAlias;
    var book = bookAlias === 'quran' ? visibleBookByAlias('quran') : visibleBookFromParam(bookAlias);
    if (!book)
      return next(createError(404, `Book '${bookAlias}' does not exist`));
    bookAlias = book.alias;
    if (bookAlias === 'quran') {
      var surah = findSurah(req.params.chapterNum);
      if (surah && redirectCanonicalReferencePath(req, res, `/quran/${surah.num}`))
        return;
    }
    var chapterNum = bookAlias === 'quran'
      ? parsePositiveIntegerParam(req.params.chapterNum)
      : parseHadithHeadingNumberParam(req.params.chapterNum);
    if (bookAlias === 'quran' ? !Number.isInteger(chapterNum) : !chapterNum)
      return next(createError(bookAlias === 'quran' ? 404 : 400, routeParameterMessage('chapterNum', req.params.chapterNum, bookAlias === 'quran' ? 'chapter must be a positive integer' : 'chapter must be a non-negative number')));
    if (bookAlias === 'quran' && !findSurah(chapterNum))
      return next(createError(404, `Quran surah ${chapterNum} not found`));
    var offset = req.query.o ? parseInt(req.query.o.toString()) : 0;
    if (bookAlias === 'quran' && shouldRedirectQuranSurahPath(req)) {
      var firstSectionNum = await firstQuranSectionNumber(chapterNum);
      if (firstSectionNum)
        return res.redirect(302, `${Utils.quranUrl(req, `/quran/${chapterNum}/${firstSectionNum}`)}${appendOriginalQuery(req)}`);
    }

    var chapter = await Chapter.chapterFromRef(`${bookAlias}/${chapterNum}`);
    if (bookAlias !== 'quran' && shouldRedirectHadithChapterPath(req)) {
      var firstSection = await chapter.getFirstSection();
      if (firstSection && firstSection.path)
        return res.redirect(301, `/${firstSection.path}${appendChapterSectionRedirectQuery(req)}`);
    }

    var quranChapterPassage = bookAlias === 'quran' && req.query.ayat == undefined;
    var cachedFile = Utils.htmlCacheFile(req);
    const flushCache = Utils.shouldFlushCache(req);
    if (flushCache)
      Utils.flushCachedFile(cachedFile);
    if (!flushCache && !editMode && fs.existsSync(cachedFile)) {
      sendCachedHtml(req, res, cachedFile);
      return;
    }

    await chapter.getPrev();
    await chapter.getNext();
    await applySameBookHeadingNavigation(chapter);
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

      if (quranChapterPassage) {
        // cache response
        var refs = [];
        for (const item of results)
          refs.push(item.ref);
        var html = await ejs.renderFile(`${__dirname}/../views/section_quran.ejs`, cachedRenderLocals(res, {
          Tafsir: Tafsir,
          noadmin: true,
          chapter: chapter,
          section: chapter,
          results: results,
          req: req,
          res: res
        }));
        Utils.writeCachedHtml(cachedFile, html);
        await Utils.indexCachedItem(refs, cachedFile);

        res.render('section_quran', {
          Tafsir: Tafsir,
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
      var html = await ejs.renderFile(`${__dirname}/../views/chapter.ejs`, cachedRenderLocals(res, {
        noadmin: true,
        chapter: chapter,
        results: results,
        req: req,
        res: res
      }));
      Utils.writeCachedHtml(cachedFile, html);
      await Utils.indexCachedItem(refs, cachedFile);

      res.render('chapter', {
        chapter: chapter,
        results: results
      });
    }

  } catch (e) {
    if (e instanceof ReferenceError)
      return next(createError(404, e.message));
    else {
      debug.error(e.stack || e.message || e);
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
    var book = bookAlias === 'quran' ? visibleBookByAlias('quran') : visibleBookFromParam(bookAlias);
    if (!book)
      return next(createError(404, `Book '${bookAlias}' does not exist`));
    bookAlias = book.alias;
    if (bookAlias === 'quran') {
      var surah = findSurah(req.params.chapterNum);
      if (surah && redirectCanonicalReferencePath(req, res, `/quran/${surah.num}/${req.params.sectionNum}`))
        return;
    }
    var chapterNum = bookAlias === 'quran'
      ? parsePositiveIntegerParam(req.params.chapterNum)
      : parseHadithHeadingNumberParam(req.params.chapterNum);
    var sectionNum = parsePositiveIntegerParam(req.params.sectionNum);
    if (bookAlias === 'quran' ? !Number.isInteger(chapterNum) : !chapterNum)
      return next(createError(bookAlias === 'quran' ? 404 : 400, routeParameterMessage('chapterNum', req.params.chapterNum, bookAlias === 'quran' ? 'chapter must be a positive integer' : 'chapter must be a non-negative number')));
    if (!Number.isInteger(sectionNum))
      return next(createError(400, routeParameterMessage('sectionNum', req.params.sectionNum, 'section must be a positive integer')));
    if (bookAlias === 'quran' && !findSurah(chapterNum))
      return next(createError(404, `Quran surah ${chapterNum} not found`));
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

    var cachedFile = Utils.htmlCacheFile(req);
    const flushCache = Utils.shouldFlushCache(req);
    if (flushCache)
      Utils.flushCachedFile(cachedFile);
    if (!flushCache && !editMode && fs.existsSync(cachedFile)) {
      sendCachedHtml(req, res, cachedFile);
      return;
    }

    var section = await Section.sectionFromRef(`${bookAlias}/${chapterNum}/${sectionNum}`);
    await section.getPrev();
    await section.getNext();
    await applySameBookHeadingNavigation(section);
    var chapter = await section.getChapter();
    await chapter.getPrev();
    await chapter.getNext();
    await chapter.getSections();
    var isQuranPassageSection = bookAlias === 'quran' && req.query.ayat == undefined;
    var quranSubsections = isQuranPassageSection
      ? await getQuranSectionSubsections(section)
      : [];
    var quranSurahs = isQuranPassageSection
      ? await getQuranSurahsFromIndex()
      : [];
    if (isQuranPassageSection)
      results = await getQuranSectionPassageItems(section, offset);
    else
      results = await section.getItems(offset);
    if (isQuranPassageSection && results.length == 0)
      return next(createError(404, `${queryParameterMessage('o', offset, `Quran section ${chapterNum}/${sectionNum} does not have content at that offset`)}`));
    if (results.length == 0) {
      var item = new Item(section);
      item.id = item.hId = undefined;
      results.push(item);
    }

    if (isQuranPassageSection) {

      // cache response
      var refs = [];
      for (const item of results)
        refs.push(item.ref);
      var html = await ejs.renderFile(`${__dirname}/../views/section_quran.ejs`, cachedRenderLocals(res, {
        Tafsir: Tafsir,
        noadmin: true,
        section: section,
        results: results,
        selectedAyahs: [],
        quranSubsections: quranSubsections,
        quranSurahs: quranSurahs,
        req: req,
        res: res
      }));
      Utils.writeCachedHtml(cachedFile, html);
      await Utils.indexCachedItem(refs, cachedFile);

      res.render('section_quran', {
        Tafsir: Tafsir,
        section: section,
        results: results,
        selectedAyahs: [],
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
        var html = await ejs.renderFile(`${__dirname}/../views/section.ejs`, cachedRenderLocals(res, {
          noadmin: true,
          section: section,
          results: results,
          req: req,
          res: res
        }));
        Utils.writeCachedHtml(cachedFile, html);
        await Utils.indexCachedItem(refs, cachedFile);

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
      debug.error(e.stack || e.message || e);
      return next(createError(500, e.message));
    }
  }

});

// BOOK: SECTION
router.get('/:bookAlias/:chapterNum/:sectionNum/:subsectionNum', async function (req, res, next) {
  var p = req.params;
  var book = p.bookAlias === 'quran' ? visibleBookByAlias('quran') : visibleBookFromParam(p.bookAlias);
  if (!book)
    return next(createError(404, `Book '${p.bookAlias}' does not exist`));
  p.bookAlias = book.alias;
  if (p.bookAlias === 'quran') {
    var surah = findSurah(p.chapterNum);
    if (!surah)
      return next(createError(404, `Quran surah ${p.chapterNum} not found`));
    p.chapterNum = surah.num;
  }
  var chapterNum = p.bookAlias === 'quran'
    ? parsePositiveIntegerParam(p.chapterNum)
    : parseHadithHeadingNumberParam(p.chapterNum);
  var sectionNum = parsePositiveIntegerParam(p.sectionNum);
  var subsectionNum = parsePositiveIntegerParam(p.subsectionNum);
  if (p.bookAlias === 'quran' ? !Number.isInteger(chapterNum) : !chapterNum)
    return next(createError(400, routeParameterMessage('chapterNum', p.chapterNum, p.bookAlias === 'quran' ? 'chapter must be a positive integer' : 'chapter must be a non-negative number')));
  if (!Number.isInteger(sectionNum))
    return next(createError(400, routeParameterMessage('sectionNum', p.sectionNum, 'section must be a positive integer')));
  if (!Number.isInteger(subsectionNum))
    return next(createError(400, routeParameterMessage('subsectionNum', p.subsectionNum, 'subsection must be a positive integer')));
  res.redirect(301, `/${p.bookAlias}/${chapterNum}/${sectionNum}#S${sectionNum}-${subsectionNum}`);
  return;
});

module.exports = router;
