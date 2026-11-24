'use strict';

// Only reached for requests Nginx would otherwise reject with HTTP 429.
module.exports = async function adminAbuseBypass(req, res, next) {
  if (req.headers['x-hadith-abuse-gate'] !== '1') return next();
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const GoogleAuth = require('./GoogleAuth');
    const LocalAuth = require('./LocalAuth');
    const cookies = require('cookie').parse(req.headers.cookie || '');
    const user = GoogleAuth.getBearerToken(req)
      ? await GoogleAuth.verifyRequest(req)
      : LocalAuth.verifyToken(cookies.hadith_admin_session);
    if (user && await require('./UserSettings').isAdminUser(user.uid)) {
      res.setHeader('X-Verified-Admin-Bypass', '1');
      return next();
    }
  } catch (_) {
    // Authentication and database failures must never grant an exemption.
  }
  res.status(429).json({ error: 'Too many requests. A valid administrator session is required to bypass this limit.' });
};
