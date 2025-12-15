/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const debug = require('debug')('hadithdb:comments');
const Utils = require('../lib/Utils');
const admin = require('../lib/Firebase');
const nodemailer = require('nodemailer');
const MarkdownIt = require('markdown-it');

const router = express.Router();
let mailer = null;
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

function parseVoteHistory(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
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

async function sendCommentEmail(comment) {
  const transport = getMailer();
  if (!transport) return;
  const subject = `New reflection on Hadith ${comment.ref}`;
  const body = `
New reflection posted
Hadith: ${global.settings.site.url}/${comment.ref}
User: ${comment.user.name} (${comment.user.provider}${comment.user.email ? ', ' + comment.user.email : ''})

${comment.text}
`;
  try {
    await transport.sendMail({
      from: comment.user.email,
      to: global.settings.smtp.to,
      subject: subject,
      text: body
    });
  } catch (e) {
    debug(`Email notification failed: ${e.message}`);
  }
}

async function sendVoteEmail(payload) {
  const transport = getMailer();
  if (!transport) return;
  const subject = `New ${payload.direction}vote on Hadith ${payload.ref}`;
  const body = `
New vote received
Hadith: ${global.settings.site.url}/${payload.ref}
Reflection ID: ${payload.commentId}
Direction: ${payload.direction}
Voter: ${payload.voter.name} (${payload.voter.provider}${payload.voter.email ? ', ' + payload.voter.email : ''})

Comment snippet:
${payload.text || '(no text found)'}
`;
  try {
    await transport.sendMail({
      from: payload.voter.email || global.settings.smtp.from,
      to: global.settings.smtp.to,
      subject,
      text: body
    });
  } catch (e) {
    debug(`Vote email notification failed: ${e.message}`);
  }
}

async function verifyFirebase(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : null;
    if (!token) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = {
      uid: decoded.uid,
      name: decoded.name || decoded.email || 'User',
      provider: decoded.firebase && decoded.firebase.sign_in_provider ? decoded.firebase.sign_in_provider : 'firebase',
      email: decoded.email || null
    };
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
  try {
    let user = null;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : null;
    if (token) {
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        user = { uid: decoded.uid };
      } catch (err) {
        // ignore invalid token for public fetch
      }
    }
    const rows = await global.query(`
      SELECT id, hadithId, parentId, user_provider, user_name, user_email, text, createdAt, up_vote, down_vote, vote_history
      FROM hadiths_comments
      WHERE hadithId=${hadithId}
      ORDER BY createdAt DESC
    `);
    const comments = rows.map(r => ({
      id: r.id,
      ref: r.ref,
      parentId: r.parentId,
      text: r.text,
      html: md.render(r.text),
      ts: r.createdAt,
      upVote: r.up_vote || 0,
      downVote: r.down_vote || 0,
      userVote: user ? parseVoteHistory(r.vote_history)[user.uid] || null : null,
      user: { provider: r.user_provider, name: r.user_name, email: r.user_email }
    }));
    res.json(comments);
  } catch (err) {
    debug(`Error loading user comments:\n${err.stack}`);
    next(err);
  }
});

