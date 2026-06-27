/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const debug = require('../lib/Debug')('hadithdb:Likes');
const nodemailer = require('nodemailer');
const Utils = require('../lib/Utils');
const GoogleAuth = require('../lib/GoogleAuth');
const { homedir } = require('os');

const router = express.Router();
const LIKE_TYPES = new Set(['hadith', 'toc']);
let likesTypeColumnReady;

function normalizeLikeType(value) {
  return LIKE_TYPES.has(value) ? value : 'hadith';
}

function parsePositiveId(value) {
  value = (value || '').toString();
  if (!/^\d+$/.test(value))
    return NaN;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : NaN;
}

async function ensureLikesTypeColumn() {
  if (!likesTypeColumnReady) {
    likesTypeColumnReady = (async () => {
      const rows = await global.query(`
        SELECT 1
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'hadiths_likes'
          AND COLUMN_NAME = 'type'
        LIMIT 1
      `);
      if (rows && rows.length)
        return;
      await global.query(`
        ALTER TABLE hadiths_likes
        ADD COLUMN \`type\` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'hadith' AFTER hadithId
      `);
      await global.query(`
        CREATE INDEX ndx_hadiths_likes_type_target_user
        ON hadiths_likes (\`type\`, hadithId, user_uid)
      `);
    })();
  }
  return likesTypeColumnReady;
}

async function targetForLike(type, id) {
  if (type === 'toc') {
    const rows = await global.query(`
      SELECT tId AS id, path
      FROM v_toc
      WHERE tId=${id} OR hId=${id}
      LIMIT 1
    `);
    if (!rows || !rows.length)
      return null;
    return {
      id,
      type,
      label: 'Quran passage',
      ref: rows[0].path || id
    };
  }
  const rows = await global.query(`
    SELECT h.id, CONCAT(b.alias, ':', h.num) AS ref_num
    FROM hadiths h
    JOIN books b ON h.bookId = b.id
    WHERE h.id=${id}
    LIMIT 1
  `);
  if (!rows || !rows.length)
    return null;
  return {
    id,
    type,
    label: 'Hadith',
    ref: rows[0].ref_num || id
  };
}

function getMailer() {
  const mailer = nodemailer.createTransport({
    host: global.settings.smtp.host,
    port: parseInt(global.settings.smtp.port),
    secure: global.settings.smtp.secure,
    auth: global.settings.smtp.auth
  });
  return mailer;
}

async function sendLikeEmail(payload) {
  const transport = getMailer();
  if (!transport) return;
  const action = payload.action === 'unlike' ? 'unlike' : 'like';
  const targetLabel = payload.type === 'toc' ? 'TOC passage' : 'Hadith';
  const subject = `New ${action} on ${targetLabel} ${payload.ref || payload.hadithId}`;
  const url = itemUrl(payload);
  const body = `
New ${action} received
Target: ${url}
Target Type: ${payload.type || 'hadith'}
Target ID: ${payload.hadithId}
Likes total: ${payload.likes}
Visitor: IP ${payload.ip || 'unknown'} | UA ${payload.ua || 'unknown'}
User: ${payload.user ? `${payload.user.name || 'User'} (${payload.user.provider || 'google.com'}${payload.user.email ? ', ' + payload.user.email : ''})` : 'Unknown'}
`;
  try {
    await transport.sendMail({
      from: global.settings.smtp.from,
      to: global.settings.smtp.to,
      subject,
      text: body
    });
  } catch (e) {
    debug.error(`Like email notification failed: ${e.message}\n${e.stack || ''}`);
  }
  if (action === 'like')
    await sendLikeParticipantEmails(payload, url, targetLabel);
}

