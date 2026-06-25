// @ts-check
'use strict';

require('./lib/Globals');
const debug = require('./lib/Debug')('hadithdb:App');
const util = require('util');
const path = require('path');
const net = require('net');
const createError = require('http-errors');
const express = require('express');
const cookieParser = require('cookie-parser');
const { STATUS_CODES } = require('http');
const rateLimit = require('express-rate-limit').default;
const requestIp = require('request-ip');
const Hadith = require('./lib/Hadith');
const Utils = require('./lib/Utils');

const REQUEST_BODY_LIMIT = '10mb';
const DYNAMIC_REQUEST_LIMIT_WINDOW_MS = 1000;
const DYNAMIC_REQUEST_LIMIT_PER_IP = 20;

const normalizedIp = (ip) => {
  if (!ip)
    return '';
  return ip.toString().replace(/^::ffff:/, '').toLowerCase();
};

const isLoopbackIp = (ip) => {
  ip = normalizedIp(ip);
  if (!ip)
    return false;
  if (ip === 'localhost' || ip === '::1' || ip === '0:0:0:0:0:0:0:1')
    return true;
  if (net.isIPv4(ip))
    return ip === '127.0.0.1' || ip.startsWith('127.');
  return false;
};

const requestRateLimitIp = req => req.clientIp || req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';

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
  408: 'The request took too long to complete.',
  413: 'The request payload is too large.',
  414: 'The requested URL is too long.',
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

const appendQueryString = (path, queryString) => {
  if (!queryString)
    return path;
  return `${path}?${queryString}`;
};

const requestQueryString = (req) => {
  const queryIndex = (req.originalUrl || '').indexOf('?');
  return queryIndex === -1 ? '' : req.originalUrl.substring(queryIndex + 1);
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
  if (req.path === '/error')
    return false;
  if (wantsJsonErrorResponse(req))
    return false;
  const accept = req.get('accept') || '';
  return !accept || accept.includes('text/html') || accept.includes('*/*');
};

const buildFriendlyErrorUrl = (req, statusCode, message) => {
  const params = new URLSearchParams();
  params.set('status', normalizeHttpStatusCode(statusCode).toString());
  if (message)
    params.set('message', message.toString().substring(0, 300));
  if (req && req.originalUrl)
    params.set('path', req.originalUrl.substring(0, 500));
  return `/error?${params.toString()}`;
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
  return {
    req: finalReq,
    res: finalRes,
    utils: Utils,
    message: finalMessage,
    error: error || createError(statusCode, finalMessage),
    friendlyMessage: friendlyHttpErrorMessage(statusCode, finalMessage),
    statusTitle: STATUS_CODES[statusCode] || 'Error',
    suggestedPaths: statusCode === 404 ? buildErrorSuggestions(finalReq) : []
  };
};

patchAsyncRouterMethods();

const app = express();
app.renderErrorPage = function renderErrorPage(statusCode, message, error, req, res, callback) {
  return app.render('error', buildErrorViewLocals(statusCode, message, error, req, res), callback);
};

