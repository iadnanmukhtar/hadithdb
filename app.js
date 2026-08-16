// @ts-check
'use strict';

let newrelic = null;
try {
  newrelic = require('newrelic');
} catch (err) {
  debugNewRelicLoadError(err);
}
require('./lib/Globals');
const Debug = require('./lib/Debug');
const accessLogMiddleware = require('./lib/AccessLog');
const debug = Debug('hadithdb:App');
const util = require('util');
const path = require('path');
const createError = require('http-errors');
const express = require('express');
const cookieParser = require('cookie-parser');
const { STATUS_CODES } = require('http');
const requestIp = require('request-ip');
const Hadith = require('./lib/Hadith');
const Tafsir = require('./lib/Tafsir');
const TafsirAliasPaths = require('./lib/TafsirAliasPaths');
const Utils = require('./lib/Utils');
const PaymentConfig = require('./lib/PaymentConfig');
const ContentTranslations = require('./lib/ContentTranslations');
const QuranRecitationFeedback = require('./lib/QuranRecitationFeedback');
const GoogleAnalytics = require('./lib/GoogleAnalytics');
const { mountInfiniteScrollApiRoutes } = require('./lib/InfiniteScrollApiRoutes');

function debugNewRelicLoadError(err) {
  if (!process.env.DEBUG || !process.env.DEBUG.split(',').some(pattern => pattern.trim() === 'hadithdb:App'))
    return;
  console.warn('New Relic agent API is unavailable:', err && err.message ? err.message : err);
}

const REQUEST_BODY_LIMIT = '10mb';
const MAX_REQUEST_URL_LENGTH = 4096;
const FRIENDLY_ERROR_REF_MAX_LENGTH = 80;
const STARTUP_RETRY_AFTER_SECONDS = 30;
const BLOCKED_HTTP_METHODS = new Set(['TRACE', 'TRACK']);
const PUBLIC_DIRECTORY = path.join(__dirname, 'public');
const STATIC_DIRECTORY = path.join(PUBLIC_DIRECTORY, 'static');
const STARTUP_FALLBACK_FILE = path.join(PUBLIC_DIRECTORY, 'html', '_app_restarting.html');
const PUBLIC_STATIC_OPTIONS = {
  dotfiles: 'ignore',
  fallthrough: true,
  cacheControl: false,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
};

const sameSiteSecurityHeaders = (req, res, next) => {
  const paymentPolicy = PaymentConfig.isEnabled()
    ? 'payment=(self "https://js.stripe.com" "https://checkout.stripe.com")'
    : 'payment=()';
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Permissions-Policy', [
    'camera=()',
    QuranRecitationFeedback.isEnabled() ? 'microphone=(self)' : 'microphone=()',
    'geolocation=()',
    paymentPolicy,
    'usb=()'
  ].join(', '));
  if (req.secure)
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
};

const rejectUnsafeRequestShape = (req, res, next) => {
  if (BLOCKED_HTTP_METHODS.has(req.method))
    return next(createError(405, 'HTTP method not allowed'));
  if ((req.originalUrl || '').length > MAX_REQUEST_URL_LENGTH)
    return next(createError(414, 'Request URL is too long'));
  next();
};

const preserveStripeWebhookRawBody = (req, res, buf) => {
  if (req.path === '/api/payments/webhook' || req.path === '/quran/api/payments/webhook')
    req.rawBody = Buffer.from(buf);
};

const installTimestampedErrorLogging = () => {
  if (console.__hadithdbTimestampedErrors)
    return;
  const originalError = console.error.bind(console);
  console.error = (...args) => {
    const timestamp = new Date().toISOString();
    const message = util.format(...args);
    originalError(message.split(/\r?\n/).map(line => `${timestamp} ${line}`).join('\n'));
  };
  Object.defineProperty(console, '__hadithdbTimestampedErrors', {
    value: true,
    enumerable: false
  });
};

installTimestampedErrorLogging();

const wrapAsyncHandler = (handler) => {
  if (Array.isArray(handler))
    return handler.map(wrapAsyncHandler);
  if (typeof handler !== 'function' || handler.length === 4)
    return handler;
  return function wrappedAsyncHandler(req, res, next) {
    return Promise.resolve(handler(req, res, next)).catch(next);
  };
};

