#!/usr/bin/env node
'use strict';
// Title-only writer. Revalidate the saved source against locked live records.
const fs = require('fs');
const path = require('path');
const os = require('os');
const util = require('util');
const mysql = require('mysql');
const axios = require('axios');
const { proposal } = require('./download-abuamina-hadiths');
const { parseReference, prepare, identify } = require('./identify-abuamina-hadiths');
const out = path.resolve('data/abuamina');
const confident = process.argv.includes('--confident');
const batch = process.argv.find(arg => arg.startsWith('--batch='))?.slice(8);
if (batch && !/^[a-z0-9][a-z0-9-]*$/.test(batch)) throw Error('Invalid batch name');
const auditFile = path.join(out, `${confident ? 'confident-' : ''}title-update-audit${batch ? '-' + batch : ''}.json`);
const save = audit => {
  fs.writeFileSync(auditFile + '.tmp', JSON.stringify(audit, null, 2) + '\n');
  fs.renameSync(auditFile + '.tmp', auditFile);
};

async function confidentChanges(query, posts) {
  const candidates = JSON.parse(fs.readFileSync(path.join(out, 'identification-report.json'), 'utf8'))
    .filter(p => p.status === 'identified' && p.titleEligibility === 'eligible');
  const books = await query('SELECT id,alias FROM books');
  const hasRevisions = await query("SHOW TABLES LIKE 'hadith_arabic_revision_state'");
  const changes = [], skipped = [];
  for (const alias of new Set(candidates.map(c => c.reference.alias))) {
    const book = books.find(b => b.alias === alias);
    if (!book) throw Error(`Missing collection ${alias}`);
    const sources = posts.filter(p => parseReference(p.sources[0]).alias === alias);
    const numbers = [...new Set(sources.map(p => parseReference(p.sources[0]).number).filter(Boolean))];
    const rows = await query('SELECT * FROM hadiths WHERE bookId=? AND num IN (?) AND remark<>2 ORDER BY id FOR UPDATE', [book.id, numbers]);
    const revised = hasRevisions.length && rows.length
      ? new Set((await query('SELECT hadith_id FROM hadith_arabic_revision_state WHERE hadith_id IN (?) FOR UPDATE', [rows.map(r => r.id)])).map(r => r.hadith_id)) : new Set();
    const prepared = rows.map(row => prepare({ ...row, arabic_revised: revised.has(row.id) }));
    // All exact-number peers participate, including already protected matches,
    // so a duplicate article cannot be hidden by title eligibility filtering.
    const current = sources.map(post => {
      const number = parseReference(post.sources[0]).number;
      return identify(post, prepared.filter(r => String(r.num).toLowerCase() === number));
    });
    for (const candidate of candidates.filter(c => c.reference.alias === alias)) {
      const match = current.find(p => p.sourceId === candidate.sourceId);
      const sameRecord = current.filter(p => p.status === 'identified' && p.hadithId === candidate.hadithId);
      if (match?.status !== 'identified' || match.hadithId !== candidate.hadithId || match.titleEligibility !== 'eligible' || sameRecord.length !== 1) {
        skipped.push({sourceId:candidate.sourceId,hadithId:candidate.hadithId,reason:'live-eligibility-or-identity-changed'});
        continue;
      }
      if (!match.title?.trim()) throw Error('Empty source title');
      changes.push({id:match.hadithId,sourceId:match.sourceId,sourceUrl:match.url,title:match.title,
        evidence:match.matches.find(m => m.confirmed),before:{...rows.find(r => r.id === match.hadithId)}});
    }
  }
  if (new Set(changes.map(c => c.id)).size !== changes.length) throw Error('Duplicate write targets');
  return { changes, skipped, requested:candidates.length };
}

