/* jslint node:true, esversion:9 */
'use strict';

const debug = require('./Debug')('hadithdb:HadithTranslationIndexView');
const MySQL = require('mysql');
const PaymentConfig = require('./PaymentConfig');
const UserPoints = require('./UserPoints');
const Utils = require('./Utils');

const TRANSLATION_FIELDS = Object.freeze(['title', 'chain', 'body', 'footnote']);
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

function buildViewSql() {
	const selectColumns = [
		'h.id AS id',
		'h.id AS hId',
		't.tId AS tId',
		"'hadith' AS doctype",
		't.path AS path',
		"CONCAT(t.book_alias, ':', h.num) AS ref",
		't.book_id AS book_id',
		't.book_ordinal AS book_ordinal',
		't.book_alias AS book_alias',
		't.book_shortName_en AS book_shortName_en',
		't.book_shortName AS book_shortName',
		't.book_name_en AS book_name_en',
		't.book_name AS book_name',
		't.book_author AS book_author',
		't.book_virtual AS book_virtual',
		't.level AS level',
		't.h1_id AS h1_id',
		't.h1 AS h1',
		't.h1_title_en AS h1_title_en',
		't.h1_title AS h1_title',
		't.h1_intro_en AS h1_intro_en',
		't.h1_intro AS h1_intro',
		't.h1_start AS h1_start',
		't.h1_count AS h1_count',
		't.h2_id AS h2_id',
		't.h2 AS h2',
		't.h2_title_en AS h2_title_en',
		't.h2_title AS h2_title',
		't.h2_intro_en AS h2_intro_en',
		't.h2_intro AS h2_intro',
		't.h2_start AS h2_start',
		't.h2_count AS h2_count',
		't.h3_id AS h3_id',
		't.h3 AS h3',
		't.h3_title_en AS h3_title_en',
		't.h3_title AS h3_title',
		't.h3_intro_en AS h3_intro_en',
		't.h3_intro AS h3_intro',
		't.h3_start AS h3_start',
		't.h3_count AS h3_count',
		'h.ordinal AS ordinal',
		'h.numInChapter AS numInChapter',
		'g.id AS grade_id',
		'g.grade_en AS grade_grade_en',
		'g.grade AS grade_grade',
		'p.id AS grader_id',
		'p.shortName_en AS grader_shortName_en',
		'p.shortName AS grader_shortName',
		'p.name_en AS grader_name_en',
		'p.name AS grader_name',
		'hg.grade_ids AS grade_grade_ids',
		'hg.grades AS grade_grades',
		'h.verified AS verified',
		'h.remark AS remark',
		'h.numActual AS numActual',
		'h.num AS num',
		'h.num0 AS num0',
		'h.title_en AS title_en',
		'h.title AS title',
		'h.part_en AS part_en',
		'h.part AS part',
		'h.chain_en AS chain_en',
		'h.body_en AS body_en',
		'h.footnote_en AS footnote_en',
		'h.chain AS chain',
		'h.body AS body',
		'h.body_ar_alt AS body_ar_alt',
		'h.body_indopak AS body_indopak',
		'h.body_warsh AS body_warsh',
		'h.sajda AS sajda',
		'h.footnote AS footnote',
		'h.text_en AS text',
		'h.text AS text_en',
		'h.tags AS tags',
		'h.books AS books',
		'h.lastmod AS lastmod',
		'h.lastfixed AS lastfixed',
		'h.highlight AS highlight',
		'h.commented AS commented',
		'h.available_translation_languages AS available_translation_languages'
	];
	return `CREATE OR REPLACE VIEW v_hadiths AS
SELECT
	${selectColumns.join(',\n\t')}
FROM hadiths h
JOIN grades g ON h.gradeId=g.id
JOIN graders p ON h.graderId=p.id
JOIN v_toc t ON h.tocId=t.tId AND t.book_virtual=0
JOIN v_hadiths_grades hg ON h.id=hg.id`;
}

async function currentViewColumns() {
	const rows = await global.query('SHOW COLUMNS FROM v_hadiths');
	return new Set((rows || []).map(row => row.Field));
}