const patchAsyncRouterMethods = () => {
  const routerProto = Object.getPrototypeOf(express.Router());
  const methods = ['use', 'all', 'get', 'post', 'put', 'patch', 'delete'];
  for (const method of methods) {
    const original = routerProto[method];
    routerProto[method] = function patchedRouterMethod(...args) {
      return original.apply(this, args.map(wrapAsyncHandler));
    };
  }
};

const isNotFoundError = (err) => {
  if (!err || !err.message)
    return false;
  if (err.status === 404 || err.statusCode === 404)
    return true;
  if (!(err instanceof ReferenceError))
    return false;
  return /(^Not found:| not found$| does not exist$)/i.test(err.message);
};

const HTTP_ERROR_FRIENDLY_MESSAGES = {
  400: 'The request could not be understood.',
  401: 'You need to sign in to access this resource.',
  403: 'You do not have permission to access this resource.',
  404: 'The requested page or reference could not be found.',
  410: 'The requested page or reference is no longer available.',
  408: 'The request took too long to complete.',
  413: 'The request payload is too large.',
  414: 'The requested URL is too long.',
  416: 'The requested range is outside the available resource.',
  429: 'Too many requests were sent. Please wait and try again.',
  431: 'The request headers are too large. This is often caused by oversized cookies. Clear site cookies and try again.',
  500: 'An unexpected server error occurred.',
  502: 'A backend service returned an invalid response.',
  503: 'A backend service is temporarily unavailable.',
  504: 'A backend service took too long to respond.'
};

const defaultHttpErrorMessage = (statusCode, message) => {
  if (message)
    return message;
  return STATUS_CODES[statusCode] || 'Error';
};

const friendlyHttpErrorMessage = (statusCode, message) => {
  if (HTTP_ERROR_FRIENDLY_MESSAGES[statusCode])
    return HTTP_ERROR_FRIENDLY_MESSAGES[statusCode];
  return message || STATUS_CODES[statusCode] || 'An error occurred.';
};

const logHttpError = (statusCode, err) => {
  const statusTitle = STATUS_CODES[statusCode] || 'Error';
  const message = err && err.message ? err.message : statusTitle;
  const shouldLogStack = statusCode !== 405 && statusCode !== 410 && statusCode !== 416 && !isNotFoundError(err);
  const stack = shouldLogStack && err && err.stack ? `\n${err.stack}` : '';
  debug.error(`HTTP ${statusCode} ${statusTitle}: ${message}${stack}`);
};

const appendQueryString = (path, queryString) => {
  if (!queryString)
    return path;
  return `${path}?${queryString}`;
};

const requestQueryString = (req) => {
  const queryIndex = (req.originalUrl || '').indexOf('?');
  return queryIndex === -1 ? '' : req.originalUrl.substring(queryIndex + 1);
};

const canonicalBlogPath = (path) => {
  if (!path || !/^\/blog(?:\/blog)+(?:\/|$)/.test(path))
    return null;
  return path.replace(/^\/blog(?:\/blog)+/, '/blog');
};

const truncatedFriendlyErrorRef = (req) => {
  if (!req)
    return '';
  const originalUrl = (req.originalUrl || req.url || '').toString().replace(/[\x00-\x1f\x7f]/g, '');
  if (!originalUrl || originalUrl === '/error')
    return '';
  if (originalUrl.length <= FRIENDLY_ERROR_REF_MAX_LENGTH)
    return originalUrl;
  return `${originalUrl.substring(0, FRIENDLY_ERROR_REF_MAX_LENGTH - 3)}...`;
};

const buildNullPathSuggestion = (req, queryString) => {
  const segments = req.path.split('/').filter(Boolean);
  const nullIndex = segments.findIndex(segment => segment.toLowerCase() === 'null');
  if (nullIndex === -1)
    return null;
  const suggestedPath = `/${segments.slice(0, nullIndex).join('/')}`;
  const normalizedPath = suggestedPath === '/' ? '/' : suggestedPath.replace(/\/+$/, '');
  return appendQueryString(normalizedPath, queryString);
};

const buildQuranPathSuggestions = (req, queryString) => {
  const match = req.path.match(/^\/quran\/([^/]+)\/([^/]+)\/?$/);
  if (!match)
    return [];
  const surah = match[1];
  const ayah = match[2];
  return [
    appendQueryString(`/quran:${surah}:${ayah}`, queryString),
    appendQueryString(`/quran/${surah}`, queryString)
  ];
};

