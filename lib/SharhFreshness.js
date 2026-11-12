'use strict';
// Preserve unknown historical dates. After adding the nullable column, set the
// default for future inserts; SQL's ON UPDATE also covers imports and revisions.
async function migrate(query, table) {
  let columns = await query(`SHOW COLUMNS FROM ${table} LIKE 'content_updated_at'`);
  if (!columns.length) {
    try { await query(`ALTER TABLE ${table} ADD COLUMN content_updated_at DATETIME(3) NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(3)`); }
    catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
  }
  if (!columns.length || columns[0].Default === null) {
    await query(`ALTER TABLE ${table} MODIFY COLUMN content_updated_at DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`);
  }
}
module.exports = { migrate };
