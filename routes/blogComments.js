/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const debug = require('debug')('hadithdb:blog-comments');
const Utils = require('../lib/Utils');
const admin = require('../lib/Firebase');
const nodemailer = require('nodemailer');
const MarkdownIt = require('markdown-it');

const router = express.Router();
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

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
  const subject = `New reflection on blog post ${comment.slug}`;
  const body = `
New reflection posted
Blog post: ${global.settings.blog.url}/${comment.slug}
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
  const subject = `New ${payload.direction}vote on blog post ${payload.slug}`;
  const body = `
New vote received
Blog post: ${global.settings.blog.url}/${payload.slug}
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

async function getVoteStats(commentIds, userUid = null) {
  if (!commentIds || !commentIds.length) return {};
  const idsCsv = commentIds.join(',');
  const userUidEsc = userUid ? Utils.escSQL(userUid) : null;
  const userSelect = userUidEsc ? `,
           MAX(CASE WHEN user_uid='${userUidEsc}' THEN direction END) AS userVote` : '';
  const rows = await global.query(`
    SELECT commentId,
           SUM(direction='up') AS upVote,
           SUM(direction='down') AS downVote
           ${userSelect}
    FROM blog_comments_votes
    WHERE commentId IN (${idsCsv})
    GROUP BY commentId
  `);
  const stats = {};
  rows.forEach(r => {
    stats[r.commentId] = {
      upVote: r.upVote || 0,
      downVote: r.downVote || 0,
      userVote: userUid ? (r.userVote || null) : null
    };
  });
  return stats;
}

function isCommentOwner(comment, user) {
  if (!comment || !user) return false;
  if (comment.user_uid) return comment.user_uid === user.uid;
  const emailMatch = !!(comment.user_email && user.email && comment.user_email === user.email);
  return !comment.user_uid && emailMatch && comment.user_provider === user.provider;
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

router.get('/:slug', async function (req, res, next) {
  const slug = Utils.trimToEmpty(req.params.slug);
  if (!slug) {
    res.status(400).json({ error: 'Invalid blog post id' });
    return;
  }
  const escSlug = Utils.escSQL(slug);
  try {
    let user = null;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : null;
    if (token) {
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        user = {
          uid: decoded.uid,
          provider: decoded.firebase && decoded.firebase.sign_in_provider ? decoded.firebase.sign_in_provider : 'firebase',
          email: decoded.email || null
        };
      } catch (err) {
        // ignore invalid token for public fetch
      }
    }
    const rows = await global.query(`
      SELECT id, post_slug, parentId, user_uid, user_provider, user_name, user_email, text, createdAt, up_vote, down_vote, deleted
      FROM blog_comments
      WHERE post_slug='${escSlug}'
      ORDER BY createdAt DESC
    `);
    const commentIds = rows.map(r => r.id);
    const voteStats = await getVoteStats(commentIds, user ? user.uid : null);
    const comments = rows.map(r => {
      const deleted = !!r.deleted;
      const isOwner = isCommentOwner(r, user);
      const stats = voteStats[r.id] || { upVote: r.up_vote || 0, downVote: r.down_vote || 0, userVote: null };
      return {
        id: r.id,
        slug: r.post_slug,
        parentId: r.parentId,
        text: deleted ? '' : r.text,
        html: deleted ? '' : md.render(r.text),
        deleted,
        ts: r.createdAt,
        upVote: deleted ? 0 : (stats.upVote || 0),
        downVote: deleted ? 0 : (stats.downVote || 0),
        userVote: deleted ? null : (stats.userVote || null),
        user: { provider: r.user_provider, name: r.user_name, email: r.user_email },
        canEdit: !!(isOwner && !deleted),
        canDelete: !!(isOwner && !deleted)
      };
    });
    res.json(comments);
  } catch (err) {
    debug(`Error loading blog comments:\n${err.stack}`);
    next(err);
  }
});

