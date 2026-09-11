'use strict';

const crypto = require('crypto');

function config() {
  const settings = global.settings || {};
  const chat = settings.chatkit || {};
  const apiKey = process.env.OPENAI_API_KEY || settings.openAI?.key || '';
  const secret = process.env.CHATKIT_SECRET || chat.secret || (apiKey
    ? crypto.createHmac('sha256', apiKey).update('hadithdb-chatkit-v1').digest('hex') : '');
  return {
    enabled: process.env.CHATKIT_ENABLED !== '0' && chat.enabled !== false,
    // Publishable embed key, restricted to this site's domains in OpenAI's dashboard.
    domainKey: process.env.CHATKIT_DOMAIN_KEY || chat.domainKey || 'domain_pk_6aa48b5d165c8193b407e3d4861255520a7706b6b99c6602',
    endpoint: process.env.CHATKIT_ENDPOINT || chat.endpoint || 'http://127.0.0.1:8011/chatkit',
    secret
  };
}

module.exports = { config };
