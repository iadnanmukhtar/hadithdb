'use strict';

const createError = require('http-errors');

// Decode before route matching, which happens before Express decodes params.
// Keep URL delimiters and percent signs escaped so neither URL parsing nor
// Express's subsequent parameter decoding changes the meaning a second time.
module.exports = function decodeRequestPath(req, res, next) {
  const queryIndex = req.url.indexOf('?');
  const pathname = queryIndex < 0 ? req.url : req.url.slice(0, queryIndex);
  if (!pathname.includes('%'))
    return next();

  let decodedPath;
  try {
    decodedPath = pathname.split('/').map(segment => decodeURIComponent(segment)
      .replace(/[%/?#\\\u0000-\u0020\u007f]/g, character => encodeURIComponent(character)))
      .join('/');
  } catch (error) {
    return next(createError(400, 'Malformed URL path encoding'));
  }

  // Preserve the original request for logging; queries are decoded by Express.
  req.url = decodedPath + (queryIndex < 0 ? '' : req.url.slice(queryIndex));
  return next();
};
