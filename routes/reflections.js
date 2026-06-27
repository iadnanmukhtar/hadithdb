/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const debugFactory = require('../lib/Debug');
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
  const selectFields = `id, ${config.targetColumn}${config.typeColumn ? `, ${config.typeColumn}` : ''}${config.extraSelect ? `, ${config.extraSelect}` : ''}, ${commonFields}`;

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
      debug.error(`${failureLabel}: ${err.message}\n${err.stack || ''}`);
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

  async function sendReplyThreadEmails(reply, threadRows) {
    const recipients = getReplyThreadRecipients(threadRows, reply.user);
    if (!recipients.length) return;
    const subject = config.describe(reply).subject;
    const url = `${config.describe(reply).url}${config.replyAnchor}`;
    const text = `
${reply.user.name} replied in a reflection thread you are part of.
${subject}: ${url}

Reply:
${reply.text}

Conversation history:
${formatThreadHistory(threadRows)}
`;
    await Promise.all(recipients.map(recipient => sendMail({
      from: reply.user.email || global.settings.smtp.from,
      to: recipient.email,
      subject: `New reply in your reflection thread on ${subject}`,
      text
    }, 'Reply email notification failed')));
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
    const threadRows = await getVoteThreadRows(payload.row);
    await sendVoteThreadEmails(payload, threadRows);
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

  async function getReplyThreadRows(target, replyId, parentId) {
    const rows = await global.query(`
      SELECT id, parentId, user_uid, user_provider, user_name, user_email, text, createdAt
      FROM ${config.table}
      WHERE ${targetWhere(target)}
        AND deleted=0
      ORDER BY createdAt ASC, id ASC
    `);
    return getThreadRows(rows, parentId).filter(row => row.id !== replyId).concat(rows.filter(row => row.id === replyId));
  }

  async function getVoteThreadRows(row) {
    const target = targetFromRow(row);
    const rows = await global.query(`
      SELECT id, parentId, user_uid, user_provider, user_name, user_email, text, createdAt
      FROM ${config.table}
      WHERE ${targetWhere(target)}
        AND deleted=0
      ORDER BY createdAt ASC, id ASC
    `);
    return getThreadRows(rows, row.parentId || row.id);
  }

  function getThreadRows(rows, parentId) {
    const byId = new Map();
    const children = new Map();
    rows.forEach(row => {
      byId.set(row.id, row);
      const key = row.parentId || 'root';
      if (!children.has(key)) children.set(key, []);
      children.get(key).push(row);
    });

    let rootId = parentId;
    let current = byId.get(rootId);
    const seen = new Set();
    while (current && current.parentId && !seen.has(current.id)) {
      seen.add(current.id);
      rootId = current.parentId;
      current = byId.get(rootId);
    }

    const threadRows = [];
    function visit(id) {
      const row = byId.get(id);
      if (row) threadRows.push(row);
      (children.get(id) || []).forEach(child => visit(child.id));
    }
    visit(rootId);
    return threadRows;
  }

  function getReplyThreadRecipients(threadRows, replier) {
    const seen = new Set();
    const recipients = [];
    threadRows.forEach(row => {
      const email = Utils.trimToEmpty(row.user_email);
      const normalized = email.toLowerCase();
      if (!email || normalized === 'null' || seen.has(normalized) || isCommentOwner(row, replier)) return;
      seen.add(normalized);
      recipients.push({ email, name: row.user_name || 'Community Member' });
    });
    return recipients;
  }

  async function sendVoteThreadEmails(payload, threadRows) {
    const recipients = getReplyThreadRecipients(threadRows, payload.voter);
    if (!recipients.length) return;
    const subject = config.describe(payload).subject;
    const url = `${config.describe(payload).url}${config.replyAnchor}`;
    const directionLabel = payload.direction === 'down' ? 'disliked' : 'liked';
    const text = `
${payload.voter.name} ${directionLabel} a reflection in a thread you are part of.
${subject}: ${url}

Voted reflection:
${indentEmailText(payload.text || '(no text found)')}

Conversation history:
${formatThreadHistory(threadRows)}
`;
    await Promise.all(recipients.map(recipient => sendMail({
      from: payload.voter.email || global.settings.smtp.from,
      to: recipient.email,
      subject: `New ${directionLabel} reflection in your thread on ${subject}`,
      text
    }, 'Vote thread email notification failed')));
  }

  function targetFromRow(row) {
    const value = row[config.targetColumn];
    return {
      value,
      sql: sqlValue(value),
      type: config.typeColumn ? (row.type || null) : null
    };
  }

  function sqlValue(value) {
    if (typeof value === 'number') return value;
    return `'${Utils.escSQL(Utils.trimToEmpty(value))}'`;
  }

  function formatThreadHistory(threadRows) {
    if (!threadRows.length) return '(no previous comments found)';
    return threadRows.map(row => {
      const author = row.user_name || 'Community Member';
      const date = formatEmailDate(row.createdAt);
      const text = Utils.trimToEmpty(row.text) || '(empty reflection)';
      return `[${date}] ${author}:\n${indentEmailText(text)}`;
    }).join('\n\n');
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

  router.use(function noStoreReflectionResponses(req, res, next) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  if (config.registerExtraRoutes) config.registerExtraRoutes(router, debug);

  router.get(`/:${config.targetParam}`, async function (req, res, next) {
    try {
      const target = await getTarget(req, res);
      if (!target) return;
      let user = null;
      try {
        user = await GoogleAuth.verifyRequest(req, { allowSession: true });
      } catch (err) {
        // Ignore invalid token for public fetch.
      }
      const rows = await global.query(`
        SELECT ${selectFields}
        FROM ${config.table}
        WHERE ${targetWhere(target)}
        ORDER BY createdAt DESC
      `);
      const voteStats = await getVoteStats(rows.map(row => row.id), user ? user.uid : null);
      res.json(rows.map(row => formatComment(row, user, voteStats[row.id])));
    } catch (err) {
      debug.error(`Error loading comments:\n${err.stack || err.message}`);
      next(err);
    }
  });

  router.post(`/:${config.targetParam}`, verifyGoogle, async function (req, res, next) {
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
      const target = await getTarget(req, res);
      if (!target) return;
      const parentRows = parentId ? await global.query(`
        SELECT user_uid, user_provider, user_email, text
        FROM ${config.table}
        WHERE id=${parentId} AND ${targetWhere(target)}
        LIMIT 1
      `) : [];
      if (parentId && !parentRows.length) {
        res.status(400).json({ error: 'Invalid parent id' });
        return;
      }
      const user = req.user;
      const typeColumn = config.typeColumn && target.type ? `, ${config.typeColumn}` : '';
      const typeValue = config.typeColumn && target.type ? `, '${Utils.escSQL(target.type)}'` : '';
      const insertRes = await global.query(`
        INSERT INTO ${config.table} (${config.targetColumn}${typeColumn}, parentId, user_uid, user_provider, user_name, user_email, user_photo, text, createdAt, deleted)
        VALUES (${target.sql}${typeValue}, ${parentId || 'NULL'}, '${Utils.escSQL(user.uid)}', '${Utils.escSQL(user.provider)}', '${Utils.escSQL(user.name)}', ${user.email ? `'${Utils.escSQL(user.email)}'` : 'NULL'}, ${photoSql(user.photo)}, '${Utils.escSQL(text)}', NOW(), 0)
      `);
      if (config.afterCreate) await config.afterCreate(target);
      const rows = await getRowsById(insertRes.insertId);
      const row = rows[0];
      const comment = notificationPayload(row, user.photo);
      res.status(201).json(formatSavedComment(row, user.photo));
      sendCommentEmail(comment);
      if (parentRows[0]) {
        getReplyThreadRows(target, row.id, parentId)
          .then(threadRows => sendReplyThreadEmails(comment, threadRows))
          .catch(err => debug.error(`Reply thread notification failed: ${err.message}\n${err.stack || ''}`));
      }
    } catch (err) {
      debug.error(`Error adding comment:\n${err.stack || err.message}`);
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
      debug.error(`Error updating comment:\n${err.stack || err.message}`);
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
      debug.error(`Error deleting comment:\n${err.stack || err.message}`);
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
        row,
        direction,
        commentId: row.id,
        text: row.text,
        voter: req.user
      }).catch(err => debug.error(`Vote thread notification failed: ${err.message}\n${err.stack || ''}`));
    } catch (err) {
      debug.error(`Error voting on comment:\n${err.stack || err.message}`);
      next(err);
    }
  });

  async function getTarget(req, res) {
    if (config.prepareTargetStorage) await config.prepareTargetStorage();
    const rawTargetParam = req.params[config.targetParam];
    const target = config.parseTarget(rawTargetParam, req);
    if (!target) {
      res.status(400).json({ error: `${config.invalidTargetError}: ${config.targetParam}=${rawTargetParam}` });
      return null;
    }
    if (target && config.validateTarget && !(await config.validateTarget(target))) {
      res.status(404).json({ error: config.targetNotFoundError || 'Comment target not found.' });
      return null;
    }
    return target;
  }

  function targetWhere(target) {
    const typeClause = config.typeColumn && target.type ? ` AND ${config.typeColumn}='${Utils.escSQL(target.type)}'` : '';
    return `${config.targetColumn}=${target.sql}${typeClause}`;
  }

  function parseCommentId(req, res) {
    const rawCommentId = (req.params.commentId || '').toString();
    const commentId = /^\d+$/.test(rawCommentId) ? Number(rawCommentId) : NaN;
    if (!Number.isInteger(commentId) || commentId < 1) {
      res.status(400).json({ error: `Invalid route parameter 'commentId=${rawCommentId}': value must be a positive integer` });
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

function formatEmailDate(value) {
  if (!value) return 'unknown time';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return Utils.trimToEmpty(value) || 'unknown time';
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function indentEmailText(text) {
  return Utils.trimToEmpty(text).split(/\r?\n/).map(line => `  ${line}`).join('\n');
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
