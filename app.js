// @ts-check
'use strict';

require('./lib/Globals');
const debug = require('debug')('hadithdb:app');
const util = require('util');
const path = require('path');
const createError = require('http-errors');
const express = require('express');
const cookieParser = require('cookie-parser');
const { STATUS_CODES } = require('http');
const rateLimit = require('express-rate-limit').default;
const requestIp = require('request-ip');
const Hadith = require('./lib/Hadith');
const Utils = require('./lib/Utils');

const REQUEST_BODY_LIMIT = '10mb';

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

const buildErrorViewLocals = (statusCode, message, error, req, res) => {
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
	    req.admin = false;
	    req.editMode = false;
	    req.loginUser = null;
	    req.loginSessionChecked = false;
	    next();
	  });
	  app.use('/', express.static(path.join(__dirname, 'public'), { dotfiles: 'allow' }));
  app.use('/blog', express.static(`${global.settings.blog.dir}`));

  // global redirect www
  app.all('/*', function (req, res, next) {
    if (/^www\./.test(req.hostname)) {
      res.redirect(301, `${global.settings.site.url}${req.originalUrl}`);
      return;
    }
    next();
  })

  // const limiter = rateLimit({
  //   keyGenerator: req => {
  //     debug('ip address: ' + req.clientIp);
  //     return req.clientIp;
  //   },
  //   standardHeaders: true,
  //   legacyHeaders: false,
  //   windowMs: 60000,
  //   max: 50,
  // });
  // app.use(limiter);

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
  app.use('/', searchRouter);

  app.use(function (req, res, next) {
    next(createError(404, 'Requested resource not found'));
  });

  app.use(function (err, req, res, next) {
    if (res.headersSent)
      return next(err);
    if (isNotFoundError(err))
      err = createError(404, err.message);
    const statusCode = err.status || err.statusCode || 500;
    res.status(statusCode);
    Object.assign(res.locals, buildErrorViewLocals(statusCode, err.message, err, req, res));
    res.render('error');
  });

  await Hadith.a_reinit();
  debug('done');

})();

module.exports = app;