const buildQuranHostRedirectPath = (req) => {
  const match = req.path.match(/^\/quran\/([1-9]\d*)\/([1-9]\d*)\/?$/);
  if (!match)
    return req.originalUrl;
  const surahNum = Number(match[1]);
  const ayahNum = Number(match[2]);
  const surah = (global.surahs || []).find(item => Number(item.num) === surahNum);
  const ayahCount = Number(surah && (surah.ayahs || surah.ayat));
  if (!surah || !Number.isInteger(ayahNum) || ayahNum < 1 || ayahNum > ayahCount)
    return req.originalUrl;
  return appendQueryString(`/quran:${surahNum}:${ayahNum}`, requestQueryString(req));
};

const visibleHadithBookForAlias = (alias) => {
  return (global.books || []).find(item => item
    && Number(item.hidden) === 0
    && item.alias === alias
    && item.alias !== 'quran'
    && item.type !== 'tafsir'
    && item.type !== 'trans');
};

const hadithBookPath = (requestPath) => {
  const match = (requestPath || '').match(/^\/([^/:]+)(?=\/|:|$)/);
  if (!match)
    return '';
  let alias;
  try {
    alias = decodeURIComponent(match[1]);
  } catch (err) {
    return '';
  }
  return visibleHadithBookForAlias(alias) ? requestPath : '';
};

const quranPrefixedHadithPath = (requestPath) => {
  if (!(requestPath || '').startsWith('/quran/'))
    return '';
  return hadithBookPath(requestPath.substring('/quran'.length));
};

const buildErrorSuggestions = (req) => {
  if (!req || !req.path)
    return [];
  const queryString = requestQueryString(req);
  const suggestions = [
    buildNullPathSuggestion(req, queryString),
    ...buildQuranPathSuggestions(req, queryString)
  ].filter(Boolean);
  return [...new Set(suggestions)];
};

const normalizeHttpStatusCode = (statusCode) => {
  statusCode = parseInt(statusCode, 10);
  if (!statusCode || statusCode < 400 || statusCode > 599)
    return 500;
  return statusCode;
};

const decodeSafeUrlComponent = (value) => {
  if (!value)
    return '';
  try {
    return decodeURIComponent(value);
  } catch (err) {
    debug(`unable to decode error ref=${value}: ${err.message}`);
    return value;
  }
};

const encodeErrorRefForPath = (req) => {
  const ref = truncatedFriendlyErrorRef(req);
  if (!ref)
    return '';
  return encodeURIComponent(ref).replace(/%2F/gi, '/').replace(/^\/+/, '');
};

const wantsJsonErrorResponse = (req) => {
  if (!req)
    return false;
  if (req.xhr)
    return true;
  if (req.query && ('json' in req.query || req.query.format === 'json'))
    return true;
  const accept = req.get('accept') || '';
  if (accept.includes('application/json') && !accept.includes('text/html'))
    return true;
  const contentType = req.get('content-type') || '';
  return contentType.includes('application/json');
};

const wantsFriendlyErrorRedirect = (req) => {
  if (!req)
    return false;
  if (req.path === '/error' || req.path === '/quran/error')
    return false;
  if (wantsJsonErrorResponse(req))
    return false;
  const accept = req.get('accept') || '';
  return !accept || accept.includes('text/html') || accept.includes('*/*');
};

const isQuranFriendlyErrorRequest = (req) => {
  return !!req && (
    Utils.isQuranSubdomainRequest(req)
    || Utils.isQuranUrlPath(req.path)
    || Utils.isQuranUrlPath(req.originalUrl || req.url)
  );
};

const buildFriendlyErrorUrl = (req, statusCode) => {
  const errorPath = isQuranFriendlyErrorRequest(req) ? '/quran/error' : '/error';
  const encodedRef = encodeErrorRefForPath(req);
  if (encodedRef)
    return `${errorPath}/${normalizeHttpStatusCode(statusCode)}/${encodedRef}`;
  return `${errorPath}/${normalizeHttpStatusCode(statusCode)}`;
};

const friendlyErrorRedirectStatus = (req) => {
  return req && req.method !== 'GET' && req.method !== 'HEAD' ? 303 : 302;
};

