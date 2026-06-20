/* jslint node:true, esversion:9 */
'use strict';

require('../../lib/Globals');

const MySQL = require('mysql');
const Tafsir = require('../../lib/Tafsir');

const COMMENTARY_COLUMNS = ['text', 'text_en', 'footnotes', 'footnotes_en'];

function candidatePredicate() {
  return COMMENTARY_COLUMNS.flatMap(column => [
    `LOCATE('p-', ${column}) > 0`,
    `LOCATE('p\\\\-', ${column}) > 0`
  ]).join(' OR ');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const rows = await global.query(`
    SELECT id, ${COMMENTARY_COLUMNS.join(', ')}
    FROM hadiths_commentary
    WHERE ${candidatePredicate()}`);
  const changes = rows.map(row => normalizeRow(row)).filter(change => change.changed);
  console.log(`Candidate rows: ${rows.length}`);
  console.log(`Rows requiring cleanup: ${changes.length}`);
  if (dryRun || changes.length < 1)
    return;

  let updated = 0;
  for (const change of changes) {
    const assignments = COMMENTARY_COLUMNS
      .filter(column => change.values[column] !== change.original[column])
      .map(column => `${column}=${MySQL.escape(change.values[column])}`);
    if (!assignments.length)
      continue;
    await global.query(`
      UPDATE hadiths_commentary
      SET ${assignments.join(', ')},
        lastmod=CURRENT_TIMESTAMP()
      WHERE id=${parseInt(change.id, 10)}`);
    updated += 1;
  }
  console.log(`Updated rows: ${updated}`);

  const remaining = (await global.query(`
    SELECT id, ${COMMENTARY_COLUMNS.join(', ')}
    FROM hadiths_commentary
    WHERE ${candidatePredicate()}`))
    .map(row => normalizeRow(row))
    .filter(change => change.changed);
  console.log(`Rows still requiring cleanup: ${remaining.length}`);
}

function normalizeRow(row) {
  const values = {};
  let changed = false;
  COMMENTARY_COLUMNS.forEach(column => {
    values[column] = Tafsir.stripPageMarkers(row[column]);
    if (values[column] !== row[column])
      changed = true;
  });
  return {
    id: row.id,
    original: row,
    values,
    changed
  };
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
