/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const debugFactory = require('debug');
const crypto = require('crypto');
const Utils = require('../lib/Utils');
const GoogleAuth = require('../lib/GoogleAuth');
const nodemailer = require('nodemailer');
const MarkdownIt = require('markdown-it');

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
const commonFields = 'parentId, user_uid, user_provider, user_name, user_email, user_photo, text, createdAt, up_vote, down_vote, deleted';

function createReflectionRouter(config) {
  const router = express.Router();
  const debug = debugFactory(config.debugName);
  const selectFields = `id, ${config.targetColumn}${config.extraSelect ? `, ${config.extraSelect}` : ''}, ${commonFields}`;

  function getMailer() {
    return nodemailer.createTransport({
      host: global.settings.smtp.host,
      port: parseInt(global.settings.smtp.port),
      secure: global.settings.smtp.secure,
      auth: global.settings.smtp.auth
    });
  }

  async function sendMail(message, failureLabel) {
    try {
      await getMailer().sendMail(message);
    } catch (err) {
      debug(`${failureLabel}: ${err.message}`);
    }
  }

  async function sendCommentEmail(comment) {
    const subject = config.describe(comment).subject;
    await sendMail({
      from: comment.user.email || global.settings.smtp.from,
      to: global.settings.smtp.to,
      subject: `New reflection on ${subject}`,
      text: `
New reflection posted
${subject}: ${config.describe(comment).url}
User: ${formatUser(comment.user)}

${comment.text}
`
    }, 'Email notification failed');
  }

  async function sendReplyEmail(reply, parent) {
    const recipient = Utils.trimToEmpty(parent.user_email);
    if (!recipient || recipient === 'null' || isCommentOwner(parent, reply.user)) return;
    const subject = config.describe(reply).subject;
    await sendMail({
      from: reply.user.email || global.settings.smtp.from,
      to: recipient,
      subject: `New reply to your reflection on ${subject}`,
      text: `
${reply.user.name} replied to your reflection.
${subject}: ${config.describe(reply).url}${config.replyAnchor}

Your reflection:
${parent.text}

Reply:
${reply.text}
`
    }, 'Reply email notification failed');
  }

  async function sendVoteEmail(payload) {
    const subject = config.describe(payload).subject;
    await sendMail({
      from: payload.voter.email || global.settings.smtp.from,
      to: global.settings.smtp.to,
      subject: `New ${payload.direction}vote on ${subject}`,
      text: `
New vote received
${subject}: ${config.describe(payload).url}
Reflection ID: ${payload.commentId}
Direction: ${payload.direction}
Voter: ${formatUser(payload.voter)}

Comment snippet:
${payload.text || '(no text found)'}
`
    }, 'Vote email notification failed');
  }

  async function getVoteStats(commentIds, userUid = null) {
    if (!commentIds || !commentIds.length) return {};
    const userUidEsc = userUid ? Utils.escSQL(userUid) : null;
    const userSelect = userUidEsc ? `,
             MAX(CASE WHEN user_uid='${userUidEsc}' THEN direction END) AS userVote` : '';
    const rows = await global.query(`
      SELECT commentId,
             SUM(direction='up') AS upVote,
             SUM(direction='down') AS downVote
             ${userSelect}
      FROM ${config.votesTable}
      WHERE commentId IN (${commentIds.join(',')})
      GROUP BY commentId
    `);
    const stats = {};
    rows.forEach(row => {
      stats[row.commentId] = {
        upVote: row.upVote || 0,
        downVote: row.downVote || 0,
        userVote: userUid ? (row.userVote || null) : null
      };
    });
    return stats;
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

  if (config.registerExtraRoutes) config.registerExtraRoutes(router, debug);

  router.get(`/:${config.targetParam}`, async function (req, res, next) {
    const target = getTarget(req, res);
    if (!target) return;
    try {
      let user = null;
      try {
        user = await GoogleAuth.verifyRequest(req, { allowSession: true });
      } catch (err) {
        // Ignore invalid token for public fetch.
      }
      const rows = await global.query(`
        SELECT ${selectFields}
        FROM ${config.table}
        WHERE ${config.targetColumn}=${target.sql}
        ORDER BY createdAt DESC
      `);
      const voteStats = await getVoteStats(rows.map(row => row.id), user ? user.uid : null);
      res.json(rows.map(row => formatComment(row, user, voteStats[row.id])));
    } catch (err) {
      debug(`Error loading comments:\n${err.stack}`);
      next(err);
    }
  });

  router.post(`/:${config.targetParam}`, verifyGoogle, async function (req, res, next) {
    const target = getTarget(req, res);
    if (!target) return;
    const text = Utils.trimToEmpty(req.body.text);
    const parentId = req.body.parentId ? parseInt(req.body.parentId) : null;
    if (!text || text.length > 10000) {
      res.status(400).json({ error: 'Comment text is required and must be under 10000 characters.' });
      return;
    }
    if (parentId !== null && Number.isNaN(parentId)) {
      res.status(400).json({ error: 'Invalid parent id' });
      return;
    }
    try {
      const parentRows = parentId ? await global.query(`
        SELECT user_uid, user_provider, user_email, text
        FROM ${config.table}
        WHERE id=${parentId} AND ${config.targetColumn}=${target.sql}
        LIMIT 1
      `) : [];
      if (parentId && !parentRows.length) {
        res.status(400).json({ error: 'Invalid parent id' });
        return;
      }
      const user = req.user;
      const insertRes = await global.query(`
        INSERT INTO ${config.table} (${config.targetColumn}, parentId, user_uid, user_provider, user_name, user_email, user_photo, text, createdAt, deleted)
        VALUES (${target.sql}, ${parentId || 'NULL'}, '${Utils.escSQL(user.uid)}', '${Utils.escSQL(user.provider)}', '${Utils.escSQL(user.name)}', ${user.email ? `'${Utils.escSQL(user.email)}'` : 'NULL'}, ${photoSql(user.photo)}, '${Utils.escSQL(text)}', NOW(), 0)
      `);
      if (config.afterCreate) await config.afterCreate(target);
      const rows = await getRowsById(insertRes.insertId);
      const row = rows[0];
      const comment = notificationPayload(row, user.photo);
      res.status(201).json(formatSavedComment(row, user.photo));
      sendCommentEmail(comment);
      if (parentRows[0]) sendReplyEmail(comment, parentRows[0]);
    } catch (err) {
      debug(`Error adding comment:\n${err.stack}`);
      next(err);
    }
  });

  router.put('/:commentId', verifyGoogle, async function (req, res, next) {
    const commentId = parseCommentId(req, res);
    if (!commentId) return;
    const text = Utils.trimToEmpty(req.body.text);
    if (!text || text.length > 10000) {
      res.status(400).json({ error: 'Comment text is required and must be under 10000 characters.' });
      return;
    }
    try {
      const rows = await getRowsById(commentId);
      const row = rows[0];
      if (!row) {
        res.status(404).json({ error: 'Comment not found.' });
        return;
      }
      if (row.deleted) {
        res.status(400).json({ error: 'Comment has been deleted.' });
        return;
      }
      if (!isCommentOwner(row, req.user)) {
        res.status(403).json({ error: 'You can only edit your own comment.' });
        return;
      }
      await global.query(`UPDATE ${config.table} SET text='${Utils.escSQL(text)}', user_photo=${photoSql(req.user.photo, 'user_photo')} WHERE id=${commentId}`);
      if (config.afterEdit) await config.afterEdit(row);
      const updated = (await getRowsById(commentId))[0];
      const vote = (await getVoteStats([commentId], req.user.uid))[commentId] || {};
      res.json(formatSavedComment(updated, req.user.photo, vote));
    } catch (err) {
      debug(`Error updating comment:\n${err.stack}`);
      next(err);
    }
  });

  router.delete('/:commentId', verifyGoogle, async function (req, res, next) {
    const commentId = parseCommentId(req, res);
    if (!commentId) return;
    try {
      const row = (await getRowsById(commentId))[0];
      if (!row) {
        res.status(404).json({ error: 'Comment not found.' });
        return;
      }
      if (!isCommentOwner(row, req.user)) {
        res.status(403).json({ error: 'You can only delete your own comment.' });
        return;
      }
      if (!row.deleted) {
        await global.query(`DELETE FROM ${config.votesTable} WHERE commentId=${commentId}`);
        await global.query(`UPDATE ${config.table} SET deleted=1, up_vote=0, down_vote=0 WHERE id=${commentId}`);
        if (config.afterDelete) await config.afterDelete(row);
      }
      res.json({
        ...formatSavedComment(row, req.user.photo),
        text: '',
        html: '',
        deleted: true,
        upVote: 0,
        downVote: 0,
        userVote: null,
        canEdit: false,
        canDelete: false
      });
    } catch (err) {
      debug(`Error deleting comment:\n${err.stack}`);
      next(err);
    }
  });

  router.post('/:commentId/vote', verifyGoogle, async function (req, res, next) {
    const commentId = parseCommentId(req, res);
    if (!commentId) return;
    const direction = req.body.direction === 'up' ? 'up' : req.body.direction === 'down' ? 'down' : null;
    if (!direction) {
      res.status(400).json({ error: 'Vote direction must be "up" or "down".' });
      return;
    }
    try {
      const row = (await getRowsById(commentId))[0];
      if (!row) {
        res.status(404).json({ error: 'Comment not found.' });
        return;
      }
      if (row.deleted) {
        res.status(400).json({ error: 'Comment has been deleted.' });
        return;
      }
      const escUid = Utils.escSQL(req.user.uid);
      const prevRows = await global.query(`
        SELECT direction
        FROM ${config.votesTable}
        WHERE commentId=${commentId} AND user_uid='${escUid}'
        LIMIT 1
      `);
      if (prevRows[0] && prevRows[0].direction === direction) {
        res.json(formatVote(row, (await getVoteStats([commentId], req.user.uid))[commentId], direction));
        return;
      }
      await global.query(`DELETE FROM ${config.votesTable} WHERE commentId=${commentId} AND user_uid='${escUid}'`);
      await global.query(`INSERT INTO ${config.votesTable} (commentId, user_uid, direction) VALUES (${commentId}, '${escUid}', '${direction}')`);
      const vote = (await getVoteStats([commentId], req.user.uid))[commentId] || {};
      await global.query(`UPDATE ${config.table} SET up_vote=${vote.upVote || 0}, down_vote=${vote.downVote || 0} WHERE id=${commentId}`);
      res.json(formatVote(row, vote, direction));
      sendVoteEmail({
        ...config.notificationFields(row),
        direction,
        commentId: row.id,
        text: row.text,
        voter: req.user
      });
    } catch (err) {
      debug(`Error voting on comment:\n${err.stack}`);
      next(err);
    }
  });

  function getTarget(req, res) {
    const target = config.parseTarget(req.params[config.targetParam]);
    if (!target) res.status(400).json({ error: config.invalidTargetError });
    return target;
  }

  function parseCommentId(req, res) {
    const commentId = parseInt(req.params.commentId);
    if (Number.isNaN(commentId)) {
      res.status(400).json({ error: 'Invalid comment id' });
      return null;
    }
    return commentId;
  }

  function getRowsById(commentId) {
    return global.query(`SELECT ${selectFields} FROM ${config.table} WHERE id=${commentId} LIMIT 1`);
  }

  function notificationPayload(row, fallbackPhoto) {
    return {
      ...config.notificationFields(row),
      text: row.text,
      user: buildCommentUser(row, fallbackPhoto)
    };
  }

  function formatComment(row, user, vote = {}) {
    const deleted = !!row.deleted;
    return {
      id: row.id,
      ...config.responseFields(row),
      parentId: row.parentId,
      text: deleted ? '' : row.text,
      html: deleted ? '' : md.render(row.text),
      deleted,
      ts: row.createdAt,
      upVote: deleted ? 0 : (vote.upVote || row.up_vote || 0),
      downVote: deleted ? 0 : (vote.downVote || row.down_vote || 0),
      userVote: deleted ? null : (vote.userVote || null),
      user: buildCommentUser(row),
      canEdit: !!(isCommentOwner(row, user) && !deleted),
      canDelete: !!(isCommentOwner(row, user) && !deleted)
    };
  }

  function formatSavedComment(row, fallbackPhoto, vote = {}) {
    return {
      id: row.id,
      parentId: row.parentId,
      text: row.text,
      html: md.render(row.text),
      deleted: false,
      ts: row.createdAt,
      upVote: vote.upVote || row.up_vote || 0,
      downVote: vote.downVote || row.down_vote || 0,
      userVote: vote.userVote || null,
      user: buildCommentUser(row, fallbackPhoto),
      canEdit: true,
      canDelete: true
    };
  }

  return router;
}

function isCommentOwner(comment, user) {
  if (!comment || !user) return false;
  if (comment.user_uid === user.uid) return true;
  return !!(comment.user_email && user.email && comment.user_email === user.email && comment.user_provider === user.provider);
}

function getGravatarUrl(email) {
  const normalized = Utils.trimToEmpty(email).toLowerCase();
  if (!normalized) return null;
  return `https://www.gravatar.com/avatar/${crypto.createHash('md5').update(normalized).digest('hex')}?d=mp&s=64`;
}

function photoSql(photo, fallbackSql = 'NULL') {
  const value = Utils.trimToEmpty(photo).substring(0, 1024);
  return value ? `'${Utils.escSQL(value)}'` : fallbackSql;
}

function buildCommentUser(row, fallbackPhoto = null) {
  return {
    uid: row.user_uid || null,
    provider: row.user_provider,
    name: row.user_name,
    email: row.user_email,
    photo: row.user_photo || fallbackPhoto || getGravatarUrl(row.user_email)
  };
}

function formatUser(user) {
  return `${user.name} (${user.provider}${user.email ? `, ${user.email}` : ''})`;
}

function formatVote(row, vote = {}, direction) {
  return {
    id: row.id,
    parentId: row.parentId,
    upVote: vote.upVote || row.up_vote || 0,
    downVote: vote.downVote || row.down_vote || 0,
    userVote: vote.userVote || direction
  };
}

module.exports = createReflectionRouter;