async function main() {
  const mode = process.argv[2];
  if (!['--apply', '--verify'].includes(mode) || process.argv.slice(3).some(arg => arg !== '--confident' && !/^--batch=[a-z0-9][a-z0-9-]*$/.test(arg)))
    throw Error('Usage: node bin/utils/apply-abuamina-titles.js --apply|--verify [--confident] [--batch=NAME]');
  const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb/settings.json'), 'utf8'));
  const db = mysql.createConnection(settings.mysql.connection);
  const query = util.promisify(db.query).bind(db);
  try {
    let audit = fs.existsSync(auditFile) ? JSON.parse(fs.readFileSync(auditFile, 'utf8')) : null;
    if (!audit && mode === '--apply') {
      const posts = fs.readFileSync(path.join(out, 'hadiths.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      const candidates = JSON.parse(fs.readFileSync(path.join(out, 'enrichment-plan.json'), 'utf8')).filter(p => p.reason === 'candidate');
      await query('START TRANSACTION');
      try {
        let planned;
        if (confident) planned = await confidentChanges(query, posts);
        else {
        const rows = [];
        for (const bookId of new Set(candidates.map(c => posts.find(p => p.id === c.sourceId).reference.bookId))) {
          const numbers = [...new Set(posts.filter(p => p.reference?.bookId === bookId).map(p => p.reference.number))];
          rows.push(...await query('SELECT h.* FROM hadiths h WHERE h.bookId=? AND h.num IN (?) ORDER BY h.id FOR UPDATE', [bookId, numbers]));
        }
        const hasRevisions = await query("SHOW TABLES LIKE 'hadith_arabic_revision_state'");
        if (hasRevisions.length && rows.length) {
          const revisions = await query('SELECT hadith_id FROM hadith_arabic_revision_state WHERE hadith_id IN (?) FOR UPDATE', [rows.map(r => r.id)]);
          const revised = new Set(revisions.map(r => r.hadith_id));
          rows.forEach(r => { r.arabic_revised = revised.has(r.id); });
        }
        const proposals = posts.filter(p => p.reference).map(p => proposal(p, rows)).filter(p => p.reason === 'candidate');
        const changes = [];
        for (const candidate of candidates) {
          const matches = proposals.filter(p => p.hadithId === candidate.hadithId);
          if (matches.length !== 1 || matches[0].sourceId !== candidate.sourceId) continue;
          const current = matches[0];
          if (!current.missing.title_en?.trim()) throw Error('Empty source title');
          const before = { ...rows.find(r => r.id === candidate.hadithId) };
          delete before.arabic_revised;
          changes.push({ id: before.id, sourceId: current.sourceId, sourceUrl: current.url, title: current.missing.title_en, before });
        }
        planned = {changes};
        }
        const {changes} = planned;
        audit = { createdAt: new Date().toISOString(), status: 'prepared', ...planned };
        save(audit); // Durable before-values, even if the commit response is lost.
        for (const change of changes) {
          const result = await query('UPDATE hadiths SET title_en=? WHERE id=? AND title_en <=> ?', [change.title, change.id, change.before.title_en]);
          if (result.affectedRows !== 1) throw Error(`Title guard failed for ${change.id}`);
        }
        if (changes.length) {
          const updated = await query('SELECT * FROM hadiths WHERE id IN (?)', [changes.map(c => c.id)]);
          for (const change of changes) {
            const actual = updated.find(r => r.id === change.id);
            for (const field of Object.keys(change.before)) {
              if (!['title_en','lastmod'].includes(field) && JSON.stringify(actual[field]) !== JSON.stringify(change.before[field]))
                throw Error(`Aborting before commit: unexpected changed field ${field} for ${change.id}`);
            }
          }
        }
        await query('COMMIT');
        audit.status = 'committed';
        save(audit);
      } catch (error) {
        await query('ROLLBACK');
        throw error;
      }
    }
    if (!audit) throw Error('No title update audit found');
    const ids = audit.changes.map(c => c.id);
    if (!ids.length) { console.log('No eligible title updates'); return; }
    const rows = await query('SELECT * FROM hadiths WHERE id IN (?)', [ids]);
    const columns = await query('SHOW COLUMNS FROM hadiths');
    const automaticTimestamps = new Set(columns.filter(c => /on update CURRENT_TIMESTAMP/i.test(c.Extra)).map(c => c.Field));
    const triggers = await query('SHOW TRIGGERS WHERE `Table` = ?', ['hadiths']);
    if (triggers.some(t => t.Event === 'UPDATE' && /NEW\.`lastmod`\s*=\s*current_timestamp\(\)/i.test(t.Statement))) automaticTimestamps.add('lastmod');
    for (const change of audit.changes) {
      const actual = rows.find(r => r.id === change.id);
      if (!actual || actual.title_en !== change.title) throw Error(`Database title verification failed for ${change.id}; inspect audit before retrying`);
      for (const field of Object.keys(change.before)) {
        if (field !== 'title_en' && !automaticTimestamps.has(field) && JSON.stringify(actual[field]) !== JSON.stringify(change.before[field]))
          throw Error(`Unexpected changed field ${field} for ${change.id}`);
      }
    }
    const username = settings.search.username || settings.search.user;
    const auth = username ? { username, password: settings.search.password || settings.search.pass || '' } : undefined;
    const config = { auth, timeout: 60000 };
    const fields = ['title_en', 'title_en_search', 'title_en_prefix', 'title_search_en', 'title_search_en_prefix'];
    if (mode === '--apply') {
      const bulk = audit.changes.map(c => JSON.stringify({ update: { _id: c.id } }) + '\n' + JSON.stringify({ doc: Object.fromEntries(fields.map(f => [f, c.title])) }) + '\n').join('');
      const result = await axios.post(`${settings.search.domain}/hadiths/_bulk?refresh=true`, bulk, { ...config, headers: { 'Content-Type': 'application/x-ndjson' } });
      if (result.data.errors) throw Error('Search update failed; rerun --apply to retry indexing from the audit without repeating database writes');
    }
    const search = await axios.post(`${settings.search.domain}/hadiths/_mget`, { docs: ids.map(id => ({ _id: id, _source: fields })) }, config);
    for (const change of audit.changes) {
      const doc = search.data.docs.find(d => String(d._id) === String(change.id));
      if (!doc?.found || fields.some(f => doc._source[f] !== change.title)) throw Error(`Search verification failed for ${change.id}`);
    }
    audit.status = 'verified';
    audit.verifiedAt = new Date().toISOString();
    save(audit);
    console.log(JSON.stringify({ titlesUpdated: ids.length, databaseVerified: rows.length, searchVerified: search.data.docs.length, otherContentUnchanged: true, automaticTimestamps: [...automaticTimestamps], auditFile }));
  } finally { db.end(); }
}
main().catch(error => { console.error(error.response?.data?.error ? JSON.stringify(error.response.data.error) : error.message); process.exitCode = 1; });
