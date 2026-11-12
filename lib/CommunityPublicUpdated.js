'use strict';
async function migrate(sql) {
  try { await sql('ALTER TABLE community_posts ADD COLUMN public_updated_at DATETIME(3) NULL'); }
  catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
  // Historical updated_at includes private drafts. Leave unknown revisions unset.
}
module.exports = { migrate };