const buildErrorViewLocals = (statusCode, message, error, req, res) => {
  statusCode = normalizeHttpStatusCode(statusCode);
  const finalMessage = defaultHttpErrorMessage(statusCode, message);
  const finalReq = req || {
    path: '/',
    query: {},
    cookies: {},
    originalUrl: '/',
    hostname: '',
    headers: {},
    protocol: 'http'
  };
  const finalRes = res || { statusCode: statusCode };
  finalRes.statusCode = statusCode;
  if (typeof finalRes.setHeader === 'function')
    finalRes.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return {
    req: finalReq,
    res: finalRes,
    utils: Utils,
    message: finalMessage,
    publicMessage: friendlyHttpErrorMessage(statusCode),
    error: error || createError(statusCode, finalMessage),
    friendlyMessage: friendlyHttpErrorMessage(statusCode, finalMessage),
    statusTitle: STATUS_CODES[statusCode] || 'Error',
    suggestedPaths: statusCode === 404 ? buildErrorSuggestions(finalReq) : []
  };
};

patchAsyncRouterMethods();

const app = express();
app.locals.newrelic = newrelic;
app.locals.googleAnalyticsTagId = GoogleAnalytics.googleAnalyticsTagId;
app.locals.startupReady = false;
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.renderErrorPage = function renderErrorPage(statusCode, message, error, req, res, callback) {
  return app.render('error', buildErrorViewLocals(statusCode, message, error, req, res), callback);
};