function expectedTranslationColumnNames(codes) {
	const columns = [];
	translationLanguageCodes(codes).forEach(code => {
		TRANSLATION_FIELDS.forEach(field => columns.push(columnName(field, code)));
	});
	return columns;
}

function generatedTranslationColumnNames(columns) {
	const names = [];
	(Array.isArray(columns) ? columns : Array.from(columns || [])).forEach(column => {
		const match = Utils.trimToEmpty(column).match(/^(title|chain|body|footnote)_([a-z][a-z0-9]{1,15})$/);
		if (match && !BASE_LANGUAGE_CODES.has(match[2]))
			names.push(column);
	});
	return names;
}

async function ensureView(options) {
	options = options || {};
	await ensureAvailabilityColumn();
	const columns = options.force ? new Set() : await currentViewColumns();
	const stale = generatedTranslationColumnNames(columns);
	const missingBaseColumns = ['available_translation_languages', 'body_indopak', 'body_warsh'].filter(column => !columns.has(column));
	if (!options.force && stale.length < 1 && missingBaseColumns.length < 1)
		return { updated: false, columns: [] };
	const sqlText = buildViewSql();
	debug(`updating v_hadiths base view; removing generated translation columns=${stale.join(',')} missing=${missingBaseColumns.join(',')}`);
	await global.query(sqlText);
	return { updated: true, columns: [] };
}

async function ensureBaseView(options) {
	return ensureView(options);
}

async function loadIndexFields(options) {
	options = options || {};
	await UserPoints.ensureTables();
	const languages = options.languages || await PaymentConfig.loadLanguages(options.forceLanguages ? { force: true } : undefined);
	const codes = translationLanguageCodes(languages);
	return Object.freeze({
		languages: Object.freeze(codes),
		columns: Object.freeze(expectedTranslationColumnNames(codes))
	});
}

async function ensureAvailabilityColumn() {
	await UserPoints.ensureTables();
	const rows = await global.query(`
		SELECT COLUMN_NAME
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA=DATABASE()
			AND TABLE_NAME='hadiths'
			AND COLUMN_NAME='available_translation_languages'
		LIMIT 1
	`);
	if (rows && rows.length)
		return;
	await global.query(`
		ALTER TABLE hadiths
		ADD COLUMN available_translation_languages json NULL AFTER commented
	`);
}

async function refreshAvailability(hadithIds) {
	await ensureAvailabilityColumn();
	const ids = normalizedHadithIds(hadithIds);
	if (ids.length > 0)
		await global.query(`UPDATE hadiths SET available_translation_languages=NULL WHERE id IN (${ids.map(sql).join(',')})`);
	else
		await global.query(`UPDATE hadiths SET available_translation_languages=NULL WHERE available_translation_languages IS NOT NULL`);
	const idPredicate = ids.length > 0
		? `AND item_id IN (${ids.map(sql).join(',')})`
		: '';
	await global.query(`
		UPDATE hadiths h
		JOIN (
			SELECT
				CAST(item_id AS UNSIGNED) AS hadith_id,
				JSON_ARRAYAGG(target_language) AS languages
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
				WHERE item_type='hadith'
					AND mode='translate'
					AND target_language NOT IN ('ar', 'en')
					AND item_id REGEXP '^[0-9]+$'
					${idPredicate}
			) ranked_translations
			WHERE row_num=1
				AND JSON_LENGTH(content_json) > 0
			GROUP BY item_id
		) available ON available.hadith_id=h.id
		SET h.available_translation_languages=available.languages
	`);
}

async function dropAvailabilityTable() {
	await global.query('DROP TABLE IF EXISTS hadith_content_translation_availability');
}

async function hadithIdsWithAvailability() {
	await ensureAvailabilityColumn();
	const rows = await global.query(`
		SELECT id
		FROM hadiths
		WHERE available_translation_languages IS NOT NULL
			AND JSON_LENGTH(available_translation_languages) > 0
		ORDER BY id
	`);
	return rows.map(row => row.id);
}

