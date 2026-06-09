/* jslint node:true, esversion:9 */
'use strict';

const { OAuth2Client } = require('google-auth-library');
const UserSettings = require('./UserSettings');

const client = new OAuth2Client();

function getClientId() {
  const settings = global.settings || {};
  const google = settings.google || {};
  const firebase = settings.firebase || {};
  return google.clientId || google.client_id || firebase.googleClientId || firebase.clientId || firebase.client_id || '';
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : null;
}

async function verifyToken(token) {
  const clientId = getClientId();
  if (!clientId) throw new Error('Google client id is not configured.');
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: clientId
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub) throw new Error('Invalid Google token payload.');
  return {
    uid: payload.sub,
    provider: 'google.com',
    email: payload.email || null,
    name: payload.name || payload.email || 'User',
    photo: payload.picture || null
  };
}

async function verifyRequest(req, options = {}) {
  const token = getBearerToken(req);
  if (token) return verifyToken(token);
  if (!options.allowSession) return null;
  if (req && req.loginSessionChecked)
    return req.loginUser || null;
  const sessionToken = req.cookies && req.cookies.hadithSession;
  return UserSettings.getLoginUserBySession(sessionToken);
}

module.exports = {
  getBearerToken,
  getClientId,
  verifyRequest,
  verifyToken
};
