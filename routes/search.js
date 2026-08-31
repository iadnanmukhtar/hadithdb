/* jslint node:true, esversion:9 */
'use strict';

const debug = require('../lib/Debug')('hadithdb:Search');
const express = require('express');
const createError = require('http-errors');
const rateLimit = require('express-rate-limit').default;
const fs = require('fs');
const fm = require('front-matter');
const ejs = require('ejs');
const Search = require('../lib/Search');
const Hadith = require('../lib/Hadith');
const Tafsir = require('../lib/Tafsir');
const CommentaryHeadings = require('../lib/CommentaryHeadings');
const Utils = require('../lib/Utils');
const { Subsection, Section, Chapter, Heading, Item, Library, Record } = require('../lib/Model');
const Index = require('../lib/Index');
const Arabic = require('../lib/Arabic');
const Books = require('../lib/Books');
const BookDownloads = require('../lib/BookDownloads');
const Surahs = require('../lib/Surahs');
const QuranCorpus = require('../lib/QuranCorpus');
const QuranScripts = require('../lib/QuranScripts');
const QuranTocSubdivisions = require('../lib/QuranTocSubdivisions');
const QuranHeadingOutlines = require('../lib/QuranHeadingOutlines');
const HadithHeadingOutlines = require('../lib/HadithHeadingOutlines');
const HadithHeadingNavigation = require('../lib/HadithHeadingNavigation');
const HdithMetadata = require('../lib/HdithMetadata');
const QuranHeadings = require('../lib/QuranHeadings');
const QuranMushaf = require('../lib/QuranMushaf');
const { invalidateQuranMemoryCaches } = require('../lib/QuranCacheInvalidation');
const QuranSimilarAyahs = require('../lib/QuranSimilarAyahs');
const QuranMutashabihat = require('../lib/QuranMutashabihat');
const RuntimeRefresh = require('../lib/RuntimeRefresh');
const GoogleAuth = require('../lib/GoogleAuth');
const UserSettings = require('../lib/UserSettings');
const HttpRange = require('../lib/HttpRange');
const { homedir } = require('os');

const router = express.Router();
const sitemapBuilds = new Map();
const SITEMAP_PAGE_SIZE = 50000;
const SITEMAP_COMMENTARY_CONCURRENCY = 6;
const DEFAULT_SEARCH_RATE_LIMIT_WINDOW_MS = 1000;
const DEFAULT_SEARCH_RATE_LIMIT_RPS = 100;

