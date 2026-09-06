// @ts-check
'use strict';

const MySQL = require('mysql');
const Arabic = require('./Arabic');
const HadithChainCategories = require('./HadithChainCategories');

const TYPES = Object.freeze(['narrator', 'sharh_title', 'attribution', 'chain_classification', 'grader', 'grade']);
let schemaPromise = null;

function pairType(value) {
	const type = String(value || '').trim();
	if (!TYPES.includes(type)) throw new Error(`Invalid hadith bilingual pair type '${type}'`);
	return type;
}

function normalize(value) {
	return Arabic.removeLatinDiacritics(Arabic.normalize(String(value || '').normalize('NFKC'), false) || '')
		.toLowerCase().replace(/[ʿʾʻʼ]/gu, '')
		.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

async function ensureSchema() {
	if (schemaPromise) return schemaPromise;
	schemaPromise = global.query(`CREATE TABLE IF NOT EXISTS hdith_bilingual_pairs (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
		pair_type VARCHAR(32) NOT NULL,
		pair_key VARCHAR(255) NOT NULL,
		value_ar VARCHAR(255) NOT NULL,
		value_en VARCHAR(255) NULL,
		hidden TINYINT(1) NOT NULL DEFAULT 0,
		updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		UNIQUE KEY hdith_bilingual_pair_key (pair_type, pair_key)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).catch(err => {
		schemaPromise = null;
		throw err;
	});
	return schemaPromise;
}

async function discoveredPairs(type) {
	if (type === 'narrator') {
		return global.query(`SELECT narrator AS value_ar, narrator_en AS value_en, COUNT(*) AS usage_count FROM (
			SELECT NULLIF(m.narrator, '') AS narrator, NULLIF(m.narrator_en, '') AS narrator_en
			FROM hdith_hadith_metadata m WHERE NULLIF(m.narrator, '') IS NOT NULL
			UNION ALL
			SELECT COALESCE(NULLIF(n.name_tashkil, ''), n.name) AS narrator, NULLIF(n.name_ala_lc, '') AS narrator_en
			FROM hdith_hadith_narrators hn JOIN hdith_narrators n ON n.id=hn.narrator_id WHERE hn.ordinal=1
		) narrator_pairs GROUP BY narrator, narrator_en LIMIT 10000`);
	}
	if (type === 'sharh_title') return global.query(`SELECT value_ar, value_en, COUNT(*) AS usage_count FROM (
		SELECT COALESCE(NULLIF(hs.title, ''), ss.title) AS value_ar,
			COALESCE(NULLIF(hs.title_en, ''), NULLIF(ss.title_en, '')) AS value_en
		FROM hdith_hadith_sharh hs JOIN hdith_sharh_sources ss ON ss.id=hs.source_id
		UNION ALL SELECT title, title_en FROM hdith_sharh_sources
	) sharh_pairs WHERE NULLIF(value_ar, '') IS NOT NULL GROUP BY value_ar, value_en LIMIT 10000`);
	if (type === 'attribution') return global.query(`SELECT a.attribution AS value_ar, a.attribution_en AS value_en,
		COUNT(h.id) AS usage_count FROM attributions a LEFT JOIN hadiths h ON h.attributionId=a.id
		GROUP BY a.id, a.attribution, a.attribution_en ORDER BY a.id`);
	if (type === 'chain_classification') {
		const rows = await global.query(`SELECT chain_type, COUNT(*) AS usage_count FROM hdith_hadith_metadata
			WHERE NULLIF(chain_type, '') IS NOT NULL GROUP BY chain_type LIMIT 10000`);
		const byKey = new Map(HadithChainCategories.CATEGORIES.map(category => [normalize(category.title), {
			value_ar: category.title, value_en: category.title_en, usage_count: 0
		}]));
		for (const row of rows) {
			for (const value of String(row.chain_type || '').split(/[,،·]/u).map(item => item.trim()).filter(Boolean)) {
				const key = normalize(value);
				const existing = byKey.get(key);
				if (existing) existing.usage_count += Number(row.usage_count) || 0;
				else byKey.set(key, { value_ar: value, value_en: '', usage_count: Number(row.usage_count) || 0 });
			}
		}
		return [...byKey.values()];
	}
	if (type === 'grader') return global.query(`SELECT value_ar, value_en, COUNT(*) AS usage_count FROM (
		SELECT NULLIF(shortName, '') AS value_ar, NULLIF(shortName_en, '') AS value_en FROM graders
		UNION ALL SELECT NULLIF(grader, ''), NULLIF(grader_en, '') FROM hdith_hadith_grades
	) grader_pairs WHERE value_ar IS NOT NULL GROUP BY value_ar, value_en LIMIT 10000`);
	return global.query(`SELECT NULLIF(grade, '') AS value_ar, NULLIF(grade_en, '') AS value_en,
		COUNT(*) AS usage_count FROM grades WHERE NULLIF(grade, '') IS NOT NULL
		GROUP BY grade, grade_en LIMIT 10000`);
}

async function list(typeValue, queryValue, limitValue) {
	const type = pairType(typeValue);
	const query = normalize(queryValue);
	const requestedLimit = Number.parseInt(limitValue, 10);
	const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 500) : null;
	await ensureSchema();
	const [discovered, managed] = await Promise.all([
		discoveredPairs(type),
		global.query(`SELECT id, pair_key, value_ar, value_en, hidden FROM hdith_bilingual_pairs WHERE pair_type=${MySQL.escape(type)} ORDER BY value_ar`)
	]);
	const byKey = new Map();
	for (const row of discovered) {
		const valueAr = String(row.value_ar || '').trim();
		if (!valueAr) continue;
		const key = normalize(valueAr);
		const existing = byKey.get(key);
		if (!existing || (!existing.value_en && row.value_en) || Number(row.usage_count) > existing.usage_count)
			byKey.set(key, { id: null, key, value_ar: valueAr, value_en: String(row.value_en || '').trim(), usage_count: Number(row.usage_count) || 0, managed: false });
	}
	for (const row of managed) {
		const key = String(row.pair_key || normalize(row.value_ar));
		if (Number(row.hidden)) byKey.delete(key);
		else byKey.set(key, { id: Number(row.id), key, value_ar: String(row.value_ar || '').trim(), value_en: String(row.value_en || '').trim(), usage_count: byKey.get(key)?.usage_count || 0, managed: true });
	}
	const pairs = [...byKey.values()]
		.filter(pair => !query || normalize(pair.value_ar).includes(query) || normalize(pair.value_en).includes(query))
		.sort((a, b) => b.usage_count - a.usage_count || a.value_ar.localeCompare(b.value_ar, 'ar'));
	return limit ? pairs.slice(0, limit) : pairs;
}

async function save(typeValue, valueArValue, valueEnValue, originalArValue) {
	const type = pairType(typeValue);
	const valueAr = String(valueArValue || '').trim();
	const valueEn = String(valueEnValue || '').trim();
	if (!valueAr || !valueEn) throw new Error('Both Arabic and English values are required');
	await ensureSchema();
	const key = normalize(valueAr);
	const originalKey = normalize(originalArValue || valueAr);
	if (originalKey && originalKey !== key)
		await hide(type, originalArValue);
	await global.query(`INSERT INTO hdith_bilingual_pairs (pair_type, pair_key, value_ar, value_en, hidden)
		VALUES (${MySQL.escape(type)}, ${MySQL.escape(key)}, ${MySQL.escape(valueAr)}, ${MySQL.escape(valueEn)}, 0)
		ON DUPLICATE KEY UPDATE value_ar=VALUES(value_ar), value_en=VALUES(value_en), hidden=0`);
	return { type, key, value_ar: valueAr, value_en: valueEn };
}

async function hide(typeValue, valueArValue) {
	const type = pairType(typeValue);
	const valueAr = String(valueArValue || '').trim();
	if (!valueAr) throw new Error('Arabic value is required');
	await ensureSchema();
	const key = normalize(valueAr);
	await global.query(`INSERT INTO hdith_bilingual_pairs (pair_type, pair_key, value_ar, value_en, hidden)
		VALUES (${MySQL.escape(type)}, ${MySQL.escape(key)}, ${MySQL.escape(valueAr)}, NULL, 1)
		ON DUPLICATE KEY UPDATE value_ar=VALUES(value_ar), value_en=NULL, hidden=1`);
	return { type, key };
}

function resetSchemaForTests() {
	schemaPromise = null;
}

module.exports = { ensureSchema, hide, list, normalize, pairType, resetSchemaForTests, save, TYPES };
