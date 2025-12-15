/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const debug = require('debug')('hadithdb:likes');
const nodemailer = require('nodemailer');

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
  const subject = `New like on Hadith ${payload.ref || payload.hadithId}`;
  const body = `
New like received
Hadith: ${global.settings.site.url}/${payload.ref || payload.hadithId}
Hadith ID: ${payload.hadithId}
Likes total: ${payload.likes}
Visitor: IP ${payload.ip || 'unknown'} | UA ${payload.ua || 'unknown'}
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

router.get('/:hadithId', async function (req, res, next) {
  const hadithId = parseInt(req.params.hadithId);
  if (Number.isNaN(hadithId)) {
    res.status(400).json({ error: 'Invalid hadith id' });
    return;
  }
  try {
    const rows = await global.query(`
      SELECT likes
      FROM hadiths
      WHERE id=${hadithId}
      LIMIT 1
    `);
    if (!rows || !rows.length) {
      res.status(404).json({ error: 'Hadith not found.' });
      return;
    }
    res.json({ likes: rows[0].likes || 0 });
  } catch (err) {
    debug(`Error fetching likes:\n${err.stack}`);
    next(err);
  }
});

router.post('/:hadithId', async function (req, res, next) {
  const hadithId = parseInt(req.params.hadithId);
  if (Number.isNaN(hadithId)) {
    res.status(400).json({ error: 'Invalid hadith id' });
    return;
  }
  try {
    const updateRes = await global.query(`
      UPDATE hadiths
      SET likes = IFNULL(likes, 0) + 1,
          lastfixed = CURRENT_TIMESTAMP()
      WHERE id=${hadithId}
    `);
    if (!updateRes.affectedRows) {
      res.status(404).json({ error: 'Hadith not found.' });
      return;
    }
    const rows = await global.query(`
      SELECT likes
      FROM hadiths
      WHERE id=${hadithId}
      LIMIT 1
    `);
    const ref = rows[0].ref_num || hadithId;
    const likes = rows[0].likes || 0;
    res.json({ likes });
    sendLikeEmail({
      hadithId,
      ref,
      likes,
      ip: req.clientIp,
      ua: req.get('user-agent')
    });
  } catch (err) {
    debug(`Error updating likes:\n${err.stack}`);
    next(err);
  }
});

module.exports = router;
