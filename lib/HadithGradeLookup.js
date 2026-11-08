'use strict';

// Preserve the earliest translated row across BOTH matching rules, including
// database collation semantics. Independent equality predicates can use indexes;
// the old correlated OR forced a primary-index scan for every grade.
function translatedGraderSql(alias = 'hg') {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new TypeError('Invalid SQL alias');
  const candidate = column => `(SELECT shared_grade.id FROM hdith_hadith_grades shared_grade
    WHERE shared_grade.${column}=${alias}.${column}
      AND NULLIF(shared_grade.grader_en, '') IS NOT NULL
    ORDER BY shared_grade.id LIMIT 1)`;
  const source = candidate('grader_source_id');
  const name = candidate('grader');
  // LEAST(NULL, x) is NULL: COALESCE covers a match on only one rule.
  return `COALESCE(NULLIF(${alias}.grader_en, ''),
    (SELECT translated_grade.grader_en FROM hdith_hadith_grades translated_grade
      WHERE translated_grade.id=COALESCE(LEAST(${source}, ${name}), ${source}, ${name})),
    (SELECT gr.shortName_en FROM graders gr WHERE gr.shortName=${alias}.grader LIMIT 1))`;
}

const indexes = [
  { name: 'hdith_grade_source_lookup', columns: ['grader_source_id', 'id'] },
  { name: 'hdith_grade_name_lookup', columns: ['grader', 'id'] }
];
module.exports = { translatedGraderSql, indexes };