router.post('/:slug', verifyFirebase, async function (req, res, next) {
  const slug = Utils.trimToEmpty(req.params.slug);
  if (!slug) {
    res.status(400).json({ error: 'Invalid blog post id' });
    return;
  }
  const text = Utils.trimToEmpty(req.body.text);
  const user = req.user;
  const parentId = req.body.parentId ? parseInt(req.body.parentId) : null;

  if (!text || text.length > 10000) {
    res.status(400).json({ error: 'Comment text is required and must be under 10000 characters.' });
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
    const escUid = Utils.escSQL(user.uid);
    const escProvider = Utils.escSQL(user.provider);
    const escName = Utils.escSQL(user.name);
    const escEmail = user.email ? Utils.escSQL(user.email) : null;
    const escSlug = Utils.escSQL(slug);
    const parentSql = parentId ? parentId : 'NULL';
    const insertRes = await global.query(`
      INSERT INTO blog_comments (post_slug, parentId, user_uid, user_provider, user_name, user_email, text, createdAt, deleted)
      VALUES ('${escSlug}', ${parentSql}, '${escUid}', '${escProvider}', '${escName}', '${escEmail}', '${escText}', NOW(), 0)
    `);
    const newId = insertRes.insertId;
    const rows = await global.query(`
      SELECT id, post_slug, parentId, user_uid, user_provider, user_name, user_email, text, createdAt, up_vote, down_vote, deleted
      FROM blog_comments
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
      deleted: false,
      ts: r.createdAt,
      upVote: r.up_vote || 0,
      downVote: r.down_vote || 0,
      user: { provider: r.user_provider, name: r.user_name, email: r.user_email },
      canEdit: true,
      canDelete: true
    });
    sendCommentEmail({
      id: r.id,
      slug: r.post_slug,
      text: r.text,
      user: { provider: r.user_provider, name: r.user_name, email: r.user_email }
    });
  } catch (err) {
    debug(`Error adding blog comment:\n${err.stack}`);
    next(err);
  }
});

router.put('/:commentId', verifyFirebase, async function (req, res, next) {
  const commentId = parseInt(req.params.commentId);
  if (Number.isNaN(commentId)) {
    res.status(400).json({ error: 'Invalid comment id' });
    return;
  }
  const text = Utils.trimToEmpty(req.body.text);
  if (!text || text.length > 10000) {
    res.status(400).json({ error: 'Comment text is required and must be under 10000 characters.' });
    return;
  }
  try {
    const rows = await global.query(`
      SELECT id, post_slug, parentId, user_uid, user_provider, user_name, user_email, text, createdAt, up_vote, down_vote, deleted
      FROM blog_comments
      WHERE id=${commentId}
      LIMIT 1
    `);
    if (!rows || !rows.length) {
      res.status(404).json({ error: 'Comment not found.' });
      return;
    }
    const r = rows[0];
    if (r.deleted) {
      res.status(400).json({ error: 'Comment has been deleted.' });
      return;
    }
    if (!isCommentOwner(r, req.user)) {
      res.status(403).json({ error: 'You can only edit your own comment.' });
      return;
    }
    const escText = Utils.escSQL(text);
    await global.query(`
      UPDATE blog_comments
      SET text='${escText}'
      WHERE id=${commentId}
    `);
    const updatedRows = await global.query(`
      SELECT id, post_slug, parentId, user_uid, user_provider, user_name, user_email, text, createdAt, up_vote, down_vote, deleted
      FROM blog_comments
      WHERE id=${commentId}
      LIMIT 1
    `);
    const updated = updatedRows[0];
    const stats = await getVoteStats([commentId], req.user.uid);
    const vote = stats[commentId] || { upVote: updated.up_vote || 0, downVote: updated.down_vote || 0, userVote: null };
    res.json({
      id: updated.id,
      parentId: updated.parentId,
      text: updated.text,
      html: md.render(updated.text),
      ts: updated.createdAt,
      upVote: vote.upVote || 0,
      downVote: vote.downVote || 0,
      userVote: vote.userVote || null,
      user: { provider: updated.user_provider, name: updated.user_name, email: updated.user_email },
      canEdit: true,
      canDelete: true,
      deleted: false
    });
  } catch (err) {
    debug(`Error updating blog comment:\n${err.stack}`);
    next(err);
  }
});

router.delete('/:commentId', verifyFirebase, async function (req, res, next) {
  const commentId = parseInt(req.params.commentId);
  if (Number.isNaN(commentId)) {
    res.status(400).json({ error: 'Invalid comment id' });
    return;
  }
  try {
    const rows = await global.query(`
      SELECT id, post_slug, parentId, user_uid, user_provider, user_name, user_email, text, createdAt, up_vote, down_vote
      FROM blog_comments
      WHERE id=${commentId}
      LIMIT 1
    `);
    if (!rows || !rows.length) {
      res.status(404).json({ error: 'Comment not found.' });
      return;
    }
    const r = rows[0];
    if (!isCommentOwner(r, req.user)) {
      res.status(403).json({ error: 'You can only delete your own comment.' });
      return;
    }
    if (!r.deleted) {
      await global.query(`DELETE FROM blog_comments_votes WHERE commentId=${commentId}`);
      await global.query(`
        UPDATE blog_comments
        SET deleted=1,
            up_vote=0,
            down_vote=0
        WHERE id=${commentId}
      `);
    }
    res.json({
      id: r.id,
      parentId: r.parentId,
      text: '',
      html: '',
      deleted: true,
      ts: r.createdAt,
      upVote: 0,
      downVote: 0,
      userVote: null,
      user: { provider: r.user_provider, name: r.user_name, email: r.user_email },
      canEdit: false,
      canDelete: false
    });
  } catch (err) {
    debug(`Error deleting blog comment:\n${err.stack}`);
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
    res.status(400).json({ error: 'Vote direction must be \"up\" or \"down\".' });
    return;
  }
  try {
    const rows = await global.query(`
      SELECT id, post_slug, parentId, user_provider, user_name, user_email, text, up_vote, down_vote, deleted
      FROM blog_comments
      WHERE id=${commentId}
      LIMIT 1
    `);
    if (!rows || !rows.length) {
      res.status(404).json({ error: 'Comment not found.' });
      return;
    }
    const r = rows[0];
    if (r.deleted) {
      res.status(400).json({ error: 'Comment has been deleted.' });
      return;
    }
    const escUid = Utils.escSQL(req.user.uid);
    const prevRows = await global.query(`
      SELECT direction
      FROM blog_comments_votes
      WHERE commentId=${commentId}
        AND user_uid='${escUid}'
      LIMIT 1
    `);
    const prevVote = prevRows && prevRows.length ? prevRows[0].direction : null;
    if (prevVote === direction) {
      const stats = await getVoteStats([commentId], req.user.uid);
      const current = stats[commentId] || { upVote: r.up_vote || 0, downVote: r.down_vote || 0 };
      res.json({
        id: r.id,
        parentId: r.parentId,
        upVote: current.upVote || 0,
        downVote: current.downVote || 0,
        userVote: direction
      });
      return;
    }
    await global.query(`
      DELETE FROM blog_comments_votes
      WHERE commentId=${commentId}
        AND user_uid='${escUid}'
    `);
    await global.query(`
      INSERT INTO blog_comments_votes (commentId, user_uid, direction)
      VALUES (${commentId}, '${escUid}', '${direction}')
    `);
    const stats = await getVoteStats([commentId], req.user.uid);
    const current = stats[commentId] || { upVote: 0, downVote: 0, userVote: direction };
    await global.query(`
      UPDATE blog_comments
      SET up_vote=${current.upVote || 0},
          down_vote=${current.downVote || 0}
      WHERE id=${commentId}
    `);
    res.json({
      id: r.id,
      parentId: r.parentId,
      upVote: current.upVote || 0,
      downVote: current.downVote || 0,
      userVote: current.userVote || direction
    });
    sendVoteEmail({
      direction,
      slug: r.post_slug,
      commentId: r.id,
      text: r.text,
      voter: { name: req.user.name, provider: req.user.provider, email: req.user.email || null }
    });
  } catch (err) {
    debug(`Error voting on blog comment:\n${err.stack}`);
    next(err);
  }
});

module.exports = router;
