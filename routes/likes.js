/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const debug = require('debug')('hadithdb:likes');
const nodemailer = require('nodemailer');
const Utils = require('../lib/Utils');
const GoogleAuth = require('../lib/GoogleAuth');
const { homedir } = require('os');

const router = express.Router();

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
  const subject = `New ${action} on Hadith ${payload.ref || payload.hadithId}`;
  const body = `
New ${action} received
Hadith: ${global.settings.site.url}/${payload.ref || payload.hadithId}
Hadith ID: ${payload.hadithId}
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
    debug(`Like email notification failed: ${e.message}`);
  }
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
    debug(`Auth error: ${err.message}`);
    res.status(401).json({ error: 'Invalid authentication token.' });
  }
}

router.get('/:hadithId', async function (req, res, next) {
  const hadithId = parseInt(req.params.hadithId);
  if (Number.isNaN(hadithId)) {
    res.status(400).json({ error: 'Invalid hadith id' });
    return;
  }
  const getLikeCount = async () => {
    const rows = await global.query(`
      SELECT COUNT(*) AS cnt
      FROM hadiths_likes
      WHERE hadithId=${hadithId}
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
        AND user_uid='${uidEsc}'
      LIMIT 1
    `);
    return !!(rows && rows.length);
  };
  try {
    const exists = await global.query(`SELECT id FROM hadiths WHERE id=${hadithId} LIMIT 1`);
    if (!exists || !exists.length) {
      res.status(404).json({ error: 'Hadith not found.' });
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
    res.json({ likes, liked });
  } catch (err) {
    debug(`Error fetching likes:\n${err.stack}`);
    next(err);
  }
});

router.post('/:hadithId', verifyGoogle, async function (req, res, next) {
  const hadithId = parseInt(req.params.hadithId);
  if (Number.isNaN(hadithId)) {
    res.status(400).json({ error: 'Invalid hadith id' });
    return;
  }
  try {
    var ref_nums = await global.query(`SELECT CONCAT(b.alias, ':', h.num) AS ref_num FROM hadiths h, books b WHERE h.id=${hadithId} AND h.bookId = b.id LIMIT 1`);
    await Utils.flushCacheContaining(`${ref_nums[0].ref_num}`);
    await Utils.flushCachedFile(`${homedir}/.hadithdb/cache/liked.html`);
    await Utils.flushCachedFile(`${homedir}/.hadithdb/cache/liked_feed.xml`);
    await Utils.flushCachedFile(`${homedir}/.hadithdb/cache/liked_rss.xml`);
    const requestedAction = req.body && req.body.action === 'unlike' ? 'unlike' : 'like';
    const exists = await global.query(`SELECT id FROM hadiths WHERE id=${hadithId} LIMIT 1`);
    if (!exists || !exists.length) {
      res.status(404).json({ error: 'Hadith not found.' });
      return;
    }
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
        AND user_uid='${escUid}'
      LIMIT 1
    `);
    if (existing && existing.length) {
      if (requestedAction === 'unlike') {
        await global.query(`
          DELETE FROM hadiths_likes
          WHERE hadithId=${hadithId}
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
        INSERT INTO hadiths_likes (hadithId, user_uid, user_provider, user_name, user_email, ip, ua, createdAt)
        VALUES (${hadithId}, '${escUid}', '${escProvider}', '${escName}', ${escEmail ? `'${escEmail}'` : 'NULL'}, '${escIp}', '${escUa}', NOW())
      `);
      liked = true;
      action = 'like';
    }
    const countRows = await global.query(`
      SELECT COUNT(*) AS cnt
      FROM hadiths_likes
      WHERE hadithId=${hadithId}
    `);
    const likes = countRows && countRows.length ? countRows[0].cnt || 0 : 0;
    const delta = liked ? 1 : (action === 'unlike' ? -1 : 0);
    await global.query(`
      UPDATE hadiths
      SET likes=GREATEST(0, ${likes} ${delta ? `+ (${delta})` : ''}),
          lastfixed = CURRENT_TIMESTAMP()
      WHERE id=${hadithId}
    `);
    const rows = await global.query(`
      SELECT CONCAT(b.alias, ':', h.num) as ref_num
      FROM hadiths h, books b
      WHERE h.id=${hadithId}
        AND h.bookId = b.id
      LIMIT 1
    `);
    await Utils.flushCacheContaining(`${rows[0].ref_num}`);
    const ref = rows[0].ref_num || hadithId;
    res.json({ likes, liked });
    sendLikeEmail({
      hadithId,
      ref,
      likes,
      ip: req.clientIp,
      ua: req.get('user-agent'),
      action,
      user: req.user || null
    });
  } catch (err) {
    debug(`Error updating likes:\n${err.stack}`);
    next(err);
  }
});

module.exports = router;
