'use strict';

const createError = require('http-errors');

// Decode before route matching, which happens before Express decodes params.
// Keep URL delimiters and percent signs escaped so neither URL parsing nor
// Express's subsequent parameter decoding changes the meaning a second time.
module.exports = function decodeRequestPath(req, res, next) {
  const queryIndex = req.url.indexOf('?');
  const pathname = queryIndex < 0 ? req.url : req.url.slice(0, queryIndex);
  if (!pathname.includes('%') && !pathname.split('/').includes('null'))
    return next();

  let decodedPath;
  let removedNull = false;
  try {
    decodedPath = pathname.split('/').map(segment => decodeURIComponent(segment)
      .replace(/[%/?#\\\u0000-\u0020\u007f]/g, character => encodeURIComponent(character)))
      // Missing optional path values can arrive as literal "null" segments.
      // Remove them before Express chooses a route or extracts parameters.
      .filter(segment => {
        if (segment !== 'null') return true;
        removedNull = true;
        return false;
      })
      .join('/') || '/';
  } catch (error) {
    return next(createError(400, 'Malformed URL path encoding'));
  }

  const query = queryIndex < 0 ? '' : req.url.slice(queryIndex);
  if (removedNull) {
    // Keep redirects on this host even if removing null exposes leading slashes.
    return res.redirect(308, '/' + decodedPath.replace(/^\/+/, '') + query);
  }

  // Preserve the original request for logging; queries are decoded by Express.
  req.url = decodedPath + query;
  return next();
};