async function sendLikeParticipantEmails(payload, url, targetLabel) {
  const recipients = await getLikeRecipients(payload);
  if (!recipients.length) return;
  const userLabel = payload.user ? `${payload.user.name || 'Someone'}` : 'Someone';
  const body = `
${userLabel} liked ${targetLabel} ${payload.ref || payload.hadithId}.
${url}

Likes total: ${payload.likes}
`;
  await Promise.all(recipients.map(recipient => sendMail({
    from: global.settings.smtp.from,
    to: recipient.email,
    subject: `New like on ${targetLabel} ${payload.ref || payload.hadithId}`,
    text: body
  }, 'Like participant email notification failed')));
}

async function getLikeRecipients(payload) {
  const rows = await global.query(`
    SELECT user_uid, user_provider, user_email
    FROM hadiths_likes
    WHERE hadithId=${payload.hadithId}
      AND \`type\`='${Utils.escSQL(payload.type || 'hadith')}'
      AND user_email IS NOT NULL
  `);
  const seen = new Set();
  const recipients = [];
  rows.forEach(row => {
    const email = Utils.trimToEmpty(row.user_email);
    const normalized = email.toLowerCase();
    if (!email || normalized === 'null' || seen.has(normalized) || isLikeOwner(row, payload.user)) return;
    seen.add(normalized);
    recipients.push({ email });
  });
  return recipients;
}

async function sendMail(message, failureLabel) {
  try {
    await getMailer().sendMail(message);
  } catch (err) {
    debug.error(`${failureLabel}: ${err.message}\n${err.stack || ''}`);
  }
}

function isLikeOwner(row, user) {
  if (!row || !user) return false;
  if (row.user_uid === user.uid) return true;
  return !!(row.user_email && user.email && row.user_email === user.email && row.user_provider === user.provider);
}

function itemUrl(payload) {
  const site = global.settings && global.settings.site ? global.settings.site : {};
  const baseUrl = payload.type === 'toc' ? (site.quranUrl || site.url || '') : (site.url || '');
  return `${baseUrl.replace(/\/$/, '')}/${String(payload.ref || payload.hadithId).replace(/^\//, '')}`;
}

async function verifyGoogle(req, res, next) {
  try {
    req.user = await GoogleAuth.verifyRequest(req, { allowSession: true });
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    next();
  } catch (err) {
    debug.error(`Auth error: ${err.message}\n${err.stack || ''}`);
    res.status(401).json({ error: 'Invalid authentication token.' });
  }
}

router.get('/:hadithId', async function (req, res, next) {
  const hadithId = parsePositiveId(req.params.hadithId);
  const type = normalizeLikeType(req.query.type);
  const typeEsc = Utils.escSQL(type);
  if (!Number.isInteger(hadithId) || hadithId < 1) {
    res.status(400).json({ error: `Invalid route parameter 'hadithId=${req.params.hadithId}': value must be a positive integer` });
    return;
  }
  const getLikeCount = async () => {
    const rows = await global.query(`
      SELECT COUNT(*) AS cnt
      FROM hadiths_likes
      WHERE hadithId=${hadithId}
        AND \`type\`='${typeEsc}'
    `);
    return rows && rows.length ? rows[0].cnt || 0 : 0;
  };
  const getLikedFlag = async (userUid) => {
    if (!userUid) return false;
    const uidEsc = Utils.escSQL(userUid);
    const rows = await global.query(`
      SELECT 1
      FROM hadiths_likes
      WHERE hadithId=${hadithId}
        AND \`type\`='${typeEsc}'
        AND user_uid='${uidEsc}'
      LIMIT 1
    `);
    return !!(rows && rows.length);
  };
  try {
    await ensureLikesTypeColumn();
    const target = await targetForLike(type, hadithId);
    if (!target) {
      res.status(404).json({ error: 'Like target not found.' });
      return;
    }
    let userUid = null;
    try {
      const user = await GoogleAuth.verifyRequest(req, { allowSession: true });
      userUid = user && user.uid;
    } catch (err) {
      // ignore invalid token for public fetch
    }
    const likes = await getLikeCount();
    const liked = await getLikedFlag(userUid);
    res.json({ likes, liked, type });
  } catch (err) {
    debug.error(`Error fetching likes:\n${err.stack || err.message}`);
    next(err);
  }
});

