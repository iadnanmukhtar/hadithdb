/* jslint node:true, esversion:9 */
'use strict';

const MySQL = require('mysql');
const PaymentConfig = require('./PaymentConfig');
const UserPoints = require('./UserPoints');
const Utils = require('./Utils');

const TRANSLATION_FIELDS = Object.freeze([
	Object.freeze({ column: 'text', jsonKey: 'text', boost: 4 }),
	Object.freeze({ column: 'footnote', jsonKey: 'footnotes', boost: 2 })
]);
const BASE_LANGUAGE_CODES = new Set(['ar', 'en']);
const LANGUAGE_CODE_PATTERN = /^[a-z][a-z0-9]{1,15}$/;

function sql(value) {
	return MySQL.escape(Utils.trimToEmpty(value));
}

function columnName(field, code) {
	return `${field}_${code}`;
}

function normalizeLanguageCode(code) {
	code = Utils.trimToEmpty(code).toLowerCase();
	if (BASE_LANGUAGE_CODES.has(code) || !LANGUAGE_CODE_PATTERN.test(code))
		return '';
	return code;
}

function translationLanguageCodes(languages) {
	const seen = new Set();
	return (Array.isArray(languages) ? languages : PaymentConfig.supportedLanguages())
		.map(language => normalizeLanguageCode(language && (language.code || language)))
		.filter(code => {
			if (!code || seen.has(code))
				return false;
			seen.add(code);
			return true;
		})
		.sort();
}

function expectedTranslationColumnNames(codes) {
	const columns = [];
	translationLanguageCodes(codes).forEach(code => {
		TRANSLATION_FIELDS.forEach(field => columns.push(columnName(field.column, code)));
	});
	return columns;
}

function translationSelectColumns(codes, alias) {
	alias = Utils.trimToEmpty(alias || 'ct').replace(/[^A-Za-z0-9_]+/g, '') || 'ct';
	return expectedTranslationColumnNames(codes).map(column => `${alias}.${column} AS ${column}`);
}

function translationAggregateColumns(codes) {
	const columns = [];
	translationLanguageCodes(codes).forEach(code => {
		TRANSLATION_FIELDS.forEach(field => {
			columns.push(`MAX(CASE WHEN target_language=${sql(code)} THEN JSON_UNQUOTE(JSON_EXTRACT(content_json, '$.${field.jsonKey}')) END) AS ${columnName(field.column, code)}`);
		});
	});
	return columns;
}

function translationJoinSql(codes, alias) {
	codes = translationLanguageCodes(codes);
	alias = Utils.trimToEmpty(alias || 'ct').replace(/[^A-Za-z0-9_]+/g, '') || 'ct';
	if (!codes.length)
		return '';
	return `
LEFT JOIN (
	SELECT
		item_id,
		${translationAggregateColumns(codes).join(',\n\t\t')}
	FROM (
		SELECT
			item_id,
			target_language,
			content_json,
			ROW_NUMBER() OVER (
				PARTITION BY item_id, target_language
				ORDER BY updatedAt DESC, id DESC
			) AS row_num
		FROM user_content_translations
		WHERE item_type='tafsir'
			AND mode='translate'
			AND target_language IN (${codes.map(sql).join(',')})
	) ranked_translations
	WHERE row_num=1
	GROUP BY item_id
) ${alias} ON ${alias}.item_id=CAST(hc.id AS CHAR)`;
}

async function loadIndexFields(options) {
	options = options || {};
	await UserPoints.ensureTables();
	const languages = options.languages || await PaymentConfig.loadLanguages(options.forceLanguages ? { force: true } : undefined);
	const codes = translationLanguageCodes(languages);
	const columns = expectedTranslationColumnNames(codes);
	return Object.freeze({
		languages: Object.freeze(codes),
		columns: Object.freeze(columns),
		selectSql: translationSelectColumns(codes).join(',\n\t\t\t'),
		joinSql: translationJoinSql(codes)
	});
}

function searchFields() {
	return translationLanguageCodes().flatMap(code => TRANSLATION_FIELDS.map(field => {
		const boost = Number(field.boost) > 1 ? `^${field.boost}` : '';
		return `${columnName(field.column, code)}${boost}`;
	}));
}

function highlightFields() {
	return searchFields().map(field => field.replace(/\^.*$/, ''));
}

module.exports = {
	expectedTranslationColumnNames,
	highlightFields,
	loadIndexFields,
	searchFields,
	translationJoinSql,
	translationLanguageCodes,
	translationSelectColumns
};
