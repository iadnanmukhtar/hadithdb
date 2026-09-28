'use strict';

const GoogleAuth = require('./GoogleAuth');
const LocalAuth = require('./LocalAuth');
const UserSettings = require('./UserSettings');

const COOKIE = 'hadith_admin_session';
const cookieOptions = req => ({ httpOnly: true, secure: req.secure, sameSite: 'strict', path: '/admin', maxAge: 60 * 60 * 1000 });

function privateResponse(req, res, next) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Vary', 'Cookie, Authorization');
  next();
}

async function authorize(req, res, next) {
  try {
    const bearer = GoogleAuth.getBearerToken(req);
    const user = bearer ? await GoogleAuth.verifyRequest(req)
      : LocalAuth.verifyToken(req.cookies && req.cookies[COOKIE]);
    if (!user) return res.status(401).send('Sign in as an administrator to access this page.');
    // Recheck current membership rather than trusting a cached admin flag.
    if (!await UserSettings.isAdminUser(user.uid)) return res.status(403).send('Administrator access required.');
    req.user = user;
    req.admin = true;
    req.editMode = true;
    next();
  } catch (error) {
    return res.status(401).send('Invalid or expired administrator session.');
  }
}

function createSession(req, res) {
  res.cookie(COOKIE, LocalAuth.signUser(req.user), cookieOptions(req));
  res.json({ admin: true });
}

module.exports = { COOKIE, authorize, createSession, privateResponse };
