/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const debug = require('debug')('hadithdb:comments');
const Utils = require('../lib/Utils');
const admin = require('../lib/Firebase');

const router = express.Router();

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
    const rows = await global.query(`
      SELECT id, hadithId, parentId, user_provider, user_name, user_email, text, createdAt
      FROM hadiths_comments
      WHERE hadithId=${hadithId}
      ORDER BY createdAt ASC, id ASC
    `);
    const comments = rows.map(r => ({
      id: r.id,
      parentId: r.parentId,
      text: r.text,
      ts: r.createdAt,
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
      SELECT id, hadithId, parentId, user_provider, user_name, user_email, text, createdAt
      FROM hadiths_comments
      WHERE id=${newId}
      LIMIT 1
    `);
    const r = rows[0];
    res.status(201).json({
      id: r.id,
      parentId: r.parentId,
      text: r.text,
      ts: r.createdAt,
      user: { provider: r.user_provider, name: r.user_name, email: r.user_email }
    });
  } catch (err) {
    debug(`Error adding user comment:\n${err.stack}`);
    next(err);
  }
});

module.exports = router;
