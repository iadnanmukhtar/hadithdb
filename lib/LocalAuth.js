/* jslint node:true, esversion:9 */
'use strict';

const crypto = require('crypto');

const TOKEN_PREFIX = 'hdb1';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function fromBase64url(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function getSecret() {
  const settings = global.settings || {};
  const mysql = settings.mysql || {};
  const mysqlConnection = mysql.connection || {};
  const smtp = settings.smtp || {};
  return process.env.HADITHDB_SESSION_SECRET
    || process.env.SESSION_SECRET
    || settings.sessionSecret
    || settings.authSecret
    || (settings.auth && settings.auth.secret)
    || mysql.password
    || mysqlConnection.password
    || (smtp.auth && smtp.auth.pass)
    || '';
}

function signature(payload) {
  const secret = getSecret();
  if (!secret)
    throw new Error('Local auth session secret is not configured.');
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function normalizeUser(user) {
  if (!user || typeof user !== 'object') return null;
  const uid = (user.uid || user.userId || user.email || '').toString();
  if (!uid) return null;
  return {
    uid,
    provider: user.provider || 'google.com',
    email: user.email || null,
    name: user.name || user.displayName || user.email || 'User',
    photo: user.photo || user.photoURL || null,
    admin: Boolean(user.admin)
  };
}

function signUser(user) {
  const normalized = normalizeUser(user);
  if (!normalized)
    throw new Error('Cannot sign a local auth token without a user.');
  const payload = base64url(JSON.stringify({
    v: 1,
    iat: Math.floor(Date.now() / 1000),
    user: normalized
  }));
  return `${TOKEN_PREFIX}.${payload}.${signature(payload)}`;
}

function isLocalToken(token) {
  return typeof token === 'string' && token.startsWith(`${TOKEN_PREFIX}.`);
}

function verifyToken(token) {
  if (!isLocalToken(token))
    return null;
  const parts = token.split('.');
  if (parts.length !== 3)
    throw new Error('Invalid local auth token.');
  const expected = signature(parts[1]);
  const actual = parts[2] || '';
  if (actual.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected)))
    throw new Error('Invalid local auth token signature.');
  const payload = JSON.parse(fromBase64url(parts[1]));
  if (!payload || payload.v !== 1)
    throw new Error('Invalid local auth token payload.');
  const user = normalizeUser(payload.user);
  if (!user)
    throw new Error('Invalid local auth token user.');
  return {
    ...user,
    localSession: true
  };
}

module.exports = {
  isLocalToken,
  normalizeUser,
  signUser,
  verifyToken
};