function envPositiveInteger(name, fallback) {
  var value = Number.parseInt((process.env[name] || '').toString().trim(), 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

const SEARCH_RATE_LIMIT_PER_IP = envPositiveInteger('SEARCH_THROTTLE_RPS', DEFAULT_SEARCH_RATE_LIMIT_RPS);
const SEARCH_RATE_LIMIT_WINDOW_MS = envPositiveInteger('SEARCH_THROTTLE_WINDOW_MS', DEFAULT_SEARCH_RATE_LIMIT_WINDOW_MS);

function requestRateLimitIp(req) {
  return req.clientIp || req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function skipSearchRateLimit(req) {
  return Utils.isLocalhostRequest(req);
}

const searchRequestLimiter = rateLimit({
  windowMs: SEARCH_RATE_LIMIT_WINDOW_MS,
  limit: SEARCH_RATE_LIMIT_PER_IP,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: requestRateLimitIp,
  skip: skipSearchRateLimit,
  message: 'Too many search requests. Please wait and try again.'
});

function throttleSearchRequest(req, res, next) {
  if (!req.query.q && !req.query.term)
    return next();
  return searchRequestLimiter(req, res, next);
}

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

function gone(message) {
  return createError(410, message);
}

function parseNonNegativeIntegerParam(value) {
  var normalized = Arabic.toLatinDigits((value === undefined || value === null ? '' : value).toString());
  if (!/^\d+$/.test(normalized))
    return NaN;
  var numeric = Number(normalized);
  return Number.isSafeInteger(numeric) ? numeric : NaN;
}

function parseQuranAyahParam(value) {
  return parseNonNegativeIntegerParam(value);
}

function normalizeQuranReviewRef(value) {
  var candidate = Array.isArray(value) ? value[0] : value;
  var match = Arabic.toLatinDigits((candidate || '').toString()).match(/^(\d{1,3}):(\d{1,3})$/);
  if (!match)
    return '';
  var surahNumber = Number(match[1]);
  var ayahNumber = Number(match[2]);
  if (!Number.isInteger(surahNumber) || !Number.isInteger(ayahNumber)
    || surahNumber < 1 || surahNumber > 114 || ayahNumber < 1)
    return '';
  var surah = (global.surahs || []).find(function (item) { return Number(item.num) === surahNumber; });
  var ayahCount = quranAyahCount(surah);
  if (Number.isInteger(ayahCount) && ayahCount > 0 && ayahNumber > ayahCount)
    return '';
  return `${surahNumber}:${ayahNumber}`;
}

function compactQuranReviewQuery(req, reviewRef) {
  var parts = [`review=${reviewRef}`];
  if (req.query.reviewRetry !== undefined)
    parts.push('reviewRetry=1');
  return parts.join('&');
}

function quranAyahCount(surah) {
  return Number(surah && (surah.ayahs || surah.ayat));
}

function quranMinimumAyah(surah) {
  return Number(surah && surah.num) === 1 ? 0 : 1;
}

function quranSurahCount() {
  return Math.max(0, ...(global.surahs || []).map(function (surah) { return Number(surah.num); }).filter(Number.isInteger));
}

function numberedSubdivisionRangeError(unit, rows, requested, label) {
  var number = Number(requested);
  if (!Number.isInteger(number))
    return null;
  var maximum = Math.max(0, ...(rows || []).map(function (row) { return Number(row.num); }).filter(Number.isInteger));
  if (number >= 1 && number <= maximum)
    return null;
  return HttpRange.notSatisfiable(unit, maximum, `${label} '${requested}' is out of range`);
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
  return HadithHeadingNavigation.applySameBookHeadingNavigation(heading);
}

function validQuranAyah(surah, ayah) {
  surah = findSurah(surah);
  ayah = parseQuranAyahParam(ayah);
  var ayahCount = quranAyahCount(surah);
  return !!surah && Number.isInteger(ayah) && ayah >= quranMinimumAyah(surah) && ayah <= ayahCount;
}

function validQuranTranslationAlias(value) {
  value = (value || '').toString().trim();
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : '';
}

function visibleQuranTranslationByAlias(alias) {
  alias = validQuranTranslationAlias(alias);
  if (!alias)
    return null;
  var translations = Tafsir.visibleTranslationsSync();
  var translation = translations.find(function (book) {
    return book && (book.alias === alias || book.quranBookSlug === alias);
  });
  if (!translation && alias.startsWith('translation-')) {
    var legacyAlias = alias.substring('translation-'.length);
    translation = translations.find(function (book) {
      return book && book.storedType === 'tafsir' && book.alias === legacyAlias;
    });
  }
  return translation || null;
}

function appendQueryExcluding(req, target, excludedKeys) {
  var excluded = new Set(excludedKeys || []);
  var params = new URLSearchParams();
  Object.entries(req.query || {}).forEach(function ([key, value]) {
    if (excluded.has(key))
      return;
    if (Array.isArray(value))
      value.forEach(item => params.append(key, item));
    else if (value !== undefined)
      params.append(key, value);
  });
  var query = params.toString();
  return query ? `${target}${target.indexOf('?') >= 0 ? '&' : '?'}${query}` : target;
}

function preferredQuranTranslationFromCookie(req) {
  var alias = validQuranTranslationAlias(req.cookies && req.cookies.quranPreferredTranslationAlias);
  var translation = alias ? visibleQuranTranslationByAlias(alias) : null;
  return translation && ['default', 'local'].includes(translation.source) ? translation : null;
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

  if (isQuranReadingPath(req.path) && queryParams.has('translation')) {
    queryParams.delete('translation');
    shouldRedirect = true;
  }

  if (!shouldRedirect)
    return next();

  var queryString = queryParams.toString();
  var cleanUrl = req.originalUrl.substring(0, queryIndex);
  var redirectUrl = queryString ? `${cleanUrl}?${queryString}` : cleanUrl;
  return res.redirect(301, redirectUrl);
}

function redirectCanonicalHadithHeadingNumbers(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return next();

  var segments = req.path.split('/').filter(Boolean);
  if (segments.length < 2 || segments.length > 4)
    return next();
  var book = visibleBookFromParam(segments[0]);
  var bookType = book && (book.type || book.book_type || book.book_model || 'hadith');
  if (!book || book.alias === 'quran' || bookType !== 'hadith')
    return next();

  var canonicalSegments = segments.slice();
  var changed = false;
  for (var index = 1; index < canonicalSegments.length; index++) {
    var value = Arabic.toLatinDigits(canonicalSegments[index]);
    if (!/^(?:0|[1-9]\d*)\.\d+$/.test(value))
      continue;
    var canonicalValue = Utils.formatHadithHeadingNumber(value);
    if (canonicalValue !== value) {
      canonicalSegments[index] = canonicalValue;
      changed = true;
    }
  }
  if (!changed)
    return next();
  return res.redirect(301, `/${canonicalSegments.join('/')}${appendOriginalQuery(req)}`);
}

function isDefaultQuranPassagePath(path) {
  if (/^\/quran:[^/]+:[^/]+/.test(path))
    return true;

  var parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'quran' || parts.length !== 3)
    return false;

  return Boolean(findSurah(parts[1]));
}

function isQuranReadingPath(path) {
  if (isDefaultQuranPassagePath(path))
    return true;
  return /^\/quran\/\d+\/?$/.test(path)
    || /^\/quran\/[A-Za-z0-9_-]+\/\d+(?:\/\d+(?:\/\d+)?)?\/?$/.test(path);
}

function findSurah(ref) {
  return Surahs.find(ref);
}

function appendOriginalQuery(req) {
  var queryIndex = req.originalUrl.indexOf('?');
  return queryIndex >= 0 ? req.originalUrl.substring(queryIndex) : '';
}

function sendCachedHtml(req, res, cachedFile) {
  return Utils.sendCachedHtml(res, req, cachedFile, 'text/html; charset=UTF-8');
}

function cachedRenderLocals(res, locals) {
  return Object.assign(
    {},
    res.app ? res.app.locals : {},
    res.locals || {},
    locals || {}
  );
}

async function quranHeadingOutlinesForSurahs(surahNumbers) {
	return QuranHeadingOutlines.forSurahs(surahNumbers);
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
router.use(redirectCanonicalHadithHeadingNumbers);
router.use(redirectCanonicalQueryParams);

router.get(['/autocomplete', '/quran/autocomplete'], searchRequestLimiter, async function (req, res, next) {
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
      bookFilters = bookFilters.indexOf('quran') >= 0 ? ['quran', 'commentaries'] : ['commentaries'];
    var suggestions = await Search.a_autocomplete(q, bookFilters, req.query.limit, {
      tafsirAliases: tafsirFilters,
      excludeQuranAndTafsir: !quranSearchProxy
    });
    if (quranSearchProxy)
      suggestions = await Search.a_withQuranMushafPages(suggestions);
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
  const generation = await RuntimeRefresh.publish();
  debug(`published runtime refresh generation ${generation}`);
  await flushMasterDataCaches();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
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
  if (!flushCache && Utils.cachedTextPathForRead(cachedFile)) {
    const cachedText = Utils.readCachedTextFile(cachedFile);
    const cachedUrls = sitemapTextToUrls(cachedText);
    const siteUrls = sitemapUrlsForSite(cachedUrls, quranOnly);
    const requiredUrls = quranOnly ? quranRequiredSitemapUrlList(quranSitemapBaseUrl(req)) : [];
    const hasWrongSiteUrls = siteUrls.length !== cachedUrls.length;
    if (!hasWrongSiteUrls && !sitemapCacheNeedsRebuild(cachedUrls, requiredUrls))
      return siteUrls;
  }
  const cacheKey = quranOnly ? 'quran' : 'hadith';
  if (!sitemapBuilds.has(cacheKey)) {
    sitemapBuilds.set(cacheKey, buildAndCacheSitemap(req, cachedFile).finally(function () {
      sitemapBuilds.delete(cacheKey);
    }));
  }
  const txt = await sitemapBuilds.get(cacheKey);
  return sitemapUrlsForSite(sitemapTextToUrls(txt), quranOnly);
}

function sitemapUrlsForSite(urls, quranOnly) {
  if (quranOnly)
    return urls.filter(quranRelatedSitemapUrl);
  const commentaryAliases = new Set((global.commentaries || [])
    .filter(book => book && (book.type === 'tafsir' || book.type === 'trans'))
    .map(book => Utils.emptyIfNull(book.alias).toString()));
  return urls.filter(url => hadithSitemapUrl(url, commentaryAliases));
}

function quranRelatedSitemapUrl(url) {
  try {
    return new URL(url).pathname.startsWith('/quran');
  } catch (e) {
    return false;
  }
}

function hadithSitemapUrl(url, commentaryAliases) {
  try {
    const pathname = new URL(url).pathname;
    if (pathname.startsWith('/quran') || pathname === '/tafsir' || pathname.startsWith('/tafsir/'))
      return false;
    const firstSegment = decodeURIComponent(pathname.split('/')[1] || '').split(':')[0];
    return !commentaryAliases.has(firstSegment);
  } catch (e) {
    return false;
  }
}

async function buildAndCacheSitemap(req, cachedFile) {
  const txt = await buildSitemapText(req);
  if (Utils.diskCacheEnabled())
    fs.mkdirSync(`${homedir}/.hadithdb/cache`, { recursive: true });
  Utils.writeCachedTextFile(cachedFile, txt);
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

function sitemapCacheNeedsRebuild(urls, requiredUrls = []) {
  const urlSet = new Set(urls);
  return urls.some(url => !/^https?:\/\//i.test(url))
    || requiredUrls.some(url => !urlSet.has(url));
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
  const hadithBookAliases = Array.from(new Set((global.books || [])
    .filter(book => book && book.alias && book.alias !== 'quran' && !['tafsir', 'trans'].includes(book.type))
    .map(book => book.alias)));
  for (const alias of hadithBookAliases) {
    await Utils.flushCacheContaining(alias);
    await Utils.flushCacheContaining(`book:${alias}`);
  }
}

async function buildSitemapText(req) {
  var txt = '';
  var domain = global.settings.site.url;
  var quranDomain = quranSitemapBaseUrl(req);
  var quranOnly = Utils.isQuranSubdomainRequest(req);
  var bookSitemapFilter = quranOnly
    ? `b.alias = 'quran'`
    : `b.alias <> 'quran' AND COALESCE(b.type, 'hadith') = 'hadith'`;
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
    where ${bookSitemapFilter}
    union
    select b.alias, t.h1, t.h2 from toc t, books b
    where t.bookId = b.id and t.level < 3 and ${bookSitemapFilter}
    union
    select concat(b.alias, ':', num) as alias, null h1, null as h2 from hadiths h, books b
    where h.bookId = b.id and h.title_en is not null and ${bookSitemapFilter}
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
  if (quranOnly) {
    txt += quranPublicSitemapUrls(quranDomain);
    txt += await quranMushafSitemapUrls(quranDomain);
    txt += await quranCommentarySitemapUrls(quranDomain);
  }
  return txt;
}

function quranPublicSitemapUrlList(quranDomain) {
  return [
    `${quranDomain}/quran/review`,
    `${quranDomain}/quran/review?help`
  ];
}

function quranRequiredSitemapUrlList(quranDomain) {
  return quranPublicSitemapUrlList(quranDomain).concat(quranAyahRefs().map(function (ref) {
    return `${quranDomain}/quran/translations/quran:${ref.surah}:${ref.ayah}`;
  }));
}

function quranPublicSitemapUrls(quranDomain) {
  return quranPublicSitemapUrlList(quranDomain).map(url => `${url}\n`).join('');
}

async function quranMushafSitemapUrls(quranDomain) {
  const info = await QuranMushaf.info();
  const pageCount = Number(info && info.number_of_pages);
  if (!Number.isInteger(pageCount) || pageCount < 1)
    return '';
  return Array.from({ length: pageCount }, function (_, index) {
    return `${quranDomain}/quran/page/${index + 1}\n`;
  }).join('');
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
    urls.add(`${quranDomain}/quran/translations/quran:${ref.surah}:${ref.ayah}`);
  });
}

async function addQuranTafsirSitemapUrls(urls, quranDomain) {
  const tafsirs = await Tafsir.visibleTafsirs();
  const passagesByTafsir = [];
  for (let offset = 0; offset < tafsirs.length; offset += SITEMAP_COMMENTARY_CONCURRENCY) {
    const batch = tafsirs.slice(offset, offset + SITEMAP_COMMENTARY_CONCURRENCY);
    const passages = await Promise.all(batch.map(function (tafsir) {
      return Tafsir.sitemapPassages(tafsir, { source: 'db' });
    }));
    passagesByTafsir.push(...passages);
  }
  tafsirs.forEach(function (tafsir, index) {
    urls.add(`${quranDomain}${quranTafsirBookTocUrl(tafsir, tafsirs)}`);
    passagesByTafsir[index].forEach(function (passage) {
      urls.add(`${quranDomain}${Tafsir.passageUrl(tafsir, passage.surah, passage.ayah, passage.endAyah, tafsirs)}`);
    });
  });
}

function quranTafsirBookTocUrl(tafsir, tafsirs) {
  const slug = tafsir.slug || Tafsir.tafsirSlug(tafsir.alias);
  return `/quran/tafsir/${encodeURIComponent(slug)}`;
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
    if (filter === 'ninebooks') {
      expanded.push('bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah', 'malik', 'ahmad', 'darimi');
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
  if (filter === 'sahihayn' || filter === 'kutubarbaah' || filter === 'sixbooks' || filter === 'ninebooks')
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
  var commentaryBooks = Tafsir.visibleTafsirsSync().concat(Tafsir.visibleTranslationsSync());
  values.forEach(function (value) {
    var tafsir = commentaryBooks.find(function (row) {
      if (row.source !== 'local')
        return false;
      if (row.type === 'trans')
        return row.alias === value;
      return row.alias === value || row.slug === value || Tafsir.tafsirSlug(row.alias) === value;
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
  return Tafsir.visibleTafsirsSync().concat(Tafsir.visibleTranslationsSync()).filter(function (tafsir) {
    if (!tafsir || tafsir.source !== 'local' || !tafsir.alias || seen.has(tafsir.alias) || Number(tafsir.hidden) === 1)
      return false;
    seen.add(tafsir.alias);
    return true;
  }).map(function (tafsir) {
    return {
      alias: tafsir.alias,
      label: Tafsir.rawShortName(tafsir, 'en') || tafsir.shortName_en || tafsir.name_en || tafsir.alias,
      type: tafsir.type === 'trans' ? 'translation' : 'tafsir',
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
  var tafsir = Tafsir.visibleTafsirsSync().concat(Tafsir.visibleTranslationsSync()).find(row => row.alias === alias && Number(row.hidden) !== 1);
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
  res.setHeader('X-Robots-Tag', 'noindex, follow');
  var results = [];
  var totalResults = 0;
  var requestedOffset;

  try {
    requestedOffset = HttpRange.parseOffset(req.query.o);
  } catch (err) {
    return next(err);
  }

  req.query.q = Search.truncateQuery(req.query.q);
  if (options.forceBookFilters)
    req.query.b = options.forceBookFilters.slice();
  var tafsirFilters = options.quranSearchProxy ? normalizeRequestTafsirFilters(req) : [];
  if (!options.quranSearchProxy)
    delete req.query.tafsir;
  if (tafsirFilters.length > 0)
    req.query.b = normalizeBookFilterValues(req.query.b).indexOf('quran') >= 0 ? ['quran', 'commentaries'] : ['commentaries'];

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
    var offset = Math.max(0, requestedOffset);
    offset = Math.floor(offset / global.settings.search.itemsPerPage) * global.settings.search.itemsPerPage;
    results = await Search.a_searchText(req.query.q, effectiveBookFilters, offset, {
      tafsirAliases: tafsirFilters,
      excludeQuranAndTafsir: !options.quranSearchProxy
    });
    totalResults = Number.isFinite(results.total) ? results.total : results.length;
    var searchOffsetError = HttpRange.itemOffsetNotSatisfiable(requestedOffset, totalResults, 'Search results');
    if (searchOffsetError)
      return next(searchOffsetError);
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
router.get('/', throttleSearchRequest, async function (req, res, next) {
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
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method === 'OPTIONS')
    return res.sendStatus(204);
  next();
});

router.get('/quran/script/:script', async function (req, res, next) {
  var script = QuranScripts.normalizeSlug(req.params.script);
  if (!script)
    return next(createError(404, `Quran script '${req.params.script}' not found`));
  var refs = QuranScripts.normalizeRefs(req.query.refs);
  if (refs.length < 1)
    return next(createError(400, 'At least one valid Quran reference is required'));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(JSON.stringify(await QuranScripts.passage(script, refs)));
});

router.get(['/quran/corpus/:surah/:sectionNum', '/quran-corpus/:surah/:sectionNum'], async function (req, res, next) {
  var surah = findSurah(req.params.surah);
  if (!surah)
    return next(createError(404, `Surah '${req.params.surah}' not found`));
  var sectionNum = parsePositiveIntegerParam(req.params.sectionNum);
  if (!Number.isInteger(sectionNum))
	return next(createError(400, routeParameterMessage('sectionNum', req.params.sectionNum, 'Quran passage must be a positive integer')));
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
	return next(createError(404, `Quran passage ${surah.num}/${sectionNum} has no ayah range`));
  var startAyah = range.startAyah;
  var endAyah = startAyah + range.count - 1;
  var rows = await QuranCorpus.wordsForRange(surah.num, startAyah, endAyah);
  var wordsByAyah = QuranCorpus.wordsByAyah(rows);
  var requestedScript = (req.query.script || '').toString().trim().toLowerCase();
  if (requestedScript && requestedScript !== 'uthmani') {
    var script = QuranScripts.normalizeSlug(requestedScript);
    if (!script)
      return next(createError(400, `Unsupported Quran script '${requestedScript}'`));
    var refs = [];
    for (var ayah = startAyah; ayah <= endAyah; ayah++)
      refs.push(`${surah.num}:${ayah}`);
    var scriptPassage = await QuranScripts.passage(script, refs);
    Object.keys(scriptPassage.wordsByAyah).forEach(function (ref) {
      var sourceWords = scriptPassage.wordsByAyah[ref].slice();
      if (script === 'indo-pak' && sourceWords.length > 0 && /[\uE000-\uF8FF]/u.test(sourceWords[sourceWords.length - 1].text || ''))
        sourceWords.pop();
      var semanticWords = wordsByAyah[ref] || [];
      wordsByAyah[ref] = sourceWords.map(function (word, index) {
        return Object.assign({}, semanticWords[index] || {}, {
          word: word.word,
          text: word.text
        });
      });
    });
  }
  var juzStartsByAyah = {};
  (await QuranTocSubdivisions.juzRows()).forEach(function (juz) {
    var start = (juz.visual_start || juz.start || '').toString();
    var parts = start.split(':');
    if (Number(parts[0]) !== Number(surah.num))
      return;
    var juzStartAyah = Number(parts[1]);
    if (juzStartAyah < startAyah || juzStartAyah > endAyah)
      return;
    var title = (juz.title || '').toString().trim();
    juzStartsByAyah[start] = {
      num: Number(juz.num),
      title: title,
      wordCount: Math.max(1, title.split(/\s+/).filter(Boolean).length)
    };
  });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    surah: surah.num,
    h2: sectionNum,
    startAyah: startAyah,
    endAyah: endAyah,
    wordsByAyah: wordsByAyah,
    juzStartsByAyah: juzStartsByAyah
  }));
});

async function a_getPassage(surah, ayah1, ayah2, req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var requestedSurah = surah;
  ayah1 = parseQuranAyahParam(ayah1);
  ayah2 = parseQuranAyahParam(ayah2);
  surah = findSurah(surah);
  if (!surah) {
    var numericSurah = Number(Arabic.toLatinDigits((requestedSurah || '').toString()));
    if (Number.isInteger(numericSurah) && (numericSurah < 1 || numericSurah > quranSurahCount()))
      return next(HttpRange.notSatisfiable('quran-surahs', quranSurahCount(), `Quran surah ${requestedSurah} is out of range`));
    return next(createError(Number.isInteger(parsePositiveIntegerParam(requestedSurah)) ? 410 : 404, routeParameterMessage('surah', requestedSurah, 'Quran surah was not found')));
  }
  var ayahCount = quranAyahCount(surah);
  var minimumAyah = quranMinimumAyah(surah);
  if (!Number.isInteger(ayah1) || !Number.isInteger(ayah2) || ayah1 < minimumAyah || ayah2 < ayah1 || ayah2 > ayahCount) {
    var validPassageFormat = Number.isInteger(ayah1) && ayah1 >= minimumAyah && Number.isInteger(ayah2) && ayah2 >= ayah1;
    if (Number.isInteger(ayah1) && Number.isInteger(ayah2))
      return next(HttpRange.notSatisfiable('quran-ayahs', ayahCount, `Quran ayah range ${surah.num}:${ayah1}${ayah2 !== ayah1 ? `-${ayah2}` : ''} is out of range`));
    return next(createError(validPassageFormat ? 410 : 404, `Invalid route parameters 'ayah1=${req.params.ayah1 || ayah1}'${req.params.ayah2 ? ` and 'ayah2=${ayah2}'` : ''}: ayah range must be between 1 and ${ayahCount} for Quran ${surah.num}`));
  }
  var selectedAyahs = await Index.docsFromQueryString(Item.INDEX, `book_alias:quran AND h1:${surah.num} AND numInChapter:[${ayah1} TO ${ayah2}]`, 0, ayah2 - ayah1 + 1, 'numInChapter');
  selectedAyahs = selectedAyahs.map(item => new Item(item));
  var selectedTranslationAlias = validQuranTranslationAlias(req.quranSelectedTranslationAlias || req.query.translation);
  var selectedTranslation = selectedTranslationAlias ? visibleQuranTranslationByAlias(selectedTranslationAlias) : null;
  if (selectedTranslation && selectedTranslation.source === 'local') {
    await applySelectedQuranTranslation(selectedAyahs, selectedTranslation, surah.num);
    req.quranServerRenderedTranslationAlias = selectedTranslation.alias;
  }
  var results = selectedAyahs;
  var section;
  var chapter;
  var quranSubsections = [];
  if ('json' in req.query || 'md' in req.query) {
    res.setHeader('Content-Type', 'json' in req.query ? 'application/json' : 'text/markdown; charset=utf-8');
    if (selectedAyahs.length < 1)
      return res.end('json' in req.query ? JSON.stringify([]) : '');
    var sourceArabicRows = await query(
      `SELECT numInChapter, body, body_ar_alt
       FROM hadiths
       WHERE bookId = 0
         AND numInChapter BETWEEN ${ayah1} AND ${ayah2}
         AND num IN (${selectedAyahs.map(item => `'${surah.num}:${Number(item.numInChapter)}'`).join(', ')})`
    );
    var sourceArabicByAyah = new Map(sourceArabicRows.map(row => [Number(row.numInChapter), row]));
    selectedAyahs.forEach(item => {
      var sourceArabic = sourceArabicByAyah.get(Number(item.numInChapter));
      if (!sourceArabic)
        return;
      item.body = item.ar.body = sourceArabic.body;
      item.body_ar_alt = item.ar.body_alt = sourceArabic.body_ar_alt;
    });
    if (selectedAyahs.length === 1)
      await addQuranAdjacentRefs(selectedAyahs[0]);
    var ayahs_en = [];
    var ayahs = [];
    var original_ayahs = [];
    var footnotes_en = [];
    var footnotes = [];
    for (var i = 0; i < selectedAyahs.length; i++) {
      if (i == 0)
        ayahs_en.push(selectedAyahs[i].num + ' ' + selectedAyahs[i].en.body);
      else
        ayahs_en.push(Utils.regexExtract(selectedAyahs[i].num, /\d+:(\d+)/) + ' ' + selectedAyahs[i].en.body);
      var originalArabicBody = selectedAyahs[i].ar.body;
      var arabicJsonBody = selectedAyahs[i].body_ar_alt || originalArabicBody;
      ayahs.push(arabicJsonBody + ' ۝ ');
      original_ayahs.push(originalArabicBody + ' ۝ ');
      footnotes_en.push(Utils.regexExtract(selectedAyahs[i].num, /\d+:(\d+)'/) + ' ' + selectedAyahs[i].en.footnote);
      footnotes.push(Arabic.toArabicDigits(i) + ' ' + selectedAyahs[i].ar.footnote);
    }
    selectedAyahs[0].body_en = selectedAyahs[0].en.body = ayahs_en.join(' ').trim();
    selectedAyahs[0].body = selectedAyahs[0].ar.body = ayahs.join(' ').trim();
    selectedAyahs[0].body_ar_alt = selectedAyahs[0].ar.body_alt = original_ayahs.join(' ').trim();
    selectedAyahs[0].footnote_en = selectedAyahs[0].en.footnote = footnotes_en.join('\n').trim();
    selectedAyahs[0].footnote = selectedAyahs[0].ar.footnote = footnotes.join('\n').trim();
    if ('json' in req.query) {
      escapeQuranMarkdownFields(selectedAyahs[0]);
      return res.end(JSON.stringify([selectedAyahs[0]]));
    }
    return res.end(Utils.toMarkdown([selectedAyahs[0]]));
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
    var similarAyahs = [];
    var mutashabihatPhrases = [];
    const isSingleAyahPassage = ayah1 === ayah2 && selectedAyahs.length === 1;
    if (defaultPassage && isSingleAyahPassage) {
      [similarAyahs, mutashabihatPhrases] = await Promise.all([
        loadQuranSimilarAyahs(selectedAyahs[0], req),
        loadQuranMutashabihat(selectedAyahs[0], req)
      ]);
    }
    if (selectedAyahs.length < 1)
      return next(gone(`Route parameters 'surah=${surah.num}', 'ayah1=${ayah1}'${ayah2 !== ayah1 ? `, and 'ayah2=${ayah2}'` : ''} did not match any Quran ayat`));
    if (defaultPassage) {
      var quranSurahs = await getQuranSurahsFromIndex();
      var containingSections = await getQuranSectionsForAyahRange(surah.num, ayah1, ayah2, selectedAyahs[0]);
      if (containingSections.length > 0) {
        section = containingSections[0];
        section.mushafPage = await QuranMushaf.pageForRef(surah.num, ayah1);
        chapter = await section.getChapter();
        await chapter.getPrev();
        await chapter.getNext();
        await chapter.getSections();
        results = [];
        quranSubsections = [];
        for (const containingSection of containingSections) {
          var containingSubsections = await getQuranSectionSubsections(containingSection, { reconcileWithDb: !!(req.admin && req.editMode) });
          quranSubsections.push(...containingSubsections);
          results.push(...(await getQuranSectionPassageItems(containingSection, 0, 1000)));
        }
        await addQuranPassageBoundaryRefs(results);
      }
      if (selectedTranslation && selectedTranslation.source === 'local' && results !== selectedAyahs)
        await applySelectedQuranTranslation(results, selectedTranslation, surah.num);
      var quranHeadingOutlines = await quranHeadingOutlinesForSurahs([surah.num]);
      res.render('section_quran', {
        Tafsir: Tafsir,
        section: section,
        results: results,
        selectedAyah: (ayah1 == ayah2 && selectedAyahs.length > 0) ? selectedAyahs[0] : undefined,
        selectedAyahs: selectedAyahs,
        similarAyahs: similarAyahs,
        mutashabihatPhrases: mutashabihatPhrases,
        quranSubsections: quranSubsections,
        quranSurahs: quranSurahs,
        quranHeadingOutlines: quranHeadingOutlines
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
      if (!surah) {
        var requestedQuranSurah = Number(Arabic.toLatinDigits((toks[0] || '').toString()));
        if (Number.isInteger(requestedQuranSurah) && (requestedQuranSurah < 1 || requestedQuranSurah > quranSurahCount()))
          return next(HttpRange.notSatisfiable('quran-surahs', quranSurahCount(), `Quran surah ${toks[0]} is out of range`));
        return next(createError(404, `Surah '${toks[0]}' not found`));
      }
      if (!validQuranAyah(surah.num, num)) {
        var requestedQuranAyah = Number(Arabic.toLatinDigits((num || '').toString()));
        if (Number.isInteger(requestedQuranAyah))
          return next(HttpRange.notSatisfiable('quran-ayahs', quranAyahCount(surah), `Quran ayah ${surah.num}:${num} is out of range`));
        return next(createError(404, `Quran ayah ${surah.num}:${num} not found`));
      }
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
        if (!validQuranAyah(surah.num, req.params.num)) {
          var requestedAliasAyah = Number(Arabic.toLatinDigits((req.params.num || '').toString()));
          if (Number.isInteger(requestedAliasAyah))
            return next(HttpRange.notSatisfiable('quran-ayahs', quranAyahCount(surah), `Quran ayah ${surah.num}:${req.params.num} is out of range`));
          return next(createError(404, `Quran ayah ${surah.num}:${req.params.num} not found`));
        }
        return redirectCanonicalReferencePath(req, res, `/quran:${surah.num}:${req.params.num}`);
      }
      return next(createError(404, `Book '${req.params.bookAlias}' does not exist`));
    }
  }
  var results = await Index.docsFromKeyValue(Item.INDEX, { ref: `${req.params.bookAlias}:${req.params.num}` });
  if (results.length == 0) {
    results = await Index.docsFromKeyValue(Item.INDEX, { ref: `${req.params.bookAlias}:${req.params.num}a` });
    if (results.length == 0)
      return next(gone(`Item ${req.params.bookAlias}:${req.params.num} not found`));
  }

  results = results.map(item => new Item(item));
  results[0].single = true;
  if (results[0].book_alias !== 'quran') {
    results[0].hdithMetadata = await HdithMetadata.forHadith(results[0].actual ? results[0].actual.id : results[0].id);
    if (results[0].hdithMetadata)
      results[0].hdithMetadata.grades = HdithMetadata.withPrimaryGrade(results[0].hdithMetadata.grades, results[0]);
  }
  if (results[0].book_alias === 'quran')
    await addQuranAdjacentRefs(results[0]);
  if (results[0].book_alias === 'quran'
    && req.query.mushaf !== undefined
    && !('json' in req.query)
    && !('md' in req.query)) {
    var selectedSurah = Number(results[0].h1 || (results[0].num || '').toString().split(/:/)[0]);
    var selectedAyah = Number(results[0].numInChapter || (results[0].num || '').toString().split(/:/).pop());
    var selectedPage = await QuranMushaf.pageForRef(selectedSurah, selectedAyah);
    if (!Number.isInteger(selectedPage))
      return next(createError(404, `A Mushaf page was not found for Quran ayah ${selectedSurah}:${selectedAyah}`));
    return res.redirect(302, Utils.quranUrl(req, `/quran/page/${selectedPage}?ayah=${selectedSurah}:${selectedAyah}`));
  }
  if (results[0].book_alias === 'quran' && ('json' in req.query || 'md' in req.query)) {
    var sourceArabicRows = await query(
      `SELECT body, body_ar_alt
       FROM hadiths
       WHERE bookId = 0
         AND id = ${Number(results[0].id)}
       LIMIT 1`
    );
    if (sourceArabicRows.length > 0) {
      var sourceArabic = sourceArabicRows[0];
      results[0].body = results[0].ar.body = sourceArabic.body_ar_alt || sourceArabic.body;
      results[0].body_ar_alt = results[0].ar.body_alt = sourceArabic.body;
    }
    if ('json' in req.query) {
      escapeQuranMarkdownFields(results[0]);
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(results));
    }
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    return res.end(Utils.toMarkdown(results));
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
        res.redirect(301, cleanUrl || `/${results[0].ref}`);
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
  var selectedSurah = Number(selectedAyah.h1 || (selectedAyah.num || '').toString().split(/:/)[0]);
  var selectedAyahNumber = Number(selectedAyah.numInChapter || (selectedAyah.num || '').toString().split(/:/).pop());
  section.mushafPage = await QuranMushaf.pageForRef(selectedSurah, selectedAyahNumber);
  await addQuranAdjacentRefs(selectedAyah);
  var chapter = await section.getChapter();
  await Promise.all([
    applySameBookHeadingNavigation(section),
    chapter.getPrev(),
    chapter.getNext(),
    chapter.getSections()
  ]);
  var quranSubsections = await getQuranSectionSubsections(section, { reconcileWithDb: !!(req.admin && req.editMode) });
  var results = await getQuranSectionPassageItems(section, 0, 1000);
  await addQuranPassageBoundaryRefs(results);
  var quranSurahs = await getQuranSurahsFromIndex();
  var quranHeadingOutlines = await quranHeadingOutlinesForSurahs([selectedSurah]);
  var [similarAyahs, mutashabihatPhrases] = await Promise.all([
    loadQuranSimilarAyahs(selectedAyah, req),
    loadQuranMutashabihat(selectedAyah, req)
  ]);

  res.render('section_quran', {
    Tafsir: Tafsir,
    section: section,
    results: results,
    selectedAyah: selectedAyah,
    selectedAyahs: [selectedAyah],
    similarAyahs: similarAyahs,
    mutashabihatPhrases: mutashabihatPhrases,
    quranSubsections: quranSubsections,
    quranSurahs: quranSurahs,
    quranHeadingOutlines: quranHeadingOutlines
  });
}

async function loadQuranSimilarAyahs(selectedAyah, req) {
  var rows = await QuranSimilarAyahs.forAyah(selectedAyah);
  var items = rows.map(row => new Item(row));
  var selectedTranslationAlias = validQuranTranslationAlias(req.quranSelectedTranslationAlias || req.query.translation);
  var selectedTranslation = selectedTranslationAlias ? visibleQuranTranslationByAlias(selectedTranslationAlias) : null;
  if (!selectedTranslation || selectedTranslation.source !== 'local')
    return items;
  var bySurah = new Map();
  items.forEach(function (item) {
    var surah = Number((item.num || '').toString().split(':')[0]);
    if (!Number.isInteger(surah))
      return;
    if (!bySurah.has(surah))
      bySurah.set(surah, []);
    bySurah.get(surah).push(item);
  });
  await Promise.all(Array.from(bySurah.entries()).map(function ([surah, ayahs]) {
    return applySelectedQuranTranslation(ayahs, selectedTranslation, surah, { dbFallbackOnUnavailable: false });
  }));
  return items;
}

async function loadQuranMutashabihat(selectedAyah, req) {
  var phrases = await QuranMutashabihat.forAyah(selectedAyah);
  var itemsById = new Map();
  phrases.forEach(function (phrase) {
    phrase.matches.forEach(function (match) {
      var item = new Item(match.document);
      match.item = item;
      var id = Number(item.hId || item.id);
      if (Number.isInteger(id))
        itemsById.set(id, item);
    });
  });
  var selectedTranslationAlias = validQuranTranslationAlias(req.quranSelectedTranslationAlias || req.query.translation);
  var selectedTranslation = selectedTranslationAlias ? visibleQuranTranslationByAlias(selectedTranslationAlias) : null;
  if (selectedTranslation && selectedTranslation.source === 'local') {
    var bySurah = new Map();
    itemsById.forEach(function (item) {
      var surah = Number((item.num || '').toString().split(':')[0]);
      if (!Number.isInteger(surah))
        return;
      if (!bySurah.has(surah))
        bySurah.set(surah, []);
      bySurah.get(surah).push(item);
    });
    await Promise.all(Array.from(bySurah.entries()).map(function ([surah, ayahs]) {
      return applySelectedQuranTranslation(ayahs, selectedTranslation, surah, { dbFallbackOnUnavailable: false });
    }));
  }
  return phrases;
}

function escapeQuranMarkdownFields(item) {
  ['body', 'body_ar_alt', 'body_en', 'footnote', 'footnote_en'].forEach(field => {
    item[field] = Utils.escapeMarkdownText(item[field]);
  });
  if (item.ar) {
    ['body', 'body_alt', 'footnote'].forEach(field => {
      item.ar[field] = Utils.escapeMarkdownText(item.ar[field]);
    });
  }
  if (item.en) {
    ['body', 'footnote'].forEach(field => {
      item.en[field] = Utils.escapeMarkdownText(item.en[field]);
    });
  }
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

async function getQuranSurahRangeHeadingsFromIndex(surah, options = {}) {
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
    if (options.reconcileWithDb === true)
      docs = await attachQuranRawHeadingRanges(surah, docs);
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

async function attachQuranRawHeadingRanges(surah, docs) {
  if (!Array.isArray(docs) || docs.length < 1 || !Number.isInteger(Number(surah)))
    return docs;
  try {
    var rows = await global.query(`SELECT t.id, t.level, t.start, t.end, t.start0, t.end0, t.count
      FROM toc t
      JOIN books b ON b.id=t.bookId
      WHERE b.alias='quran' AND t.h1=${Number(surah)} AND t.level IN (2, 3)`);
    var rangesById = new Map(rows.map(row => [Number(row.id), row]));
    return docs.map(doc => {
      var range = rangesById.get(Number(doc.tId || doc.hId || doc.id));
      if (!range)
        return null;
      var derivedCount = quranHeadingRangeCount(range.start, range.end);
      var count = Number.isInteger(derivedCount) && derivedCount > 0
        ? derivedCount
        : parseInt(range.count, 10);
      var levelPrefix = `h${Number(range.level)}`;
      doc.start = range.start;
      doc.end = range.end;
      doc.start0 = range.start0;
      doc.end0 = range.end0;
      doc.count = count;
      doc[`${levelPrefix}_start`] = range.start;
      doc[`${levelPrefix}_end`] = range.end;
      doc[`${levelPrefix}_count`] = count;
      return doc;
    }).filter(Boolean);
  } catch (err) {
    debug.error(`Quran raw heading range lookup failed for surah ${surah}: ${err.message}\n${err.stack || ''}`);
    return docs;
  }
}

async function attachQuranRawHeadingRangeToHeading(heading) {
  if (!heading || heading.book_alias !== 'quran' || ![2, 3].includes(Number(heading.level)))
    return heading;
  var headingId = Number(heading.tId || heading.hId || heading.id);
  if (!Number.isInteger(headingId) || headingId <= 0)
    return heading;
  try {
    var row = (await global.query(`SELECT id, level, start, end, start0, end0, count
      FROM toc
      WHERE id=${headingId}
      LIMIT 1`))[0];
    if (!row)
      return heading;
    var derivedCount = quranHeadingRangeCount(row.start, row.end);
    var count = Number.isInteger(derivedCount) && derivedCount > 0
      ? derivedCount
      : parseInt(row.count, 10);
    var levelPrefix = `h${Number(row.level)}`;
    heading.start = row.start;
    heading.end = row.end;
    heading.start0 = row.start0;
    heading.end0 = row.end0;
    heading.count = count;
    heading[`${levelPrefix}_start`] = row.start;
    heading[`${levelPrefix}_end`] = row.end;
    heading[`${levelPrefix}_count`] = count;
  } catch (err) {
    debug.error(`Quran raw heading range lookup failed for heading ${headingId}: ${err.message}\n${err.stack || ''}`);
  }
  return heading;
}

function quranHeadingRangeCount(start, end) {
  var startAyah = quranAyahFromHeadingStart(start);
  var endAyah = quranAyahFromHeadingStart(end);
  return Number.isInteger(startAyah) && Number.isInteger(endAyah) && endAyah >= startAyah
    ? endAyah - startAyah + 1
    : NaN;
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
  var endAyah = quranAyahFromHeadingStart(heading.end);
  if (!Number.isInteger(startAyah))
    return false;
  if (!Number.isInteger(endAyah) && Number.isInteger(count) && count > 0)
    endAyah = startAyah + count - 1;
  if (!Number.isInteger(endAyah) || endAyah < startAyah)
    return false;
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
  var endAyah = quranAyahFromHeadingStart(section.end);
  if (!Number.isInteger(endAyah) && Number.isInteger(startAyah) && Number.isInteger(count) && count > 0)
    endAyah = startAyah + count - 1;

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

async function getQuranSectionSubsections(section, options = {}) {
  if (!section || section.book_alias !== 'quran' || parseInt(section.level, 10) !== 2)
    return [];
  if (Array.isArray(section.quranSubsections))
    return section.quranSubsections;
  var headings = await getQuranSurahRangeHeadingsFromIndex(Number(section.h1), options);
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
    quranCommentaryBook = Tafsir.visibleTranslationsSync().find(function (commentaryBook) {
      return commentaryBook && commentaryBook.alias === req.query.translation;
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

router.get('/quran', throttleSearchRequest, async function (req, res, next) {
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

async function quranReviewHeaderJuzLinks(req) {
  const rows = await QuranTocSubdivisions.juzRows();
  return (await Promise.all(rows.map(async function (juz) {
    const parts = (juz.start || '').toString().split(':');
    const pageNumber = await QuranMushaf.pageForRef(Number(parts[0]), Number(parts[1]));
    if (!Number.isInteger(pageNumber)) return null;
    return {
      num: Number(juz.num),
      title: juz.title,
      href: Utils.quranUrl(req, `/quran/page/${pageNumber}`)
    };
  }))).filter(Boolean);
}

router.get('/quran/review', async function (req, res) {
  res.locals.req = req;
  res.locals.res = res;
  res.setHeader('Cache-Control', 'private, no-store');
  const helpView = req.query.help !== undefined;
  const startReview = !helpView && (req.query.start !== undefined || req.query.continue !== undefined);
  if (startReview)
    res.setHeader('X-Robots-Tag', 'noindex, follow');
  const quranHeaderJuzLinks = await quranReviewHeaderJuzLinks(req);
  res.render(startReview ? 'quran_review' : 'quran_memorization_pages', {
    quranHeaderJuzLinks: quranHeaderJuzLinks,
    page: {
      menu: 'Quran',
      title_en: startReview ? 'Mudhakkir Quran Recall' : 'Mudhakkir: Keep your Quran hifz fresh',
      subtitle_en: startReview ? ' Quran Recall Test' : 'Quran Hifz',
      description_en: startReview
        ? 'Strengthen memorized Quran ayat with focused recall and adaptive spaced repetition that responds to your answers.'
        : (helpView
          ? 'Mudhakkir helps you memorize the Quran ayah by ayah with focused Mushaf practice, adaptive spaced repetition, review scheduling, and progress tracking.'
          : 'View your Quran memorization progress, due ayat, recent activity, and adaptive review schedule.'),
      canonical: helpView ? '/quran/review?help' : '/quran/review',
      noindex: startReview,
      context: { quranSearchProxy: true }
    }
  });
});

router.get('/quran/memorization-pages', function (req, res) {
  res.redirect(301, Utils.quranUrl(req, '/quran/review'));
});

router.get('/quran/progress', function (req, res) {
  res.redirect(301, Utils.quranUrl(req, '/quran/review'));
});

async function renderQuranMushafPage(req, res, next, options) {
  var reviewRef = normalizeQuranReviewRef(req.query.reviewRef) || normalizeQuranReviewRef(req.query.review);
  var review = req.query.review !== undefined || Boolean(reviewRef);
  var memorize = req.query.memorize !== undefined || review;
  var pageNumber = Number(options.pageNumber);
  var redundantReviewQuery = reviewRef && (
    req.query.reviewRef !== undefined
    || req.query.memorize !== undefined
    || req.query.reviewState !== undefined
    || req.query.review === ''
    || req.query.reviewMode !== undefined
    || req.query.reviewPrevious !== undefined
    || req.query.reviewNext !== undefined
  );
  if (redundantReviewQuery)
    return res.redirect(302, Utils.quranUrl(req, `/quran/page/${pageNumber}?${compactQuranReviewQuery(req, reviewRef)}`));
  if (review)
    res.setHeader('Cache-Control', 'private, no-store');
  else if (Utils.shouldFlushCache(req))
    res.setHeader('Cache-Control', 'no-store');
  var mushaf = await QuranMushaf.page(pageNumber);
  if (!mushaf)
    return next(createError(404, `Mushaf page '${pageNumber}' not found`));
  var selectedAyahRef = /^\d+:\d+$/.test((req.query.ayah || '').toString()) ? req.query.ayah.toString() : '';
  if (selectedAyahRef && !mushaf.lines.some(function (line) {
    return (line.words || []).some(function (word) { return `${word.surah}:${word.ayah}` === selectedAyahRef; });
  }))
    selectedAyahRef = '';
  var previousMushaf = review && pageNumber > 1
    ? await QuranMushaf.page(pageNumber - 1)
    : null;
  var reviewPreviousLines = previousMushaf
    ? previousMushaf.lines.filter(function (line) {
      return line.line_type === 'ayah' && Array.isArray(line.words) && line.words.length > 0;
    }).slice(-3)
    : [];
  var juzStarts = {};
  var juzRows = await QuranTocSubdivisions.juzRows();
  juzRows.forEach(function (juz) {
    var ref = (juz.visual_start || juz.start || '').toString();
    if (!ref)
      return;
    juzStarts[ref] = {
      num: Number(juz.num),
      wordCount: Math.max(1, (juz.title || '').toString().trim().split(/\s+/).filter(Boolean).length)
    };
  });
  Object.keys(juzStarts).forEach(function (ref) {
    var start = juzStarts[ref];
    var words = mushaf.lines.flatMap(line => line.words || []).filter(function (word) {
      return !word.is_ayah_marker && `${word.surah}:${word.ayah}` === ref;
    });
    words.slice(0, start.wordCount).forEach(function (word, index) {
      word.juzStart = start.num;
      word.juzStartFirst = index === 0;
    });
  });
  var sectionRangesBySurah = await QuranTocSubdivisions.quranSectionRangesBySurah();
  var subsectionRangesBySurah = await QuranTocSubdivisions.quranSubsectionRangesBySurah();
  var passageToneBySubsection = {};
  var subsectionIndex = 0;
  Object.keys(subsectionRangesBySurah).map(Number).sort(function (a, b) { return a - b; }).forEach(function (surah) {
    subsectionRangesBySurah[surah].forEach(function (range) {
      passageToneBySubsection[`${surah}:${range.section}:${range.subsection}`] = subsectionIndex % 2;
      subsectionIndex += 1;
    });
  });
  [mushaf, previousMushaf].filter(Boolean).flatMap(function (page) {
    return page.lines.flatMap(line => line.words || []);
  }).forEach(function (word) {
    var ranges = subsectionRangesBySurah[Number(word.surah)] || [];
    var range = ranges.find(function (candidate) {
      return Number(word.ayah) >= candidate.start && Number(word.ayah) <= candidate.end;
    });
    if (range)
      word.passageTone = passageToneBySubsection[`${word.surah}:${range.section}:${range.subsection}`];
  });
  var firstWord = mushaf.lines.flatMap(line => line.words || []).find(word => !word.is_ayah_marker);
  var mushafSurahs = mushaf.lines.flatMap(line => line.words || []).map(function (word) {
    return Number(word.surah);
  });
  var quranHeadingOutlines = await quranHeadingOutlinesForSurahs(mushafSurahs);
  var firstSurah = firstWord && (global.surahs || []).find(function (surah) {
    return Number(surah.num) === Number(firstWord.surah);
  });
  var firstJuz = firstWord && juzRows.slice().sort(function (a, b) { return Number(a.num) - Number(b.num); }).filter(function (juz) {
    var parts = (juz.start || '').toString().split(':');
    var startSurah = Number(parts[0]);
    var startAyah = Number(parts[1]);
    return startSurah < Number(firstWord.surah) || (startSurah === Number(firstWord.surah) && startAyah <= Number(firstWord.ayah));
  }).pop();
  var quranHeaderJuzLinks = (await Promise.all(juzRows.map(async function (juz) {
    var startParts = (juz.start || '').toString().split(':');
    var startSurah = Number(startParts[0]);
    var startAyah = Number(startParts[1]);
    var startPage = await QuranMushaf.pageForRef(startSurah, startAyah);
    if (!Number.isInteger(startPage))
      return null;
    return {
      num: Number(juz.num),
      title: juz.title,
      href: Utils.quranUrl(req, `/quran/page/${startPage}`),
      startPage: startPage,
      current: !!firstJuz && Number(firstJuz.num) === Number(juz.num)
    };
  }))).filter(Boolean);
  quranHeaderJuzLinks.forEach(function (juz, index) {
    var nextJuz = quranHeaderJuzLinks[index + 1];
    juz.endPage = nextJuz ? nextJuz.startPage - 1 : Number(mushaf.info.number_of_pages);
    if (juz.current) {
      var completedPages = Math.max(1, pageNumber - juz.startPage + 1);
      var totalPages = Math.max(1, juz.endPage - juz.startPage + 1);
      juz.progress = Math.max(0, Math.min(100, Math.round((completedPages / totalPages) * 100)));
    }
  });
  var audioRanges = [];
  mushaf.lines.flatMap(line => line.words || []).forEach(function (word) {
    var surah = Number(word.surah);
    var ayah = Number(word.ayah);
    if (!Number.isInteger(surah) || !Number.isInteger(ayah))
      return;
    var range = audioRanges[audioRanges.length - 1];
    if (!range || range.surah !== surah) {
      audioRanges.push({ surah: surah, from: ayah, to: ayah });
      return;
    }
    range.from = Math.min(range.from, ayah);
    range.to = Math.max(range.to, ayah);
  });
  var subsectionAudioRanges = [];
  var subsectionAudioRangeKeys = new Set();
  var pagePassages = [];
  var pagePassagesByKey = new Map();
  var pageSubsectionKeys = new Set();
  mushaf.lines.flatMap(line => line.words || []).forEach(function (word) {
    var surah = Number(word.surah);
    var ayah = Number(word.ayah);
    var sectionRange = (sectionRangesBySurah[surah] || []).find(function (candidate) {
      return ayah >= candidate.start && ayah <= candidate.end;
    });
    if (sectionRange) {
      var passageKey = `${surah}:${sectionRange.section}`;
      var passageStartAyah = Math.max(1, sectionRange.start);
      var passageStartsHere = ayah === passageStartAyah;
      var startingSubsections = (subsectionRangesBySurah[surah] || []).filter(function (subsection) {
        return subsection.section === sectionRange.section && ayah === Math.max(1, subsection.start);
      });
      if (passageStartsHere || startingSubsections.length > 0) {
        var pagePassage = pagePassagesByKey.get(passageKey);
        if (!pagePassage) {
          pagePassage = {
          surah: surah,
          section: sectionRange.section,
          title_en: sectionRange.title_en,
          title: sectionRange.title,
            showPassageTitle: passageStartsHere,
            subsections: []
          };
          pagePassagesByKey.set(passageKey, pagePassage);
          pagePassages.push(pagePassage);
        } else if (passageStartsHere) {
          pagePassage.showPassageTitle = true;
        }
        startingSubsections.forEach(function (subsection) {
          var subsectionKey = `${surah}:${subsection.section}:${subsection.subsection}`;
          if (!pageSubsectionKeys.has(subsectionKey)) {
            pageSubsectionKeys.add(subsectionKey);
            pagePassage.subsections.push({
              surah: surah,
              section: subsection.section,
              subsection: subsection.subsection,
              start: subsection.start,
              title_en: subsection.title_en,
              title: subsection.title
            });
          }
        });
      }
    }
    var range = (subsectionRangesBySurah[surah] || []).find(function (candidate) {
      return ayah >= candidate.start && ayah <= candidate.end;
    });
    if (!range)
      return;
    var key = `${surah}:${range.section}:${range.subsection}`;
    if (subsectionAudioRangeKeys.has(key))
      return;
    subsectionAudioRangeKeys.add(key);
    subsectionAudioRanges.push({
      surah: surah,
      from: Math.max(1, range.start),
      to: range.end,
      section: range.section,
      subsection: range.subsection
    });
  });
  var sectionAudioRangeKeys = new Set();
  mushaf.lines.flatMap(line => line.words || []).forEach(function (word) {
    var surah = Number(word.surah);
    var ayah = Number(word.ayah);
    var range = (sectionRangesBySurah[surah] || []).find(function (candidate) {
      return ayah >= candidate.start && ayah <= candidate.end;
    });
    if (!range)
      return;
    var key = `${surah}:${range.section}`;
    if (sectionAudioRangeKeys.has(key))
      return;
    sectionAudioRangeKeys.add(key);
    subsectionAudioRanges.push({
      surah: surah,
      from: Math.max(1, range.start),
      to: range.end,
      section: range.section
    });
  });
  var pageContext = {
    book: options.book,
    chapter: options.chapter,
    section: options.section,
    passage: true
  };
  var firstPageAudioRange = audioRanges[0];
  var lastPageAudioRange = audioRanges[audioRanges.length - 1];
  var pageAyahRange = firstPageAudioRange && lastPageAudioRange
    ? `${firstPageAudioRange.surah}:${firstPageAudioRange.from}-${lastPageAudioRange.surah}:${lastPageAudioRange.to}`
    : '';
  var mushafPageTitle = review
    ? `Mudhakkir ${reviewRef || pageAyahRange || `Page ${pageNumber}`} | Mushaf Page ${pageNumber}`
    : `Quran ${memorize ? 'Practice' : 'Mushaf'} Page ${pageNumber}${pageAyahRange ? ` | Ayat ${pageAyahRange}` : ''}`;
  var mushafPageDescription = review
    ? `Strengthen your recall of Quran ${reviewRef || pageAyahRange || `page ${pageNumber}`} in the Digital Khatt Mushaf with adaptive spaced repetition.`
    : (memorize
      ? `Practice memorizing Quran page ${pageNumber}${pageAyahRange ? `, ayat ${pageAyahRange}` : ''}, in the 15-line Digital Khatt Mushaf with focused hide-and-reveal controls.`
      : `Read Quran page ${pageNumber}${pageAyahRange ? `, ayat ${pageAyahRange}` : ''}, in the 15-line Digital Khatt Arabic Mushaf.`);
  if (review)
    res.setHeader('X-Robots-Tag', 'noindex, follow');
  var renderLocals = {
    memorize: memorize,
    review: review,
    reviewRef: reviewRef,
    reviewRetry: req.query.reviewRetry !== undefined,
    reviewPreviousLines: reviewPreviousLines,
    selectedAyahRef: selectedAyahRef,
    mushaf: mushaf,
    audioRanges: audioRanges,
    subsectionAudioRanges: subsectionAudioRanges,
    pagePassages: pagePassages,
    firstRef: firstWord ? `${firstWord.surah}:${firstWord.ayah}` : '',
    firstSurah: firstSurah,
    firstJuz: firstJuz,
    quranHeaderJuzLinks: quranHeaderJuzLinks,
    quranHeadingOutlines: quranHeadingOutlines,
    page: {
      menu: 'Section',
      title_en: mushafPageTitle,
      subtitle_en: `Page ${pageNumber}`,
      description_en: mushafPageDescription,
      canonical: review ? '/quran/review' : `/quran/page/${pageNumber}${memorize ? '?memorize' : ''}`,
      noindex: review,
      context: pageContext
    }
  };
  if (options.cachedFile && Utils.diskCacheEnabled()) {
    var html = await ejs.renderFile(`${__dirname}/../views/quran_mushaf.ejs`, cachedRenderLocals(res, {
      noadmin: true,
      ...renderLocals
    }));
    Utils.writeCachedHtml(options.cachedFile, html);
    await Utils.indexCachedItem([
      'quran',
      'book:quran',
      `quran:page:${pageNumber}`,
      ...Array.from(new Set(mushafSurahs.filter(Number.isInteger))).map(surah => `quran:surah:${surah}`)
    ], options.cachedFile);
    if (sendCachedHtml(req, res, options.cachedFile))
      return;
  }
  return res.render('quran_mushaf', renderLocals);
}

function quranMushafDiskCacheable(req) {
  var query = req.query || {};
  var hasMemorize = Object.prototype.hasOwnProperty.call(query, 'memorize');
  var hasReviewState = Object.keys(query).some(function (key) {
    return key === 'review' || key.startsWith('review');
  });
  return !(req.admin && req.editMode) && !hasMemorize && !hasReviewState;
}

function quranMushafCacheFile(req, pageNumber) {
  var requestUrl = (req.url || '').toString();
  var queryIndex = requestUrl.indexOf('?');
  var normalizedReq = {
    ...req,
    url: `/quran/page/${pageNumber}${queryIndex >= 0 ? requestUrl.slice(queryIndex) : ''}`
  };
  var filename = Utils.cacheReqToFilename(normalizedReq);
  filename += `__script-${quranMushafScript(req)}`;
  var selectedAyahRef = /^\d+:\d+$/.test((req.query.ayah || '').toString())
    ? req.query.ayah.toString()
    : '';
  if (selectedAyahRef)
    filename += `__ayah-${Utils.safeFilename(selectedAyahRef)}`;
  return Utils.cacheFileFromFilename(filename, 'html');
}

function quranMushafScript(req) {
  var script = (req.cookies && req.cookies.quranScript || '').toString().trim().toLowerCase();
  return ['uthmani', 'indo-pak', 'warsh'].includes(script) ? script : 'uthmani';
}

router.get('/quran/page', async function (req, res) {
  var pageNumber = 1;
  res.setHeader('Cache-Control', 'private, no-store');
  var bookmarkedPage = parsePositiveIntegerParam(req.cookies && req.cookies.quranMushafBookmarkPage);
  if (Number.isInteger(bookmarkedPage) && bookmarkedPage <= 604)
    pageNumber = bookmarkedPage;
  try {
    var user = await GoogleAuth.verifyRequest(req, { allowSession: true });
    if (user) {
      var settings = await UserSettings.getSettings(user.uid);
      var authenticatedBookmark = settings && settings.bookmarks && settings.bookmarks.mushafPage;
      if (Number.isInteger(authenticatedBookmark) && authenticatedBookmark >= 1 && authenticatedBookmark <= 604)
        pageNumber = authenticatedBookmark;
    }
  } catch (err) {
    debug(`Could not resolve the Mushaf bookmark: ${err.message}`);
  }
  return res.redirect(302, Utils.quranUrl(req, `/quran/page/${pageNumber}${req.query.memorize !== undefined ? '?memorize' : ''}`));
});

router.get('/quran/page/:page', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var pageNumber = parsePositiveIntegerParam(req.params.page);
  var numericPage = Number(Arabic.toLatinDigits((req.params.page || '').toString()));
  var mushafInfo = Number.isInteger(numericPage) ? await QuranMushaf.info() : null;
  var mushafPageCount = Number(mushafInfo && mushafInfo.number_of_pages);
  if (Number.isInteger(numericPage) && Number.isInteger(mushafPageCount) && (numericPage < 1 || numericPage > mushafPageCount))
    return next(HttpRange.notSatisfiable('quran-pages', mushafPageCount, `Mushaf page ${req.params.page} is out of range`));
  if (!Number.isInteger(pageNumber))
    return next(createError(400, routeParameterMessage('page', req.params.page, 'Mushaf page must be a positive integer')));
  var cacheableMushafPage = quranMushafDiskCacheable(req);
  var cachedFile = cacheableMushafPage ? quranMushafCacheFile(req, pageNumber) : null;
  var flushCache = Utils.shouldFlushCache(req);
  if (flushCache) {
    invalidateQuranMemoryCaches({ mushafPage: pageNumber });
    var mushafFlushes = [Utils.flushCacheContaining(`quran:page:${pageNumber}`)];
    if (cachedFile)
      mushafFlushes.push(Utils.flushCachedFile(cachedFile, { strict: true }));
    await Promise.all(mushafFlushes);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  if (cachedFile && !flushCache && Utils.cachedTextPathForRead(cachedFile)) {
    if (sendCachedHtml(req, res, cachedFile))
      return;
    await Utils.flushCachedFile(cachedFile);
  }
  var mappedSection = await QuranMushaf.sectionForPage(pageNumber);
  if (!mappedSection)
	return next(createError(404, `A Quran passage was not found for Mushaf page ${pageNumber}`));
  var book = visibleBookByAlias('quran');
  var section = Number(mappedSection.level) === 2
    ? Heading.toLevel(mappedSection)
    : await Section.sectionFromRef(`quran/${mappedSection.surah}/${mappedSection.h2}`);
  await section.getPrev();
  await section.getNext();
  var chapter = await section.getChapter();
  await chapter.getPrev();
  await chapter.getNext();
  await chapter.getSections();
  section.mushafPage = pageNumber;
  return renderQuranMushafPage(req, res, next, {
    pageNumber: pageNumber,
    book: book,
    chapter: chapter,
    section: section,
    cachedFile: cachedFile
  });
});

// BOOK: TABLE OF CONTENTS
router.get('/:bookAlias', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var books = (global.books || []).filter(function (book) {
    var type = book && (book.type || book.book_type || book.book_model || 'hadith');
    return book
      && Number(book.hidden) === 0
      && book.alias !== 'quran'
      && type === 'hadith';
  });
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
    if (bookIdx >= 0 && bookIdx < (books.length - 1))
      nextBook = books[bookIdx + 1];

    var admin = req.admin;
    var editMode = admin && req.editMode;
    var cacheableHtml = !('download' in req.query) && !('json' in req.query) && !('tsv' in req.query) && !('epub' in req.query);
    const quranTocDefaultView = req.params.bookAlias === 'quran'
      ? (req.query.toc || req.query.view || req.query.tab || 'juz')
      : 'surahs';
    var cachedFile = Utils.htmlCacheFile(req);
    const flushCache = Utils.shouldFlushCache(req);
    if (flushCache && req.params.bookAlias === 'quran')
      invalidateQuranMemoryCaches({ allMushaf: true });
    if (flushCache)
      await Promise.all([
        Utils.flushCachedFile(cachedFile, { strict: true }),
        req.params.bookAlias === 'quran'
          ? Promise.all([
            flushQuranTocDiskCacheVariants(),
            Utils.flushCacheContaining('quran'),
            Utils.flushCacheContaining('book:quran')
          ])
          : Promise.resolve()
      ]);
    if (flushCache) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    if (cacheableHtml && !flushCache && !editMode && Utils.cachedTextPathForRead(cachedFile)) {
      if (sendCachedHtml(req, res, cachedFile))
        return;
      await Utils.flushCachedFile(cachedFile);
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
      var quranJuzRows = book.alias === 'quran' ? await QuranTocSubdivisions.juzRows() : [];
      var quranManzilRows = book.alias === 'quran' ? await QuranTocSubdivisions.manzilRows() : [];
      var quranSectionRangesBySurah = book.alias === 'quran' ? await QuranTocSubdivisions.quranSectionRangesBySurah() : {};
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
        if (Utils.diskCacheEnabled())
          fs.mkdirSync(`${homedir}/.hadithdb/cache`, { recursive: true });
        var refs = [book.alias, `book:${book.alias}`];
        if (book.alias === 'quran')
          refs.push('quran:navigation-tocs');
        var html = await ejs.renderFile(`${__dirname}/../views/toc.ejs`, cachedRenderLocals(res, {
          noadmin: true,
          book: book,
          surahs: global.surahs || [],
          quranJuzRows: quranJuzRows,
          quranManzilRows: quranManzilRows,
          quranSectionRangesBySurah: quranSectionRangesBySurah,
          quranTocDefaultView: quranTocDefaultView,
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
        surahs: global.surahs || [],
        quranJuzRows: quranJuzRows,
        quranManzilRows: quranManzilRows,
        quranSectionRangesBySurah: quranSectionRangesBySurah,
        quranTocDefaultView: quranTocDefaultView,
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

async function flushQuranTocDiskCacheVariants() {
  var cacheDir = Utils.cacheBookDirectory('quran', 'quran');
  if (!fs.existsSync(cacheDir))
    return;
  for (const filename of fs.readdirSync(cacheDir)) {
    var cachedName = filename.endsWith(Utils.CACHE_GZIP_SUFFIX)
      ? filename.slice(0, -Utils.CACHE_GZIP_SUFFIX.length)
      : filename;
    if (/^_quran(?:[?.]|$)/.test(cachedName))
      await Utils.flushCachedFile(`${cacheDir}/${cachedName}`, { strict: true });
  }
}

// QURAN COMMENTARY BOOK: TABLE OF CONTENTS
router.get('/quran/juz/:number', async function (req, res, next) {
  var juzNumber = parsePositiveIntegerParam(req.params.number);
  var juzRows = await QuranTocSubdivisions.juzRows();
  var juz = Number.isInteger(juzNumber)
    ? juzRows.find(function (row) { return Number(row.num) === juzNumber; })
    : null;
  var juzRangeError = numberedSubdivisionRangeError('quran-juz', juzRows, req.params.number, 'Quran juz');
  if (juzRangeError)
    return next(juzRangeError);
  if (!juz)
    return next(createError(404, `Quran juz '${req.params.number}' not found`));

  var startParts = (juz.start || '').toString().split(':');
  var surah = Number(startParts[0]);
  var ayah = Number(startParts[1]);
  if (!Number.isInteger(surah) || !Number.isInteger(ayah))
    return next(createError(404, `Quran juz ${juzNumber} has no valid start reference`));

  var section = await QuranHeadings.sectionForAyah(surah, ayah);
  if (!section || !Number.isInteger(Number(section.h2)))
    return next(createError(404, `No Quran passage contains the start of juz ${juzNumber}`));

  var target = Utils.quranUrl(req, `/quran/${surah}/${Number(section.h2)}`);
  return res.redirect(302, `${target}${appendOriginalQuery(req)}`);
});

router.get('/quran/manzil/:number', async function (req, res, next) {
  var manzilNumber = parsePositiveIntegerParam(req.params.number);
  var manzilRows = await QuranTocSubdivisions.manzilRows();
  var manzil = Number.isInteger(manzilNumber)
    ? manzilRows.find(function (row) { return Number(row.num) === manzilNumber; })
    : null;
  var manzilRangeError = numberedSubdivisionRangeError('quran-manzils', manzilRows, req.params.number, 'Quran manzil');
  if (manzilRangeError)
    return next(manzilRangeError);
  if (!manzil)
    return next(createError(404, `Quran manzil '${req.params.number}' not found`));

  var startParts = (manzil.start || '').toString().split(':');
  var surah = Number(startParts[0]);
  if (!Number.isInteger(surah) || !findSurah(surah))
    return next(createError(404, `Quran manzil ${manzilNumber} has no valid start surah`));

  var target = Utils.quranUrl(req, `/quran/${surah}`);
  return res.redirect(302, `${target}${appendOriginalQuery(req)}`);
});

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

  var editMode = req.admin && req.editMode;
  var cacheableHtml = !('json' in req.query) && !('tsv' in req.query);
  var quranTocDefaultView = normalizedCommentaryTocView(req);
  var cachedFile = translationTocCacheFile(req, quranCommentaryBook, quranTocDefaultView);
  var flushCache = Utils.shouldFlushCache(req);
  if (flushCache) {
    invalidateQuranMemoryCaches({ commentaryAlias: quranCommentaryBook.alias });
    await flushTranslationTocCacheVariants(req, quranCommentaryBook);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  if (cacheableHtml && !flushCache && !editMode && Utils.cachedTextPathForRead(cachedFile)) {
    if (sendCachedHtml(req, res, cachedFile))
      return;
    await Utils.flushCachedFile(cachedFile);
  }

  var results = await Library.instance.findBook('quran').getChapters();
  var tafsirs = quranCommentaryBook.type === 'tafsir' ? await Tafsir.visibleTafsirs() : [];
  var translations = quranCommentaryBook.type === 'trans' ? await Tafsir.visibleTranslations() : [];
  var quranJuzRows = await QuranTocSubdivisions.juzRows();
  var quranManzilRows = await QuranTocSubdivisions.manzilRows();
  var quranSectionRangesBySurah = await QuranTocSubdivisions.quranSectionRangesBySurah();
  var quranCommentaryPassages = quranCommentaryBook.source === 'local'
    ? await Tafsir.sitemapPassages(quranCommentaryBook, { source: 'db' })
    : [];
  var quranCommentaryAvailableSurahs = quranCommentaryBook.source === 'local'
    ? Array.from(new Set(quranCommentaryPassages.map(function (passage) {
      return Number(passage.surah);
    }).filter(Number.isInteger)))
    : null;
  var commentaryIntroductionArticles = await CommentaryHeadings.introductionArticles(quranCommentaryBook.id);
  var renderLocals = {
    book: book,
    surahs: global.surahs || [],
    quranJuzRows: quranJuzRows,
    quranManzilRows: quranManzilRows,
    quranSectionRangesBySurah: quranSectionRangesBySurah,
    quranCommentaryAvailableSurahs: quranCommentaryAvailableSurahs,
    quranTocDefaultView: quranTocDefaultView,
    BookDownloads: BookDownloads,
    commentaryIntroductionArticles: commentaryIntroductionArticles,
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

  if (!editMode && Utils.diskCacheEnabled()) {
    var html = await ejs.renderFile(`${__dirname}/../views/toc.ejs`, cachedRenderLocals(res, {
      noadmin: true,
      ...renderLocals
    }));
    Utils.writeCachedHtml(cachedFile, html);
    await Utils.indexCachedItem([
      'quran',
      'book:quran',
      'quran:navigation-tocs',
      `translation:${quranCommentaryBook.alias}`,
      `translation:${quranCommentaryBook.alias}:toc`
    ], cachedFile);
    if (sendCachedHtml(req, res, cachedFile))
      return;
  }

  res.render('toc', renderLocals);
});

function normalizedCommentaryTocView(req) {
  var view = (req.query.toc || req.query.view || req.query.tab || 'juz').toString();
  return ['surahs', 'juz', 'manzils'].includes(view) ? view : 'juz';
}

function translationTocCacheFile(req, translation, view) {
  var filename = Utils.cacheReqToFilename({
    ...req,
    url: req.originalUrl || req.url || ''
  });
  var variant = view === 'juz' ? '' : `__toc-${Utils.safeFilename(view)}`;
  return Utils.cacheFileFromFilename(
    `${filename}${variant}`,
    'html',
    translation.alias,
    'trans'
  );
}

async function flushTranslationTocCacheVariants(req, translation) {
  await Promise.all(['juz', 'surahs', 'manzils'].map(function (view) {
    return Utils.flushCachedFile(translationTocCacheFile(req, translation, view), { strict: true });
  }));
}

async function resolveQuranCommentaryBook(alias) {
  if (!alias)
    return null;
  var translation = Tafsir.visibleTranslationsSync().find(function (book) {
    return book && (book.alias === alias || book.quranBookSlug === alias);
  });
  if (translation)
    return { ...translation, quranBookSlug: translation.quranBookSlug || alias };
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
    var numericQuranChapter = Number(Arabic.toLatinDigits((req.params.chapterNum || '').toString()));
    if (bookAlias === 'quran' && Number.isInteger(numericQuranChapter)
      && (numericQuranChapter < 1 || numericQuranChapter > quranSurahCount()))
      return next(HttpRange.notSatisfiable('quran-surahs', quranSurahCount(), `Quran surah ${req.params.chapterNum} is out of range`));
    if (bookAlias === 'quran' ? !Number.isInteger(chapterNum) : !chapterNum)
      return next(createError(bookAlias === 'quran' ? 404 : 400, routeParameterMessage('chapterNum', req.params.chapterNum, bookAlias === 'quran' ? 'chapter must be a positive integer' : 'chapter must be a non-negative number')));
    if (bookAlias === 'quran' && !findSurah(chapterNum))
      return next(HttpRange.notSatisfiable('quran-surahs', quranSurahCount(), `Quran surah ${chapterNum} is out of range`));
    var requestedOffset;
    try {
      requestedOffset = HttpRange.parseOffset(req.query.o);
    } catch (err) {
      return next(err);
    }
    var offset = Math.max(0, requestedOffset);
    if (bookAlias === 'quran' && shouldRedirectQuranSurahPath(req)) {
      var firstSectionNum = await firstQuranSectionNumber(chapterNum);
      if (firstSectionNum)
        return res.redirect(302, `${Utils.quranUrl(req, `/quran/${chapterNum}/${firstSectionNum}`)}${appendOriginalQuery(req)}`);
    }

    var chapter = await Chapter.chapterFromRef(`${bookAlias}/${chapterNum}`);
    var chapterOffsetError = HttpRange.itemOffsetNotSatisfiable(requestedOffset, chapter.count, `Chapter ${bookAlias}/${chapterNum}`);
    if (chapterOffsetError)
      return next(chapterOffsetError);
    if (bookAlias !== 'quran' && shouldRedirectHadithChapterPath(req)) {
      var firstSection = await chapter.getFirstSection();
      if (firstSection && firstSection.path)
        return res.redirect(301, `/${firstSection.path}${appendChapterSectionRedirectQuery(req)}`);
    }

    var isQuranAyahSectionRequest = bookAlias === 'quran' && req.query.ayat !== undefined;
    var quranChapterPassage = bookAlias === 'quran' && !isQuranAyahSectionRequest;
    var cachedFile = Utils.htmlCacheFile(req);
	const flushCache = Utils.shouldFlushCache(req);
	if (flushCache || isQuranAyahSectionRequest)
	  await Utils.flushCachedFile(cachedFile);
    if (!flushCache && !isQuranAyahSectionRequest && !editMode && Utils.cachedTextPathForRead(cachedFile)) {
      if (sendCachedHtml(req, res, cachedFile))
        return;
      await Utils.flushCachedFile(cachedFile);
    }
	if (isQuranAyahSectionRequest) {
	  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
	  res.setHeader('Pragma', 'no-cache');
	  res.setHeader('Expires', '0');
	}

    await Promise.all([
      applySameBookHeadingNavigation(chapter),
      chapter.getSections()
    ]);
    var hadithHeadingOutlines = bookAlias === 'quran' ? {} : await HadithHeadingOutlines.forChapter(chapter);
    results = await chapter.getItems(offset);
	if (bookAlias !== 'quran')
	  await HdithMetadata.attachClassifications(results);
    if (requestedOffset > 0 && results.length === 0)
      return next(HttpRange.notSatisfiable('items', chapter.count, `Chapter ${bookAlias}/${chapterNum} does not have content at offset ${requestedOffset}`));

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
        var quranHeadingOutlines = await quranHeadingOutlinesForSurahs([chapterNum]);
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
          quranHeadingOutlines: quranHeadingOutlines,
          req: req,
          res: res
        }));
        Utils.writeCachedHtml(cachedFile, html);
        await Utils.indexCachedItem(refs, cachedFile);

        res.render('section_quran', {
          Tafsir: Tafsir,
          chapter: chapter,
          section: chapter,
          results: results,
          quranHeadingOutlines: quranHeadingOutlines
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
        hadithHeadingOutlines: hadithHeadingOutlines,
        req: req,
        res: res
      }));
      Utils.writeCachedHtml(cachedFile, html);
      await Utils.indexCachedItem(refs, cachedFile);

      res.render('chapter', {
        chapter: chapter,
        results: results,
        hadithHeadingOutlines: hadithHeadingOutlines
      });
    }

  } catch (e) {
    if (e instanceof ReferenceError)
      return next(gone(e.message));
    else {
      debug.error(e.stack || e.message || e);
      return next(createError(500, e.message));
    }
  }

});

router.get('/quran/:translationAlias/introduction', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  const translation = visibleQuranTranslationByAlias(req.params.translationAlias);
  if (!translation)
    return next();
  const commentaryIntroductionArticles = await CommentaryHeadings.introductionArticles(translation.id);
  if (!CommentaryHeadings.hasIntroduction(commentaryIntroductionArticles) && !(req.admin && req.editMode))
    return next(createError(404, `No authored introduction is available for ${translation.shortName_en || translation.alias}`));
  const firstIntroductionPassage = await Tafsir.firstPassage(translation);
  const firstIntroductionSurah = firstIntroductionPassage && (global.surahs || []).find(item => Number(item.num) === Number(firstIntroductionPassage.surah));
  res.render('quran_commentary_introduction', {
    Tafsir: Tafsir,
    commentaryIntroductionArticles: commentaryIntroductionArticles,
    commentaryIntroductionNextH1: firstIntroductionPassage ? {
      number: Number(firstIntroductionPassage.surah),
      title: firstIntroductionSurah && firstIntroductionSurah.name_en || '',
      href: `/quran/${encodeURIComponent(translation.quranBookSlug || translation.alias)}/${Number(firstIntroductionPassage.surah)}`
    } : null,
    quranCommentaryBook: translation,
    quranCommentaryBooks: await Tafsir.visibleTranslations()
  });
});

router.get('/quran/:translationAlias/juz/:number', async function (req, res, next) {
  var translation = visibleQuranTranslationByAlias(req.params.translationAlias);
  if (!translation)
    return next();
  var juzNumber = parsePositiveIntegerParam(req.params.number);
  var translationJuzRows = await QuranTocSubdivisions.juzRows();
  var juz = Number.isInteger(juzNumber)
    ? translationJuzRows.find(function (row) { return Number(row.num) === juzNumber; })
    : null;
  var translationJuzRangeError = numberedSubdivisionRangeError('quran-juz', translationJuzRows, req.params.number, 'Quran juz');
  if (translationJuzRangeError)
    return next(translationJuzRangeError);
  if (!juz)
    return next(createError(404, `Quran juz '${req.params.number}' not found`));
  var start = (juz.start || '').toString().split(':');
  var surah = Number(start[0]);
  var ayah = Number(start[1]);
  var section = await QuranHeadings.sectionForAyah(surah, ayah);
  if (!section)
    return next(createError(404, `No Quran passage contains the start of juz ${juzNumber}`));
  var target;
  if (translation.source === 'local') {
    target = Utils.quranUrl(req, `/quran/${encodeURIComponent(translation.quranBookSlug || translation.alias)}/${surah}/${Number(section.h2)}`);
    return res.redirect(302, appendQueryExcluding(req, target, ['translation']));
  }
  target = Utils.quranUrl(req, `/quran/${surah}/${Number(section.h2)}`);
  return res.redirect(302, appendQueryExcluding(req, target, ['translation']));
});

router.get('/quran/:translationAlias/manzil/:number', async function (req, res, next) {
  var translation = visibleQuranTranslationByAlias(req.params.translationAlias);
  if (!translation)
    return next();
  var manzilNumber = parsePositiveIntegerParam(req.params.number);
  var translationManzilRows = await QuranTocSubdivisions.manzilRows();
  var manzil = Number.isInteger(manzilNumber)
    ? translationManzilRows.find(function (row) { return Number(row.num) === manzilNumber; })
    : null;
  var translationManzilRangeError = numberedSubdivisionRangeError('quran-manzils', translationManzilRows, req.params.number, 'Quran manzil');
  if (translationManzilRangeError)
    return next(translationManzilRangeError);
  if (!manzil)
    return next(createError(404, `Quran manzil '${req.params.number}' not found`));
  var surah = Number((manzil.start || '').toString().split(':')[0]);
  var target;
  if (translation.source === 'local') {
    target = Utils.quranUrl(req, `/quran/${encodeURIComponent(translation.quranBookSlug || translation.alias)}/${surah}`);
    return res.redirect(302, appendQueryExcluding(req, target, ['translation']));
  }
  target = Utils.quranUrl(req, `/quran/${surah}`);
  return res.redirect(302, appendQueryExcluding(req, target, ['translation']));
});

async function renderScopedQuranTranslationPassage(req, res, next) {
  var translation = visibleQuranTranslationByAlias(req.params.translationAlias);
  if (!translation || !['default', 'local'].includes(translation.source))
    return next();
  var translationSlug = translation.quranBookSlug || translation.alias;
  var end = req.params.ayah2 ? `-${req.params.ayah2}` : '';
  var canonicalPath = `/quran/${encodeURIComponent(translationSlug)}/quran:${req.params.surah}:${req.params.ayah1}${end}`;
  if (req.params.translationAlias !== translationSlug)
    return res.redirect(301, appendQueryExcluding(req, Utils.quranUrl(req, canonicalPath), ['translation']));
  req.params.bookAlias = 'quran';
  req.quranSelectedTranslationAlias = translation.alias;
  req.quranSelectedTranslationSlug = translationSlug;
  req.quranTranslationAliasRoute = true;
  req.quranTranslationCanonicalPath = canonicalPath;
  req.query.translation = translation.alias;
  return a_getPassage(req.params.surah, req.params.ayah1, req.params.ayah2 || req.params.ayah1, req, res, next);
}

router.get('/quran/:translationAlias/quran\::surah\::ayah1-:ayah2', renderScopedQuranTranslationPassage);
router.get('/quran/:translationAlias/quran\::surah\::ayah1', renderScopedQuranTranslationPassage);

router.get('/quran/:translationAlias/:chapterNum/:sectionNum/:subsectionNum', async function (req, res, next) {
  var translation = visibleQuranTranslationByAlias(req.params.translationAlias);
  if (!translation || !['default', 'local'].includes(translation.source))
    return next();
  var translationSlug = translation.quranBookSlug || translation.alias;
  var surah = parsePositiveIntegerParam(req.params.chapterNum);
  var section = parsePositiveIntegerParam(req.params.sectionNum);
  var subsection = parsePositiveIntegerParam(req.params.subsectionNum);
  if (!Number.isInteger(surah) || !Number.isInteger(section) || !Number.isInteger(subsection))
    return next(createError(400, 'Invalid Quran subsection path'));
  try {
    await Subsection.subsectionFromRef(`quran/${surah}/${section}/${subsection}`);
  } catch (err) {
    if (err instanceof ReferenceError)
      return next(gone(err.message));
    throw err;
  }
  var target = Utils.quranUrl(req, `/quran/${encodeURIComponent(translationSlug)}/${surah}/${section}`);
  return res.redirect(301, appendQueryExcluding(req, target, ['translation']));
});

router.get('/quran/:translationAlias/:chapterNum/:sectionNum', async function (req, res, next) {
  var translation = visibleQuranTranslationByAlias(req.params.translationAlias);
  if (!translation || !['default', 'local'].includes(translation.source))
    return next();
  var translationSlug = translation.quranBookSlug || translation.alias;
  if (req.params.translationAlias !== translationSlug) {
    var canonicalTranslationUrl = Utils.quranUrl(req, `/quran/${encodeURIComponent(translationSlug)}/${req.params.chapterNum}/${req.params.sectionNum}`);
    return res.redirect(301, appendQueryExcluding(req, canonicalTranslationUrl, ['translation']));
  }
  req.params.bookAlias = 'quran';
  req.quranSelectedTranslationAlias = translation.alias;
  req.quranSelectedTranslationSlug = translationSlug;
  req.quranTranslationAliasRoute = true;
  req.quranTranslationCanonicalPath = `/quran/${encodeURIComponent(translation.quranBookSlug || translation.alias)}/${req.params.chapterNum}/${req.params.sectionNum}`;
  req.query.translation = translation.alias;
  return renderBookSection(req, res, next);
});

router.get('/quran/:translationAlias/:chapterNum', async function (req, res, next) {
  var translation = visibleQuranTranslationByAlias(req.params.translationAlias);
  if (!translation || translation.source !== 'local')
    return next();
  var surah = parsePositiveIntegerParam(req.params.chapterNum);
  var numericTranslationSurah = Number(Arabic.toLatinDigits((req.params.chapterNum || '').toString()));
  if (Number.isInteger(numericTranslationSurah) && (numericTranslationSurah < 1 || numericTranslationSurah > quranSurahCount()))
    return next(HttpRange.notSatisfiable('quran-surahs', quranSurahCount(), `Quran surah ${req.params.chapterNum} is out of range`));
  if (!Number.isInteger(surah))
    return next(createError(404, `Quran surah ${req.params.chapterNum} not found`));
  var first = await Tafsir.firstPassageInSurah(translation, surah).catch(function (err) {
    debug.error(`quran translation first passage redirect failed alias=${translation.alias} surah=${surah}: ${err.message}\n${err.stack || ''}`);
    return null;
  });
  if (!first || !Number.isInteger(Number(first.ayah)))
    return next(createError(404, `Quran surah ${surah} has no passages for translation ${translation.alias}`));
  req.quranSelectedTranslationAlias = translation.alias;
  req.quranSelectedTranslationSlug = translation.quranBookSlug || translation.alias;
  var targetPath = `/quran/${encodeURIComponent(translation.quranBookSlug || translation.alias)}/${surah}/${Number(first.ayah)}`;
  return res.redirect(302, Utils.quranPath(targetPath));
});

function isFirstQuranChapterSection(section, chapter) {
  const first = Array.isArray(chapter && chapter.sections)
    ? chapter.sections.find(candidate => Number(candidate && candidate.h2) > 0)
    : null;
  if (!section || !first)
    return false;
  if (section.id !== undefined && first.id !== undefined && String(section.id) === String(first.id))
    return true;
  if (section.path && first.path && section.path === first.path)
    return true;
  return Number(section.h2) === Number(first.h2);
}

// BOOK: SECTION
router.get('/:bookAlias/:chapterNum/:sectionNum', renderBookSection);

async function renderBookSection(req, res, next) {

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
    if (bookAlias === 'quran' && !req.quranSelectedTranslationAlias) {
      var surah = findSurah(req.params.chapterNum);
      if (surah && redirectCanonicalReferencePath(req, res, `/quran/${surah.num}/${req.params.sectionNum}`))
        return;
    }
    var chapterNum = bookAlias === 'quran'
      ? parsePositiveIntegerParam(req.params.chapterNum)
      : parseHadithHeadingNumberParam(req.params.chapterNum);
    var sectionNum = bookAlias === 'quran'
      ? parsePositiveIntegerParam(req.params.sectionNum)
      : parseHadithHeadingNumberParam(req.params.sectionNum);
    var numericQuranSectionSurah = Number(Arabic.toLatinDigits((req.params.chapterNum || '').toString()));
    if (bookAlias === 'quran' && Number.isInteger(numericQuranSectionSurah)
      && (numericQuranSectionSurah < 1 || numericQuranSectionSurah > quranSurahCount()))
      return next(HttpRange.notSatisfiable('quran-surahs', quranSurahCount(), `Quran surah ${req.params.chapterNum} is out of range`));
    if (bookAlias === 'quran' ? !Number.isInteger(chapterNum) : !chapterNum)
      return next(createError(bookAlias === 'quran' ? 404 : 400, routeParameterMessage('chapterNum', req.params.chapterNum, bookAlias === 'quran' ? 'chapter must be a positive integer' : 'chapter must be a non-negative number')));
    if (bookAlias !== 'quran' && sectionNum !== null && Number(sectionNum) === 0)
      return next(gone(`Hadith section ${bookAlias}/${chapterNum}/${req.params.sectionNum} not found`));
    if (bookAlias === 'quran' ? !Number.isInteger(sectionNum) : !sectionNum)
      return next(createError(400, routeParameterMessage('sectionNum', req.params.sectionNum, bookAlias === 'quran' ? 'section must be a positive integer' : 'section must be a positive number')));
    if (bookAlias === 'quran' && !findSurah(chapterNum))
      return next(HttpRange.notSatisfiable('quran-surahs', quranSurahCount(), `Quran surah ${chapterNum} is out of range`));
    if (bookAlias === 'quran' && !req.quranSelectedTranslationAlias && !req.query.translation) {
      var preferredTranslation = preferredQuranTranslationFromCookie(req);
      if (preferredTranslation) {
        var preferredTranslationPath = `/quran/${encodeURIComponent(preferredTranslation.quranBookSlug || preferredTranslation.alias)}/${chapterNum}/${sectionNum}`;
        return res.redirect(302, appendQueryExcluding(req, Utils.quranUrl(req, preferredTranslationPath), ['translation']));
      }
    }
    var selectedTranslationAlias = validQuranTranslationAlias(req.quranSelectedTranslationAlias || req.query.translation);
    var selectedTranslation = selectedTranslationAlias ? visibleQuranTranslationByAlias(selectedTranslationAlias) : null;
    if (bookAlias === 'quran' && selectedTranslation && selectedTranslation.source === 'local' && !req.quranTranslationCanonicalPath) {
      var canonicalTranslationPath = `/quran/${encodeURIComponent(selectedTranslation.quranBookSlug || selectedTranslation.alias)}/${chapterNum}/${sectionNum}`;
      if (req.quranTranslationAliasRoute)
        req.quranTranslationCanonicalPath = canonicalTranslationPath;
      else {
        var canonicalTranslationUrl = appendQueryExcluding(req, Utils.quranUrl(req, canonicalTranslationPath), ['translation']);
        return res.redirect(301, canonicalTranslationUrl);
      }
    }
    var requestedOffset;
    try {
      requestedOffset = HttpRange.parseOffset(req.query.o);
    } catch (err) {
      return next(err);
    }
    var offset = Math.max(0, requestedOffset);
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

    var isQuranAyahSectionRequest = bookAlias === 'quran' && req.query.ayat !== undefined;
    var cachedFile = Utils.htmlCacheFile(req);
	const flushCache = Utils.shouldFlushCache(req);
	if (flushCache || isQuranAyahSectionRequest)
	  await Utils.flushCachedFile(cachedFile);
    if (!flushCache && !isQuranAyahSectionRequest && !editMode && Utils.cachedTextPathForRead(cachedFile)) {
      if (sendCachedHtml(req, res, cachedFile))
        return;
      await Utils.flushCachedFile(cachedFile);
    }
    if (isQuranAyahSectionRequest) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }

    var section = await Section.sectionFromRef(`${bookAlias}/${chapterNum}/${sectionNum}`);
    var sectionOffsetError = HttpRange.itemOffsetNotSatisfiable(requestedOffset, section.count, `Section ${bookAlias}/${chapterNum}/${sectionNum}`);
    if (sectionOffsetError)
      return next(sectionOffsetError);
    if (editMode && bookAlias === 'quran')
      await attachQuranRawHeadingRangeToHeading(section);
    var chapter = await section.getChapter();
    await Promise.all([
      applySameBookHeadingNavigation(section),
      applySameBookHeadingNavigation(chapter),
      chapter.getSections()
    ]);
    var hadithHeadingOutlines = bookAlias === 'quran' ? {} : await HadithHeadingOutlines.forChapter(chapter);
    if (bookAlias === 'quran') {
      var sectionStartAyah = quranAyahFromHeadingStart(section.start);
      if (sectionStartAyah === 0)
        sectionStartAyah = 1;
      section.mushafPage = await QuranMushaf.pageForSection(chapterNum, sectionNum, sectionStartAyah);
      if (!section.mushafPage)
		return next(createError(404, `A Mushaf page was not found for Quran passage ${chapterNum}/${sectionNum}`));
      if (req.query.mushaf !== undefined)
        return res.redirect(302, Utils.quranUrl(req, `/quran/page/${section.mushafPage}`));
    }
    var isQuranPassageSection = bookAlias === 'quran' && req.query.ayat == undefined;
    var quranSubsections = isQuranPassageSection
      ? await getQuranSectionSubsections(section, { reconcileWithDb: editMode })
      : [];
    var quranSurahs = isQuranPassageSection
      ? await getQuranSurahsFromIndex()
      : [];
    var quranHeadingOutlines = isQuranPassageSection
      ? await quranHeadingOutlinesForSurahs([chapterNum])
      : {};
    if (isQuranPassageSection)
      results = await getQuranSectionPassageItems(section, offset);
    else
      results = await section.getItems(offset);
	if (bookAlias !== 'quran')
	  await HdithMetadata.attachClassifications(results);
    if (requestedOffset > 0 && results.length === 0)
      return next(HttpRange.notSatisfiable('items', section.count, `Section ${bookAlias}/${chapterNum}/${sectionNum} does not have content at offset ${requestedOffset}`));
    if (isQuranPassageSection && results.length == 0)
	  return next(createError(404, `${queryParameterMessage('o', offset, `Quran passage ${chapterNum}/${sectionNum} does not have content at that offset`)}`));
    if (isQuranPassageSection && selectedTranslation && selectedTranslation.source === 'local') {
      await applySelectedQuranTranslation(results, selectedTranslation, chapterNum);
      req.quranServerRenderedTranslationAlias = selectedTranslation.alias;
    } else if (isQuranPassageSection) {
      req.quranServerRenderedTranslationAlias = '';
    }
    if (results.length == 0) {
      var item = new Item(section);
      item.id = item.hId = undefined;
      results.push(item);
    }

    var commentarySurahHeading = null;
    var commentaryIntroductionArticles = [];
    if (isQuranPassageSection && selectedTranslation && isFirstQuranChapterSection(section, chapter)) {
      commentarySurahHeading = await CommentaryHeadings.chapter(selectedTranslation.id, chapterNum);
      if (!commentarySurahHeading && req.admin && req.editMode)
        commentarySurahHeading = await CommentaryHeadings.ensureChapter(selectedTranslation.id, chapterNum, '');
    }
    if (isQuranPassageSection && selectedTranslation)
      commentaryIntroductionArticles = await CommentaryHeadings.introductionArticles(selectedTranslation.id);

    if (isQuranPassageSection) {

      // cache response
      var refs = [];
      for (const item of results)
        refs.push(item.ref);
      var html = await ejs.renderFile(`${__dirname}/../views/section_quran.ejs`, cachedRenderLocals(res, {
        Tafsir: Tafsir,
        commentarySurahHeading: commentarySurahHeading,
        commentaryIntroductionArticles: commentaryIntroductionArticles,
        noadmin: true,
        section: section,
        results: results,
        selectedAyahs: [],
        quranSubsections: quranSubsections,
        quranSurahs: quranSurahs,
        quranHeadingOutlines: quranHeadingOutlines,
        quranCommentaryBook: selectedTranslation,
        req: req,
        res: res
      }));
      Utils.writeCachedHtml(cachedFile, html);
      await Utils.indexCachedItem(refs, cachedFile);

      res.render('section_quran', {
        Tafsir: Tafsir,
        commentarySurahHeading: commentarySurahHeading,
        commentaryIntroductionArticles: commentaryIntroductionArticles,
        section: section,
        results: results,
        selectedAyahs: [],
        quranSubsections: quranSubsections,
        quranSurahs: quranSurahs,
        quranHeadingOutlines: quranHeadingOutlines,
        quranCommentaryBook: selectedTranslation
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

        if (!isQuranAyahSectionRequest) {
          var refs = [];
          for (const item of results)
            refs.push(item.ref);
          var html = await ejs.renderFile(`${__dirname}/../views/section.ejs`, cachedRenderLocals(res, {
            noadmin: true,
            section: section,
            results: results,
            hadithHeadingOutlines: hadithHeadingOutlines,
            req: req,
            res: res
          }));
          Utils.writeCachedHtml(cachedFile, html);
          await Utils.indexCachedItem(refs, cachedFile);
        }

        res.render('section', {
          section: section,
          results: results,
          hadithHeadingOutlines: hadithHeadingOutlines
        });

      }

    }

  } catch (e) {
    if (e instanceof ReferenceError)
      return next(gone(e.message));
    else {
      debug.error(e.stack || e.message || e);
      return next(createError(500, e.message));
    }
  }

}

async function applySelectedQuranTranslation(items, translation, surah, options = {}) {
  const unavailableMessage = 'Content is not available for this ayah.';
  var firstItem = (items || [])[0];
  if (firstItem && (firstItem.chain_en || firstItem.en?.chain)) {
    var basmalahEntry = await Tafsir.localTranslationEntry(translation, 1, 1, options).catch(function (err) {
      debug.error(`selected quran translation basmalah render failed alias=${translation.alias}: ${err.message}\n${err.stack || ''}`);
      return null;
    });
    var basmalahHtml = basmalahEntry && basmalahEntry.html ? basmalahEntry.html : '';
    if (Number(surah) !== 1)
      basmalahHtml = Utils.stripQuranDisplayFootnoteHtml(basmalahHtml);
    var basmalahText = basmalahHtml ? Utils.htmlToMarkdown(basmalahHtml) : '';
    if (basmalahText) {
      if (!firstItem.en)
        firstItem.en = {};
      firstItem.en.chain = basmalahText;
      firstItem.chain_en = basmalahText;
    }
  }
  await Promise.all((items || []).map(async function (item) {
    var itemAyah = item && item.numInChapter;
    if (itemAyah === undefined || itemAyah === null || itemAyah === '')
      itemAyah = item && (item.en?.num || item.num || item.ref || '');
    var ayah = parseQuranAyahParam(itemAyah);
    if (!Number.isInteger(ayah))
      ayah = parseQuranAyahParam((item && (item.en?.num || item.num || item.ref) || '').toString().split(/:/).pop());
    if (!Number.isInteger(ayah))
      return;
    var entry = await Tafsir.localTranslationEntry(translation, surah, ayah, options).catch(function (err) {
      debug.error(`selected quran translation render failed alias=${translation.alias} ref=${surah}:${ayah}: ${err.message}\n${err.stack || ''}`);
      return null;
    });
    if (!entry || !entry.html) {
      if (!item.en)
        item.en = {};
      item.en.body = unavailableMessage;
      item.body_en = unavailableMessage;
      item.quranTranslationAlias = translation.alias;
      return;
    }
    if (!item.en)
      item.en = {};
    item.en.body = entry.html;
    item.body_en = entry.html;
    item.quranTranslationAlias = translation.alias;
  }));
}

// BOOK: SECTION
router.get('/:bookAlias/:chapterNum/:sectionNum/:subsectionNum', async function (req, res, next) {
  var p = req.params;
  var book = p.bookAlias === 'quran' ? visibleBookByAlias('quran') : visibleBookFromParam(p.bookAlias);
  if (!book)
    return next(createError(404, `Book '${p.bookAlias}' does not exist`));
  p.bookAlias = book.alias;
  if (p.bookAlias === 'quran') {
    var surah = findSurah(p.chapterNum);
    var numericSubsectionSurah = Number(Arabic.toLatinDigits((p.chapterNum || '').toString()));
    if (!surah && Number.isInteger(numericSubsectionSurah)
      && (numericSubsectionSurah < 1 || numericSubsectionSurah > quranSurahCount()))
      return next(HttpRange.notSatisfiable('quran-surahs', quranSurahCount(), `Quran surah ${p.chapterNum} is out of range`));
    if (!surah)
      return next(createError(404, `Quran surah ${p.chapterNum} not found`));
    p.chapterNum = surah.num;
  }
  var chapterNum = p.bookAlias === 'quran'
    ? parsePositiveIntegerParam(p.chapterNum)
    : parseHadithHeadingNumberParam(p.chapterNum);
  var sectionNum = p.bookAlias === 'quran'
    ? parsePositiveIntegerParam(p.sectionNum)
    : parseHadithHeadingNumberParam(p.sectionNum);
  var subsectionNum = p.bookAlias === 'quran'
    ? parsePositiveIntegerParam(p.subsectionNum)
    : parseHadithHeadingNumberParam(p.subsectionNum);
  if (p.bookAlias === 'quran' ? !Number.isInteger(chapterNum) : !chapterNum)
    return next(createError(400, routeParameterMessage('chapterNum', p.chapterNum, p.bookAlias === 'quran' ? 'chapter must be a positive integer' : 'chapter must be a non-negative number')));
  if (p.bookAlias !== 'quran' && sectionNum !== null && Number(sectionNum) === 0)
    return next(gone(`Hadith section ${p.bookAlias}/${chapterNum}/${p.sectionNum} not found`));
  if (p.bookAlias === 'quran' ? !Number.isInteger(sectionNum) : !sectionNum)
    return next(createError(400, routeParameterMessage('sectionNum', p.sectionNum, p.bookAlias === 'quran' ? 'section must be a positive integer' : 'section must be a positive number')));
  if (p.bookAlias !== 'quran' && subsectionNum !== null && Number(subsectionNum) === 0)
    return next(gone(`Hadith subsection ${p.bookAlias}/${chapterNum}/${sectionNum}/${p.subsectionNum} not found`));
  if (p.bookAlias === 'quran' ? !Number.isInteger(subsectionNum) : !subsectionNum)
    return next(createError(400, routeParameterMessage('subsectionNum', p.subsectionNum, p.bookAlias === 'quran' ? 'subsection must be a positive integer' : 'subsection must be a positive number')));
  try {
    await Subsection.subsectionFromRef(`${p.bookAlias}/${chapterNum}/${sectionNum}/${subsectionNum}`);
  } catch (err) {
    if (err instanceof ReferenceError)
      return next(gone(err.message));
    throw err;
  }
  var canonicalChapterNum = Utils.formatHadithHeadingNumber(chapterNum);
  var canonicalSectionNum = Utils.formatHadithHeadingNumber(sectionNum);
  res.redirect(301, `/${p.bookAlias}/${canonicalChapterNum}/${canonicalSectionNum}${appendOriginalQuery(req)}`);
  return;
});

module.exports = router;