(async () => {
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');

	  app.use(requestIp.mw());
	  app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
	  app.use(express.urlencoded({ extended: true, limit: REQUEST_BODY_LIMIT, parameterLimit: 10000 }));
	  app.use(cookieParser());
	  app.use(function resolveAdminMode(req, res, next) {
	    const editMode = req.cookies && req.cookies.editMode == 1;
	    req.admin = editMode;
	    req.editMode = editMode;
	    req.loginUser = null;
	    req.loginSessionChecked = false;
	    next();
	  });
	  app.use('/', express.static(path.join(__dirname, 'public'), { dotfiles: 'allow' }));
  app.use('/blog', express.static(`${global.settings.blog.dir}`));

  const dynamicRequestLimiter = rateLimit({
    windowMs: DYNAMIC_REQUEST_LIMIT_WINDOW_MS,
    limit: DYNAMIC_REQUEST_LIMIT_PER_IP,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: requestRateLimitIp,
    skip: req => isLoopbackIp(requestRateLimitIp(req)),
    message: 'Too many requests. Please wait and try again.'
  });
  app.use(dynamicRequestLimiter);

  // global redirect www
  app.all('/*', function (req, res, next) {
    if (/^www\./.test(req.hostname)) {
      res.redirect(301, `${global.settings.site.url}${req.originalUrl}`);
      return;
    }
    next();
  })

  const toolsRouter = require('./routes/tools');
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
  const chatbotRouter = require('./routes/rag');

  app.use('/tools', toolsRouter);
  app.use('/recent', highlightsRouter);
  app.use('/highlights', highlightsRouter);
  app.use('/commented', commentedRouter);
  app.use('/titled', titledRouter);
  app.use('/requests', requestsRouter);
  app.use('/books', booksRouter);
  app.use('/tag', tagRouter);
  app.use('/quran/tag', tagRouter);
  app.use('/update', updateRouter);
  app.use('/quran/update', updateRouter);
  app.use('/settings', settingsRouter);
  app.use('/quran/settings', settingsRouter);
  app.use('/login', loginRouter);
  app.use('/quran/login', loginRouter);
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
  app.use('/proxy', proxyRouter);
  app.use('/quran/proxy', proxyRouter);
  app.use('/comments', commentsRouter);
  app.use('/quran/comments', commentsRouter);
  app.use('/blog-comments', blogCommentsRouter);
  app.use('/likes', likesRouter);
  app.use('/quran/likes', likesRouter);
  app.use('/liked', likedRouter);
  app.use('/bookmarks', bookmarksRouter);
  app.use('/user-settings', userSettingsRouter);
  app.use('/quran/user-settings', userSettingsRouter);
  app.use('/chatbot', chatbotRouter);
  app.use('/rag', chatbotRouter);
  app.use(function redirectTranslationAliases(req, res, next) {
    const alias = req.path.replace(/^\/+/, '').replace(/\/.*$/, '');
    const pathRemainder = req.path.replace(/^\/+/, '').split('/').slice(1).filter(Boolean);
    if (alias && (global.commentaries || []).some(book => book && book.type === 'trans' && book.alias === alias)) {
      const targetPath = `/quran/${[alias].concat(pathRemainder).map(encodeURIComponent).join('/')}`;
      return res.redirect(301, Utils.quranUrl(req, `${targetPath}${requestQueryString(req) ? `?${requestQueryString(req)}` : ''}`));
    }
    next();
  });
  app.use(function redirectTafsirAliases(req, res, next) {
    const alias = req.path.replace(/^\/+/, '').replace(/\/.*$/, '');
    const pathRemainder = req.path.replace(/^\/+/, '').split('/').slice(1).filter(Boolean);
    if (alias) {
      const isTafsirAlias = (global.commentaries || []).some(book => {
        if (!book || book.type !== 'tafsir')
          return false;
        if (book.alias === alias)
          return true;
        return (book.alias || '').toString().replace(/^(?:(?:en|ar)-)?(?:tafsir-)?/, '') === alias;
      });
      if (isTafsirAlias)
        return res.redirect(301, Utils.quranUrl(req, `/quran/tafsir/${[alias].concat(pathRemainder).map(encodeURIComponent).join('/')}${requestQueryString(req) ? `?${requestQueryString(req)}` : ''}`));
    }
    next();
  });
  app.get('/error', function (req, res) {
    const statusCode = normalizeHttpStatusCode(req.query.status);
    const message = typeof req.query.message === 'string'
      ? req.query.message
      : undefined;
    const originalPath = typeof req.query.path === 'string' && req.query.path
      ? req.query.path
      : req.originalUrl;
    const errorReq = {
      path: originalPath.split('?')[0] || '/',
      originalUrl: originalPath,
      query: {},
      cookies: req.cookies || {},
      hostname: req.hostname,
      headers: req.headers,
      protocol: req.protocol,
      get: req.get.bind(req)
    };
    res.status(statusCode);
    Object.assign(res.locals, buildErrorViewLocals(statusCode, message, null, errorReq, res));
    res.render('error');
  });
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
    if (wantsFriendlyErrorRedirect(req))
      return res.redirect(friendlyErrorRedirectStatus(req), buildFriendlyErrorUrl(req, statusCode, err.message));
    res.status(statusCode);
    Object.assign(res.locals, buildErrorViewLocals(statusCode, err.message, err, req, res));
    res.render('error');
  });

  await Hadith.a_reinit();
  debug('done');

})();

module.exports = app;
