'use strict';
// Read-only MySQL semantics test. No schema, data, or server settings are changed.
const mysql = require('mysql');
const { promisify } = require('util');
const { translatedGraderSql } = require('../lib/HadithGradeLookup');
const enabled = process.env.HADITHDB_MYSQL_READ_TEST === '1';
(enabled ? test : test.skip)('indexed grader expression preserves earliest-match, NULL, own-value and collation semantics', async () => {
  const settings = require(require('os').homedir() + '/.hadithdb/settings.json');
  const db = mysql.createConnection({...settings.mysql.connection, charset:'utf8mb4_unicode_ci',connectTimeout:8000});
  const query = promisify(db.query).bind(db);
  const rows = [
    [1,10,'Alpha','Source first'],[2,20,'Beta','Name second'],
    [3,10,'Beta',null], // earlier source wins
    [4,20,'Alpha',null], // earlier name wins
    [5,null,'BETA',null], // database case-insensitive comparison
    [6,null,'Unknown',null], // legacy fallback
    [7,10,'Alpha','Own value'],[8,10,'Alpha',''],
    [9,null,'Absent',null], [10,30,'Empty',''], [11,30,'Other',null]
  ];
  const fixture = rows.map(([id,source,name,en]) => mysql.format(
    'SELECT ? id, ? grader_source_id, CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci grader, CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci grader_en',[id,source,name,en])).join(' UNION ALL ');
  const old = `COALESCE(NULLIF(hg.grader_en,''),
    (SELECT NULLIF(shared_grade.grader_en,'') FROM hdith_hadith_grades shared_grade
     WHERE NULLIF(shared_grade.grader_en,'') IS NOT NULL AND
      ((hg.grader_source_id IS NOT NULL AND shared_grade.grader_source_id=hg.grader_source_id) OR shared_grade.grader=hg.grader)
     ORDER BY shared_grade.id LIMIT 1),
    (SELECT gr.shortName_en FROM graders gr WHERE gr.shortName=hg.grader LIMIT 1))`;
  try {
    const result = await query(`WITH hdith_hadith_grades AS (${fixture}), graders AS (
      SELECT 'Unknown' shortName, 'Legacy fallback' shortName_en)
      SELECT hg.id,${old} old_value,${translatedGraderSql()} new_value FROM hdith_hadith_grades hg ORDER BY hg.id`);
    expect(result.map(r=>r.new_value)).toEqual(['Source first','Name second','Source first','Source first','Name second','Legacy fallback','Own value','Source first',null,null,null]);
    for (const row of result) expect(row.new_value).toBe(row.old_value);
  } finally { db.end(); }
},15000);
