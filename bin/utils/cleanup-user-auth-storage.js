#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('../../lib/Globals');
const MySQL = require('mysql');

async function columnExists(tableName, columnName) {
  const rows = await global.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME=${MySQL.escape(tableName)}
      AND COLUMN_NAME=${MySQL.escape(columnName)}
    LIMIT 1
  `);
  return rows && rows.length > 0;
}

async function dropColumnIfExists(tableName, columnName) {
  if (!(await columnExists(tableName, columnName))) {
    console.log(`skip missing column ${tableName}.${columnName}`);
    return;
  }
  await global.query(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`);
  console.log(`dropped column ${tableName}.${columnName}`);
}

async function main() {
  await global.query('DROP TABLE IF EXISTS user_sessions');
  console.log('dropped table user_sessions if it existed');

  await dropColumnIfExists('user_settings', 'user_provider');
  await dropColumnIfExists('user_settings', 'user_name');
  await dropColumnIfExists('user_settings', 'user_photo');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
