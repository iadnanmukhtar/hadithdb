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

async function addUserPhotoColumn(tableName) {
  if (await columnExists(tableName, 'user_photo')) {
    console.log(`skip existing column ${tableName}.user_photo`);
    return;
  }
  await global.query(`
    ALTER TABLE ${tableName}
    ADD COLUMN user_photo varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER user_email
  `);
  console.log(`added column ${tableName}.user_photo`);
}

async function main() {
  await addUserPhotoColumn('hadiths_comments');
  await addUserPhotoColumn('blog_comments');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
