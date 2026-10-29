'use strict';
const crypto = require('crypto');
const dns = require('dns').promises;
const https = require('https');
const net = require('net');
const error = require('http-errors');
const {urlFor, publicAddress} = require('./CommunityMedia');
const TYPE = 'application/activity+json';

function url(value) {
  const normalized = typeof value === 'string' && urlFor(value);
  if (!normalized || !normalized.startsWith('https://')) throw error(400, 'ActivityPub requires a public HTTPS URL.');
  return new URL(normalized);
}
function digest(body) { return 'SHA-256=' + crypto.createHash('sha256').update(body).digest('base64'); }
function sign(method, destination, body, actor, now = new Date()) {
  const target = url(destination);
  const headers = {host:target.host, date:now.toUTCString(), accept:TYPE};
  const names = ['(request-target)', 'host', 'date'];
  if (body !== undefined) { headers.digest = digest(body); headers['content-type'] = TYPE; names.push('digest'); }
  const signing = names.map(name => name + ': ' + (name === '(request-target)' ? method.toLowerCase() + ' ' + target.pathname + target.search : headers[name])).join('\n');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signing), actor.private_key).toString('base64');
  headers.signature = `keyId="${actor.url}#main-key",algorithm="rsa-sha256",headers="${names.join(' ')}",signature="${signature}"`;
  return headers;
}

// Resolve once, reject non-public answers, and pin the connection to that address.
// Redirects are deliberately not followed: signatures bind the destination.
async function request(destination, {method = 'GET', body, actor} = {}) {
  const target = url(destination), hostname = target.hostname.replace(/^\[|\]$/g, '');
  let timer;
  const addresses = await Promise.race([
    net.isIP(hostname) ? Promise.resolve([{address:hostname, family:net.isIP(hostname)}]) : dns.lookup(hostname, {all:true}),
    new Promise((_, reject) => { timer = setTimeout(() => reject(error(408, 'Federation DNS timed out.')), 3000); })
  ]).finally(() => clearTimeout(timer));
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw error(400, 'Non-public federation destination.');
  const selected = addresses[0];
  const headers = actor ? sign(method, destination, body, actor) : {accept:TYPE};
  if (body !== undefined) headers['content-length'] = Buffer.byteLength(body);
  return new Promise((resolve, reject) => {
    const req = https.request(target, {method, headers:{...headers,'user-agent':'HadithUnlocked-ActivityPub/1.0','accept-encoding':'identity'},
      lookup:(_host, options, cb) => cb(null, ...(options?.all ? [[selected]] : [selected.address, selected.family]))}, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return reject(error(502, 'Federation endpoint returned ' + res.statusCode)); }
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) req.destroy(error(413, 'Federation response too large.')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => {
        if (method !== 'GET') return resolve(null);
        if (!/application\/(?:activity\+json|ld\+json|json)/i.test(res.headers['content-type'] || '')) return reject(error(502, 'Invalid federation content type.'));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (_) { reject(error(502, 'Invalid federation JSON.')); }
      });
    });
    const deadline = setTimeout(() => req.destroy(error(408, 'Federation request timed out.')), 10000);
    req.on('close', () => clearTimeout(deadline)); req.on('error', reject);
    req.end(body);
  });
}

function signatureParameters(value) {
  if (typeof value !== 'string' || value.length > 12000) throw error(401, 'Missing HTTP signature.');
  const result = {}, parts = value.split(/,\s*/);
  for (const part of parts) {
    const match = part.match(/^([A-Za-z]+)="([^"\\]*)"$/);
    if (!match || result[match[1]] !== undefined) throw error(401, 'Invalid HTTP signature.');
    result[match[1]] = match[2];
  }
  return result;
}
async function verify(req, activity, localActor) {
  const params = signatureParameters(req.headers.signature);
  const names = (params.headers || '').split(' ');
  if (!['rsa-sha256', 'hs2019', undefined].includes(params.algorithm) ||
      !['(request-target)', 'host', 'date', 'digest'].every(n => names.includes(n)) ||
      new Set(names).size !== names.length) throw error(401, 'Required signed headers are missing.');
  const date = Date.parse(req.headers.date);
  if (!Number.isFinite(date) || Math.abs(Date.now() - date) > 5 * 60 * 1000) throw error(401, 'Expired HTTP signature.');
  const suppliedDigest = typeof req.headers.digest === 'string' && req.headers.digest.match(/^sha-256=([A-Za-z0-9+/]+={0,2})$/i);
  const expectedDigest = Buffer.isBuffer(req.body) && crypto.createHash('sha256').update(req.body).digest();
  const actualDigest = suppliedDigest && Buffer.from(suppliedDigest[1],'base64');
  if (!expectedDigest || !actualDigest || actualDigest.length !== expectedDigest.length || !crypto.timingSafeEqual(expectedDigest,actualDigest)) throw error(401, 'Invalid body digest.');
  const remoteUrl = url(activity.actor).href;
  // Fetch the claimed actor, never an independently supplied key URL. The key
  // must be explicitly owned by this same actor before any activity is accepted.
  const remote = await module.exports.request(remoteUrl, {actor:localActor});
  const keys = Array.isArray(remote.publicKey) ? remote.publicKey : [remote.publicKey];
  const key = keys.find(k => k?.id === params.keyId && k.owner === activity.actor);
  if (remote.id !== activity.actor || !key?.publicKeyPem || key.publicKeyPem.length > 16000) throw error(401, 'Actor key ownership mismatch.');
  const signing = names.map(name => {
    const value = name === '(request-target)' ? req.method.toLowerCase() + ' ' + req.originalUrl : req.headers[name];
    if (typeof value !== 'string' || /[\r\n]/.test(value)) throw error(401, 'Invalid signed header.');
    return name + ': ' + value;
  }).join('\n');
  let valid = false;
  try {
    const publicKey = crypto.createPublicKey(key.publicKeyPem);
    valid = publicKey.asymmetricKeyType === 'rsa' && crypto.verify('RSA-SHA256', Buffer.from(signing), publicKey, Buffer.from(params.signature || '', 'base64'));
  } catch (_) { /* Invalid or unsupported key. */ }
  if (!valid) throw error(401, 'Invalid HTTP signature.');
  url(remote.inbox);
  return remote;
}
module.exports = {TYPE, url, digest, sign, request, verify, signatureParameters};