async function loadAvailableTranslationLanguageRows(ids) {
	ids = normalizedHadithIds(ids);
	if (ids.length < 1)
		return [];
	return global.query(`
		SELECT item_id, target_language
		FROM (
			SELECT
				item_id,
				target_language,
				ROW_NUMBER() OVER (
					PARTITION BY item_id, target_language
					ORDER BY updatedAt DESC, id DESC
				) AS row_num
			FROM user_content_translations
			WHERE item_type='hadith'
				AND mode='translate'
				AND target_language NOT IN ('ar', 'en')
				AND item_id REGEXP '^[0-9]+$'
				AND item_id IN (${ids.map(sql).join(',')})
		) ranked_translations
		WHERE row_num=1
		ORDER BY item_id, target_language
	`);
}

function normalizedHadithIds(hadithIds) {
	if (hadithIds === undefined || hadithIds === null)
		return [];
	const values = Array.isArray(hadithIds) ? hadithIds : [hadithIds];
	const seen = new Set();
	return values.map(value => parseInt(value, 10)).filter(value => {
		if (!Number.isInteger(value) || value <= 0 || seen.has(value))
			return false;
		seen.add(value);
		return true;
	}).map(value => `${value}`);
}

async function attachTranslations(rows, options) {
	rows = Array.isArray(rows) ? rows : [];
	if (rows.length < 1)
		return rows;
	options = options || {};
	const indexFields = options.indexFields || await loadIndexFields(options);
	const codes = translationLanguageCodes(indexFields.languages || []);
	if (codes.length < 1)
		return rows;
	const byId = new Map();
	rows.forEach(row => {
		const id = hadithRowId(row, options);
		if (id)
			byId.set(id, row);
	});
	const ids = Array.from(byId.keys());
	if (ids.length < 1)
		return rows;
	for (const batch of chunks(ids, options.batchSize || 1000))
		applyTranslationRows(byId, await loadTranslationRows(batch, codes));
	return rows;
}

function hadithRowId(row, options) {
	const configuredField = Utils.trimToEmpty(options && options.rowIdField);
	const id = parseInt(row && (configuredField ? row[configuredField] : (row.hId || row.id)), 10);
	return Number.isInteger(id) && id > 0 ? `${id}` : '';
}

function chunks(values, size) {
	const chunks = [];
	size = Math.max(1, parseInt(size, 10) || 1000);
	for (let index = 0; index < values.length; index += size)
		chunks.push(values.slice(index, index + size));
	return chunks;
}

async function loadTranslationRows(ids, codes) {
	if (!ids.length || !codes.length)
		return [];
	return global.query(`
		SELECT item_id, target_language, content_json
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
			WHERE item_type='hadith'
				AND mode='translate'
				AND target_language IN (${codes.map(sql).join(',')})
				AND item_id IN (${ids.map(sql).join(',')})
				AND item_id REGEXP '^[0-9]+$'
		) ranked_translations
		WHERE row_num=1`);
}

function applyTranslationRows(byId, translationRows) {
	(translationRows || []).forEach(row => {
		const target = byId.get(`${parseInt(row.item_id, 10)}`);
		const code = normalizeLanguageCode(row.target_language);
		if (!target || !code)
			return;
		const content = parseContentJson(row.content_json);
		TRANSLATION_FIELDS.forEach(field => {
			const value = Utils.trimToEmpty(content && content[field]);
			if (value)
				target[columnName(field, code)] = value;
		});
	});
}

function parseContentJson(value) {
	if (!value)
		return {};
	if (typeof value === 'object' && !Buffer.isBuffer(value))
		return value;
	try {
		return JSON.parse(value.toString());
	} catch (_err) {
		return {};
	}
}

function searchFields() {
	return translationLanguageCodes().flatMap(code => [
		`body_${code}^4`,
		`title_${code}^3`,
		`footnote_${code}^2`,
		`chain_${code}`
	]);
}

module.exports = {
	attachTranslations,
	buildViewSql,
	dropAvailabilityTable,
	ensureAvailabilityColumn,
	ensureBaseView,
	ensureView,
	expectedTranslationColumnNames,
	hadithIdsWithAvailability,
	loadAvailableTranslationLanguageRows,
	loadIndexFields,
	refreshAvailability,
	searchFields,
	translationLanguageCodes
};