router.post('/:hadithId', verifyGoogle, async function (req, res, next) {
  const hadithId = parsePositiveId(req.params.hadithId);
  const type = normalizeLikeType((req.body && req.body.type) || req.query.type);
  const typeEsc = Utils.escSQL(type);
  if (!Number.isInteger(hadithId) || hadithId < 1) {
    res.status(400).json({ error: `Invalid route parameter 'hadithId=${req.params.hadithId}': value must be a positive integer` });
    return;
  }
  try {
    await ensureLikesTypeColumn();
    const target = await targetForLike(type, hadithId);
    if (!target) {
      res.status(404).json({ error: 'Like target not found.' });
      return;
    }
    await Utils.flushCacheContaining(`${target.ref}`);
    await Utils.flushCachedFile(`${homedir}/.hadithdb/cache/liked.html`);
    await Utils.flushCachedFile(`${homedir}/.hadithdb/cache/liked_feed.xml`);
    await Utils.flushCachedFile(`${homedir}/.hadithdb/cache/liked_rss.xml`);
    const requestedAction = req.body && req.body.action === 'unlike' ? 'unlike' : 'like';
    const escUid = Utils.escSQL(req.user.uid);
    const escProvider = Utils.escSQL(req.user.provider || 'google.com');
    const escName = Utils.escSQL(req.user.name || 'User');
    const escEmail = req.user.email ? Utils.escSQL(req.user.email) : null;
    const escIp = Utils.escSQL(req.clientIp || '');
    const escUa = Utils.escSQL(req.get('user-agent') || '');
    let liked = false;
    let action = 'like';
    const existing = await global.query(`
      SELECT id
      FROM hadiths_likes
      WHERE hadithId=${hadithId}
        AND \`type\`='${typeEsc}'
        AND user_uid='${escUid}'
      LIMIT 1
    `);
    if (existing && existing.length) {
      if (requestedAction === 'unlike') {
        await global.query(`
          DELETE FROM hadiths_likes
          WHERE hadithId=${hadithId}
            AND \`type\`='${typeEsc}'
            AND user_uid='${escUid}'
          LIMIT 1
        `);
        liked = false;
        action = 'unlike';
      } else {
        liked = true;
        action = 'like';
      }
    } else if (requestedAction === 'like') {
      await global.query(`
        INSERT INTO hadiths_likes (hadithId, \`type\`, user_uid, user_provider, user_name, user_email, ip, ua, createdAt)
        VALUES (${hadithId}, '${typeEsc}', '${escUid}', '${escProvider}', '${escName}', ${escEmail ? `'${escEmail}'` : 'NULL'}, '${escIp}', '${escUa}', NOW())
      `);
      liked = true;
      action = 'like';
    }
    const countRows = await global.query(`
      SELECT COUNT(*) AS cnt
      FROM hadiths_likes
      WHERE hadithId=${hadithId}
        AND \`type\`='${typeEsc}'
    `);
    const likes = countRows && countRows.length ? countRows[0].cnt || 0 : 0;
    if (type === 'hadith') {
      const delta = liked ? 1 : (action === 'unlike' ? -1 : 0);
      await global.query(`
        UPDATE hadiths
        SET likes=GREATEST(0, ${likes} ${delta ? `+ (${delta})` : ''}),
            lastfixed = CURRENT_TIMESTAMP()
        WHERE id=${hadithId}
      `);
    }
    await Utils.flushCacheContaining(`${target.ref}`);
    const ref = target.ref || hadithId;
    res.json({ likes, liked, type });
    sendLikeEmail({
      hadithId,
      type,
      ref,
      likes,
      ip: req.clientIp,
      ua: req.get('user-agent'),
      action,
      user: req.user || null
    }).catch(err => debug.error(`Like participant notification failed: ${err.message}\n${err.stack || ''}`));
  } catch (err) {
    debug.error(`Error updating likes:\n${err.stack || err.message}`);
    next(err);
  }
});

module.exports = router;
