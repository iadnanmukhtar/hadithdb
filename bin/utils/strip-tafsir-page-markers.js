/* jslint node:true, esversion:9 */
'use strict';

require('../../lib/Globals');

const MySQL = require('mysql');
const util = require('util');
const Tafsir = require('../../lib/Tafsir');

const COMMENTARY_COLUMNS = ['text', 'text_en', 'footnotes', 'footnotes_en'];
const query = util.promisify(global.dbPool.query).bind(global.dbPool);

function candidatePredicate(aliases) {
  const markerPredicate = COMMENTARY_COLUMNS.flatMap(column => [
    `LOCATE('p-', hc.${column}) > 0`,
    `LOCATE('p\\\\-', hc.${column}) > 0`,
    `LOCATE('class="page-num"', hc.${column}) > 0`,
    `LOCATE('صفحة ', hc.${column}) > 0`
  ]).join(' OR ');
  if (!aliases.length)
    return `(${markerPredicate})`;
  return `bc.alias IN (${aliases.map(MySQL.escape).join(',')}) AND (${markerPredicate})`;
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  const rows = await query(`
    SELECT bc.alias, hc.id, ${COMMENTARY_COLUMNS.map(column => `hc.${column}`).join(', ')}
    FROM books_commentaries bc
    JOIN hadiths_commentary hc ON hc.bookCommentaryId=bc.id
    WHERE ${candidatePredicate(options.aliases)}`);
  const changes = rows.map(row => normalizeRow(row)).filter(change => change.changed);
  console.log(`Candidate rows: ${rows.length}`);
  console.log(`Rows requiring cleanup: ${changes.length}`);
  summarizeChanges(changes);
  if (options.dryRun || changes.length < 1)
    return;

  const updated = options.jsLoop ? await updateChanges(changes) : await updateChangesInDb(options.aliases);
  console.log(`Updated rows: ${updated}`);

  const remaining = (await query(`
    SELECT bc.alias, hc.id, ${COMMENTARY_COLUMNS.map(column => `hc.${column}`).join(', ')}
    FROM books_commentaries bc
    JOIN hadiths_commentary hc ON hc.bookCommentaryId=bc.id
    WHERE ${candidatePredicate(options.aliases)}`))
    .map(row => normalizeRow(row))
    .filter(change => change.changed);
  console.log(`Rows still requiring cleanup: ${remaining.length}`);
}

function normalizedSql(column) {
  let expr = `hc.${column}`;
  expr = `REGEXP_REPLACE(${expr}, ?, '')`;
  expr = `REGEXP_REPLACE(${expr}, ?, '', 1, 0, 'i')`;
  expr = `REGEXP_REPLACE(${expr}, ?, ?)`;
  expr = `REGEXP_REPLACE(${expr}, ?, ?)`;
  return `TRIM(${expr})`;
}

async function updateChangesInDb(aliases) {
  const patterns = [
    '\\\\?\\(p\\\\?-[0-9\u0660-\u0669\u06F0-\u06F9]+\\\\?\\)',
    '<p[^>]*class=["\\\']page-num["\\\'][^>]*>[[:space:]]*صفحة[[:space:]]+[0-9\u0660-\u0669\u06F0-\u06F9]+[[:space:]]*</p>',
    '(^|\\n)[ \\t]*صفحة[ \\t]+[0-9\u0660-\u0669\u06F0-\u06F9]+[ \\t]*(?=\\n|$)',
    '\n',
    '\\n{3,}',
    '\n\n'
  ];
  const normalizedColumns = COMMENTARY_COLUMNS.map(column => [column, normalizedSql(column)]);
  const params = [];
  normalizedColumns.forEach(() => params.push(...patterns));
  normalizedColumns.forEach(() => params.push(...patterns));
  const result = await query(`
    UPDATE hadiths_commentary hc
    JOIN books_commentaries bc ON bc.id=hc.bookCommentaryId
    SET ${normalizedColumns.map(([column, expr]) => `hc.${column}=${expr}`).join(', ')},
      hc.lastmod=CURRENT_TIMESTAMP()
    WHERE ${candidatePredicate(aliases)}
      AND (${normalizedColumns.map(([column, expr]) => `NOT (hc.${column} <=> ${expr})`).join(' OR ')})`, params);
  return result.changedRows || result.affectedRows || 0;
}

async function updateChanges(changes) {
  let updated = 0;
  for (const change of changes) {
    const id = parseInt(change.id, 10);
    const changedColumns = COMMENTARY_COLUMNS
      .filter(column => change.values[column] !== change.original[column]);
    if (!Number.isFinite(id) || !changedColumns.length)
      continue;
    await query(`
      UPDATE hadiths_commentary
      SET ${changedColumns.map(column => `${column}=?`).join(', ')},
        lastmod=CURRENT_TIMESTAMP()
      WHERE id=?`, changedColumns.map(column => change.values[column]).concat(id));
    updated += 1;
    if (updated % 100 === 0 || updated === changes.length)
      console.log(`Updated rows so far: ${updated}/${changes.length}`);
  }
  return updated;
}

function summarizeChanges(changes) {
  const byAlias = new Map();
  changes.forEach(change => {
    byAlias.set(change.alias, (byAlias.get(change.alias) || 0) + 1);
  });
  Array.from(byAlias.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([alias, count]) => console.log(`${alias}: ${count}`));
}

function readOptions(argv) {
  const options = { aliases: [], dryRun: false, jsLoop: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run')
      options.dryRun = true;
    else if (arg === '--js-loop')
      options.jsLoop = true;
    else if (arg === '--tafsir' || arg === '--alias') {
      const alias = argv[++i];
      if (!alias)
        throw new Error(`${arg} requires an alias.`);
      options.aliases.push(alias);
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else
      throw new Error(`Unknown option '${arg}'.\n\n${usage()}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: node bin/utils/strip-tafsir-page-markers.js [options]',
    '',
    'Removes stored page markers from tafsir commentary fields.',
    '',
    'Options:',
    '  --tafsir <alias>  Limit cleanup to one tafsir alias; repeatable',
    '  --alias <alias>   Alias for --tafsir',
    '  --dry-run         Report only',
    '  --js-loop         Apply updates row by row with the JS stripper',
    '  --help            Show this help'
  ].join('\n');
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
    alias: row.alias,
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
