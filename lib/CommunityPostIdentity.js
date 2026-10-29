'use strict';
const {randomUUID} = require('crypto');
const valid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const url = row => valid(row.guid) ? '/community/p/' + row.guid.toLowerCase() : `/community/@${row.handle}/${row.id}`;
async function migrate(q) {
  try { await q('ALTER TABLE community_posts ADD COLUMN guid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL'); }
  catch (err) { if (err.code !== 'ER_DUP_FIELDNAME') throw err; }
  try { await q('ALTER TABLE community_posts ADD UNIQUE KEY community_posts_guid (guid)'); }
  catch (err) { if (err.code !== 'ER_DUP_KEYNAME') throw err; }
  // UUIDv4 uses cryptographic randomness, unlike MySQL's time-based UUID().
  // Conditional writes preserve identities if startup workers overlap.
  while (true) {
    const rows = await q('SELECT id FROM community_posts WHERE guid IS NULL ORDER BY id LIMIT 500');
    if (!rows.length) break;
    const cases = rows.map(() => 'WHEN ? THEN ?').join(' ');
    await q(`UPDATE community_posts SET guid=CASE id ${cases} END WHERE guid IS NULL AND id IN (?)`,
      [...rows.flatMap(row => [row.id,randomUUID()]), rows.map(row=>row.id)]);
  }
}
module.exports = {valid,url,create:randomUUID,migrate};