router.post('/:hadithId', verifyFirebase, async function (req, res, next) {
  const hadithId = parseInt(req.params.hadithId);
  if (Number.isNaN(hadithId)) {
    res.status(400).json({ error: 'Invalid hadith id' });
    return;
  }
  const text = Utils.trimToEmpty(req.body.text);
  const user = req.user;
  const parentId = req.body.parentId ? parseInt(req.body.parentId) : null;

  if (!text || text.length > 2000) {
    res.status(400).json({ error: 'Comment text is required and must be under 2000 characters.' });
    return;
  }
  if (!user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (parentId !== null && Number.isNaN(parentId)) {
    res.status(400).json({ error: 'Invalid parent id' });
    return;
  }

  try {
    const escText = Utils.escSQL(text);
    const escProvider = Utils.escSQL(user.provider);
    const escName = Utils.escSQL(user.name);
    const escEmail = user.email ? Utils.escSQL(user.email) : null;
    const parentSql = parentId ? parentId : 'NULL';
    const insertRes = await global.query(`
      INSERT INTO hadiths_comments (hadithId, parentId, user_provider, user_name, user_email, text, createdAt)
      VALUES (${hadithId}, ${parentSql}, '${escProvider}', '${escName}', '${escEmail}', '${escText}', NOW())
    `);
    const newId = insertRes.insertId;
    await global.query(`UPDATE hadiths SET commented=(commented+1), lastfixed=CURRENT_TIMESTAMP() WHERE id=${hadithId}`);
    const rows = await global.query(`
      SELECT id, hadithId, ref_num, parentId, user_provider, user_name, user_email, text, createdAt, up_vote, down_vote, vote_history
      FROM hadiths_comments
      WHERE id=${newId}
      ORDER BY createdAt DESC
      LIMIT 1
    `);
    const r = rows[0];
    res.status(201).json({
      id: r.id,
      parentId: r.parentId,
      text: r.text,
      html: md.render(r.text),
      ts: r.createdAt,
      upVote: r.up_vote || 0,
      downVote: r.down_vote || 0,
      user: { provider: r.user_provider, name: r.user_name, email: r.user_email }
    });
    sendCommentEmail({
      id: r.id,
      ref: r.ref_num,
      hadithId,
      text: r.text,
      user: { provider: r.user_provider, name: r.user_name, email: r.user_email }
    });
  } catch (err) {
    debug(`Error adding user comment:\n${err.stack}`);
    next(err);
  }
});

router.post('/:commentId/vote', verifyFirebase, async function (req, res, next) {
  const commentId = parseInt(req.params.commentId);
  const direction = req.body.direction === 'up' ? 'up' : req.body.direction === 'down' ? 'down' : null;
  if (Number.isNaN(commentId)) {
    res.status(400).json({ error: 'Invalid comment id' });
    return;
  }
  if (!direction) {
    res.status(400).json({ error: 'Vote direction must be "up" or "down".' });
    return;
  }
  try {
    const rows = await global.query(`
      SELECT id, hadithId, ref_num, parentId, user_provider, user_name, user_email, text, up_vote, down_vote, vote_history
      FROM hadiths_comments
      WHERE id=${commentId}
      LIMIT 1
    `);
    if (!rows || !rows.length) {
      res.status(404).json({ error: 'Comment not found.' });
      return;
    }
    const r = rows[0];
    const votes = parseVoteHistory(r.vote_history);
    const prevVote = votes[req.user.uid];
    let upVote = r.up_vote || 0;
    let downVote = r.down_vote || 0;
    if (prevVote === direction) {
      res.json({
        id: r.id,
        parentId: r.parentId,
        upVote,
        downVote,
        userVote: direction
      });
      return;
    }
    if (prevVote === 'up') upVote = Math.max(0, upVote - 1);
    if (prevVote === 'down') downVote = Math.max(0, downVote - 1);
    if (direction === 'up') upVote += 1;
    if (direction === 'down') downVote += 1;
    votes[req.user.uid] = direction;
    const votesJson = Utils.escSQL(JSON.stringify(votes));
    await global.query(`
      UPDATE hadiths_comments
      SET up_vote=${upVote},
          down_vote=${downVote},
          vote_history='${votesJson}'
      WHERE id=${commentId}
    `);
    res.json({
      id: r.id,
      parentId: r.parentId,
      upVote,
      downVote,
      userVote: direction
    });
    sendVoteEmail({
      direction,
      ref: r.ref_num || r.hadithId,
      commentId: r.id,
      text: r.text,
      voter: { name: req.user.name, provider: req.user.provider, email: req.user.email || null }
    });
  } catch (err) {
    debug(`Error voting on comment:\n${err.stack}`);
    next(err);
  }
});

module.exports = router;
