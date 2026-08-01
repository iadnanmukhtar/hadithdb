/* jslint node:true, esversion:9 */
'use strict';

const { OAuth2Client } = require('google-auth-library');
const LocalAuth = require('./LocalAuth');

const client = new OAuth2Client();

function getClientId() {
  const settings = global.settings || {};
  const google = settings.google || {};
  return google.clientId || google.client_id || '';
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
  if (token) {
    if (LocalAuth.isLocalToken(token))
      return LocalAuth.verifyToken(token);
    return verifyToken(token);
  }
  return null;
}

module.exports = {
  getBearerToken,
  getClientId,
  verifyRequest,
  verifyToken
};