(async () => {
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');

  app.use(requestIp.mw());
  app.use(Debug.requestContextMiddleware);
  app.use(accessLogMiddleware);
  app.use(sameSiteSecurityHeaders);
  app.use(rejectUnsafeRequestShape);
  // Keep presentation assets available while application data is initializing.
  app.use('/static', express.static(STATIC_DIRECTORY, PUBLIC_STATIC_OPTIONS));
  app.use(function rejectRequestsUntilStartupIsReady(req, res, next) {
    if (app.locals.startupReady)
      return next();
    const statusCode = 503;
    const startupMessage = `The app is starting. Please retry in ${STARTUP_RETRY_AFTER_SECONDS} seconds.`;
    res.setHeader('Retry-After', String(STARTUP_RETRY_AFTER_SECONDS));
    if (wantsJsonErrorResponse(req)) {
      return res.status(statusCode).json({
        error: STATUS_CODES[statusCode],
        message: startupMessage
      });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return res.status(statusCode).sendFile(STARTUP_FALLBACK_FILE, { cacheControl: false });
  });
  app.use(express.json({ limit: REQUEST_BODY_LIMIT, verify: preserveStripeWebhookRawBody }));
  app.use(express.urlencoded({ extended: true, limit: REQUEST_BODY_LIMIT, parameterLimit: 10000 }));
  app.use(cookieParser());
  app.use(function exposeFeatureFlags(req, res, next) {
    res.locals.paymentFeatureEnabled = PaymentConfig.isEnabled();
    res.locals.tafsirTranslationFeatureEnabled = PaymentConfig.contentTranslationEnabledForItemType('tafsir');
    res.locals.contentTranslationEstimateFields = ContentTranslations.estimateFields;
    res.locals.quranRecitationFeedbackEnabled = QuranRecitationFeedback.isEnabled();
    res.locals.quranNavTafsirs = Tafsir.visibleTafsirsSync().slice().sort(function (a, b) {
      const aLabel = Tafsir.rawShortName(a, 'en') || a.shortName_en || a.name_en || a.alias || '';
      const bLabel = Tafsir.rawShortName(b, 'en') || b.shortName_en || b.name_en || b.alias || '';
      return aLabel.localeCompare(bLabel, 'en', { sensitivity: 'base' });
    });
    res.locals.Tafsir = Tafsir;
    next();
  });
  app.use(function resolveAdminMode(req, res, next) {
    const editMode = req.cookies && req.cookies.editMode == 1;
    req.admin = editMode;
    req.editMode = editMode;
    req.loginUser = null;
    req.loginSessionChecked = false;
    next();
  });
  app.use('/', express.static(PUBLIC_DIRECTORY, PUBLIC_STATIC_OPTIONS));
  app.get('/vendor/marked/marked.min.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules/marked/marked.min.js'), { cacheControl: false });
  });
  app.get('/shared/quran-review-core.js', (req, res) => {
    res.type('application/javascript');
    res.sendFile(path.join(__dirname, 'packages/quran-review-core/index.js'), { cacheControl: false });
  });
  app.use(function redirectDuplicatedBlogPaths(req, res, next) {
    const canonicalPath = canonicalBlogPath(req.path);
    if (!canonicalPath)
      return next();
    return res.redirect(301, appendQueryString(canonicalPath, requestQueryString(req)));
  });
  app.use('/blog', express.static(`${global.settings.blog.dir}`, { cacheControl: false }));

  // global redirect www
  app.all('/*', function (req, res, next) {
    if (/^www\./.test(req.hostname)) {
      res.redirect(301, `${global.settings.site.url}${req.originalUrl}`);
      return;
    }
    next();
  })

  app.all('/*', function redirectQuranPathsToQuranHost(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return next();
    const tafsirPath = TafsirAliasPaths.canonicalPath(req.path, global.commentaries);
    if (tafsirPath)
      return res.redirect(301, Utils.quranUrl(req, appendQueryString(tafsirPath, requestQueryString(req))));
    const hadithPath = quranPrefixedHadithPath(req.path);
    if (hadithPath)
      return res.redirect(301, appendQueryString(Utils.urlFor(req, hadithPath), requestQueryString(req)));
    const canonicalHadithPath = hadithBookPath(req.path);
    const hadithBaseUrl = Utils.hadithBaseUrl(req);
    if (canonicalHadithPath && hadithBaseUrl && !Utils.requestMatchesBaseUrl(req, hadithBaseUrl))
      return res.redirect(301, appendQueryString(`${hadithBaseUrl}${canonicalHadithPath}`, requestQueryString(req)));
    if (Utils.isLocalhostRequest(req) || !Utils.isQuranUrlPath(req.path))
      return next();
    const quranBaseUrl = Utils.quranBaseUrl(req);
    if (!quranBaseUrl || Utils.requestMatchesBaseUrl(req, quranBaseUrl))
      return next();
    return res.redirect(301, Utils.quranUrl(req, buildQuranHostRedirectPath(req)));
  });

  const highlightsRouter = require('./routes/highlights');
  const requestsRouter = require('./routes/requests');
  const commentedRouter = require('./routes/commented');
  const titledRouter = require('./routes/titled');
  const booksRouter = require('./routes/books');
  const tagRouter = require('./routes/tag');
  const searchRouter = require('./routes/search');
  const tafsirsRouter = require('./routes/tafsirs');
  const blogRouter = require('./routes/blog');
  const settingsRouter = require('./routes/settings');
  const loginRouter = require('./routes/login');
  const updateRouter = require('./routes/update');
  const proxyRouter = require('./routes/proxy');
  const tafsirRouter = require('./routes/tafsir');
  const translationsRouter = require('./routes/translations');
  const commentsRouter = require('./routes/comments');
  const blogCommentsRouter = require('./routes/blogComments');
  const likesRouter = require('./routes/likes');
  const likedRouter = require('./routes/liked');
  const bookmarksRouter = require('./routes/bookmarks');
  const userSettingsRouter = require('./routes/userSettings');
  const quranMemorizationRouter = require('./routes/quranMemorization');
  const paymentsRouter = require('./routes/payments');
  const contentTranslationsRouter = require('./routes/contentTranslations');

  app.use('/recent', highlightsRouter);
  app.use('/highlights', highlightsRouter);
  app.use('/commented', commentedRouter);
  app.use('/titled', titledRouter);
  app.use('/requests', requestsRouter);
  app.use('/books', booksRouter);
  app.use('/tag', tagRouter);
  app.use('/quran/tag', tagRouter);
  app.use('/api/update', updateRouter);
  app.use('/quran/api/update', updateRouter);
  app.use('/settings', settingsRouter);
  app.use('/quran/settings', settingsRouter);
  const loginPageOnly = function loginPageOnly(req, res, next) {
    if (req.method === 'GET' && /^\/(?!logout$|session$)[^/]+\/?$/.test(req.path))
      return loginRouter(req, res, next);
    next();
  };
  app.use('/login', loginPageOnly);
  app.use('/quran/login', loginPageOnly);
  app.use('/api/login', loginRouter);
  app.use('/quran/api/login', loginRouter);
  app.use('/blog', blogRouter);
  app.use('/tafsir', function (req, res) {
    res.redirect(301, Utils.quranUrl(req, '/quran/tafsir'));
  });
  app.use('/quran/tafsirs', function (req, res) {
    res.redirect(301, Utils.quranUrl(req, '/quran/tafsir'));
  });
  app.use('/quran/tafsir', tafsirsRouter);
  app.use('/quran/tafsir', tafsirRouter);
  app.use('/quran/translations', translationsRouter);
  app.use('/api/proxy', proxyRouter);
  app.use('/quran/api/proxy', proxyRouter);
  app.use('/api/comments', commentsRouter);
  app.use('/quran/api/comments', commentsRouter);
  app.use('/blog-comments', blogCommentsRouter);
  app.use('/api/likes', likesRouter);
  app.use('/quran/api/likes', likesRouter);
  app.use('/liked', likedRouter);
  app.use('/bookmarks', function bookmarksPageOnly(req, res, next) {
    if (req.method === 'GET' && (req.path === '/' || req.path === ''))
      return bookmarksRouter(req, res, next);
    next();
  });
  app.use('/api/bookmarks', bookmarksRouter);
  app.use('/api/user-settings', userSettingsRouter);
  app.use('/quran/api/user-settings', userSettingsRouter);
  app.use('/quran/api/memorization', quranMemorizationRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/quran/api/payments', paymentsRouter);
  app.use('/api/content-translations', contentTranslationsRouter);
  app.use('/quran/api/content-translations', contentTranslationsRouter);
  app.use(function redirectTranslationAliases(req, res, next) {
    const alias = req.path.replace(/^\/+/, '').replace(/\/.*$/, '');
    const pathRemainder = req.path.replace(/^\/+/, '').split('/').slice(1).filter(Boolean);
    if (alias && (global.commentaries || []).some(book => book && book.type === 'trans' && book.alias === alias)) {
      const targetPath = `/quran/${[alias].concat(pathRemainder).map(encodeURIComponent).join('/')}`;
      return res.redirect(301, Utils.quranUrl(req, `${targetPath}${requestQueryString(req) ? `?${requestQueryString(req)}` : ''}`));
    }
    next();
  });
  app.get(['/error', '/quran/error', '/error/:status', '/error/:status/*', '/quran/error/:status', '/quran/error/:status/*'], function (req, res) {
    const suffix = (req.path || '').replace(/^\/quran\/error\/?/, '').replace(/^\/error\/?/, '');
    const parts = suffix.split('/').filter(Boolean);
    let statusCode = normalizeHttpStatusCode(req.query.status);
    let errorRef = '';
    if (parts[0] && /^\d{3}$/.test(parts[0])) {
      statusCode = normalizeHttpStatusCode(parts.shift());
      if (parts[0])
        errorRef = decodeSafeUrlComponent(parts.join('/'));
    } else if (parts[0]) {
      statusCode = normalizeHttpStatusCode('404');
      errorRef = `/${parts.join('/')}`;
    }
    if (!errorRef && typeof req.query.ref === 'string')
      errorRef = req.query.ref;
    const errorReq = {
      path: req.path,
      originalUrl: errorRef || req.path,
      quranArea: req.path === '/quran/error' || req.path.indexOf('/quran/error/') === 0,
      query: {},
      cookies: req.cookies || {},
      hostname: req.hostname,
      headers: req.headers,
      protocol: req.protocol,
      get: req.get.bind(req)
    };
    res.status(statusCode);
    Object.assign(res.locals, buildErrorViewLocals(statusCode, undefined, null, errorReq, res), { errorRef: errorRef });
    res.render('error');
  });
  mountInfiniteScrollApiRoutes(app, { blogRouter, tafsirRouter, searchRouter });
  app.use('/', searchRouter);

  app.use(function (req, res, next) {
    next(createError(404, 'Requested resource not found'));
  });

  app.use(function (err, req, res, next) {
    if (res.headersSent)
      return next(err);
    if (isNotFoundError(err))
      err = createError(404, err.message);
    const statusCode = normalizeHttpStatusCode(err.status || err.statusCode || 500);
    if (err.headers && typeof err.headers === 'object') {
      Object.entries(err.headers).forEach(([name, value]) => {
        if (value !== undefined)
          res.setHeader(name, value);
      });
    }
    logHttpError(statusCode, err);
    if (wantsJsonErrorResponse(req)) {
      return res.status(statusCode).json({
        error: STATUS_CODES[statusCode] || 'Error',
        message: friendlyHttpErrorMessage(statusCode)
      });
    }
    if (statusCode !== 416 && wantsFriendlyErrorRedirect(req))
      return res.redirect(friendlyErrorRedirectStatus(req), buildFriendlyErrorUrl(req, statusCode));
    res.status(statusCode);
    Object.assign(res.locals, buildErrorViewLocals(statusCode, err.message, err, req, res));
    res.render('error');
  });

  await Hadith.a_reinit();
  app.locals.startupReady = true;
  debug.info('Application startup complete, ready to accept requests');

})();

module.exports = app;
