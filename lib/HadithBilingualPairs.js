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

async function ensureSchema(query = global.query) {
	if (schemaPromise) return schemaPromise;
	schemaPromise = query(`CREATE TABLE IF NOT EXISTS hdith_bilingual_pairs (
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
		UNION ALL SELECT COALESCE(NULLIF(ts.title, ''), ss.title),
			COALESCE(NULLIF(ts.title_en, ''), NULLIF(ss.title_en, ''))
		FROM hdith_toc_sharh ts JOIN hdith_sharh_sources ss ON ss.id=ts.source_id
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
	const displayKeys = new Set();
	const pairs = [...byKey.values()]
		.filter(pair => !query || normalize(pair.value_ar).includes(query) || normalize(pair.value_en).includes(query))
		.sort((a, b) => Number(b.managed) - Number(a.managed) || b.usage_count - a.usage_count || a.value_ar.localeCompare(b.value_ar, 'ar'))
		.filter(pair => { const displayKey = normalize(pair.value_ar); return !displayKeys.has(displayKey) && displayKeys.add(displayKey); });
	return limit ? pairs.slice(0, limit) : pairs;
}

async function managed(typeValues, query = global.query) {
	const types = [...new Set((Array.isArray(typeValues) ? typeValues : [typeValues]).map(pairType))];
	await ensureSchema(query);
	return query(`SELECT pair_type,pair_key,value_ar,value_en FROM hdith_bilingual_pairs
		WHERE hidden=0 AND pair_type IN (${types.map(MySQL.escape).join(',')})`);
}

function resolve(managedRows, typeValue, valueAr, valueEn) {
	const type = pairType(typeValue);
	const valueKey = normalize(valueAr);
	const pair = (managedRows || []).find(row => row.pair_type === type
		&& (String(row.pair_key) === valueKey || normalize(row.value_ar) === valueKey));
	return pair ? { value_ar: String(pair.value_ar || '').trim(), value_en: String(pair.value_en || '').trim() }
		: { value_ar: String(valueAr || '').trim(), value_en: String(valueEn || '').trim() };
}

async function propagate(type, originalAr, valueAr, valueEn) {
	const oldValue = MySQL.escape(originalAr);
	const newArabic = MySQL.escape(valueAr);
	const newEnglish = MySQL.escape(valueEn);
	let contexts = [];
	if (type === 'sharh_title') {
		contexts = await global.query(`SELECT DISTINCT hadith_id, alias FROM (
			SELECT h.id AS hadith_id,b.alias FROM hdith_hadith_sharh hs
			JOIN hdith_sharh_sources ss ON ss.id=hs.source_id
			JOIN hadiths h ON h.id=hs.hadith_id JOIN books b ON b.id=h.bookId
			WHERE COALESCE(NULLIF(hs.title, ''), ss.title)=${oldValue}
			UNION SELECT NULL,b.alias FROM hdith_toc_sharh ts
			JOIN hdith_sharh_sources ss ON ss.id=ts.source_id
			JOIN toc t ON t.id=ts.toc_id JOIN books b ON b.id=t.bookId
			WHERE COALESCE(NULLIF(ts.title, ''), ss.title)=${oldValue}
		) affected`);
		await global.query(`UPDATE hdith_hadith_sharh hs JOIN hdith_sharh_sources ss ON ss.id=hs.source_id
			SET hs.title=${newArabic},hs.title_en=${newEnglish}
			WHERE COALESCE(NULLIF(hs.title, ''),ss.title)=${oldValue}`);
		await global.query(`UPDATE hdith_toc_sharh ts JOIN hdith_sharh_sources ss ON ss.id=ts.source_id
			SET ts.title=${newArabic},ts.title_en=${newEnglish}
			WHERE COALESCE(NULLIF(ts.title, ''),ss.title)=${oldValue}`);
		await global.query(`UPDATE hdith_sharh_sources SET title=${newArabic},title_en=${newEnglish} WHERE title=${oldValue}`);
	} else if (type === 'narrator') {
		contexts = await global.query(`SELECT DISTINCT hadith_id,alias FROM (
			SELECT h.id AS hadith_id,b.alias FROM hdith_hadith_metadata m
			JOIN hadiths h ON h.id=m.hadith_id JOIN books b ON b.id=h.bookId WHERE m.narrator=${oldValue}
			UNION SELECT h.id,b.alias FROM hdith_narrators n JOIN hdith_hadith_narrators hn ON hn.narrator_id=n.id
			JOIN hadiths h ON h.id=hn.hadith_id JOIN books b ON b.id=h.bookId
			WHERE COALESCE(NULLIF(n.name_tashkil, ''),n.name)=${oldValue}
		) affected`);
		await global.query(`UPDATE hdith_hadith_metadata SET narrator=${newArabic},narrator_en=${newEnglish} WHERE narrator=${oldValue}`);
		await global.query(`UPDATE hdith_narrators SET name=IF(name=${oldValue},${newArabic},name),
			name_tashkil=${newArabic},name_ala_lc=${newEnglish} WHERE COALESCE(NULLIF(name_tashkil, ''),name)=${oldValue}`);
	} else if (type === 'attribution') {
		contexts = await global.query(`SELECT DISTINCT h.id AS hadith_id,b.alias FROM hadiths h JOIN books b ON b.id=h.bookId
			LEFT JOIN attributions a ON a.id=h.attributionId LEFT JOIN hdith_hadith_metadata m ON m.hadith_id=h.id
			WHERE a.attribution=${oldValue} OR m.attribution=${oldValue}`);
		await global.query(`UPDATE hdith_hadith_metadata SET attribution=${newArabic} WHERE attribution=${oldValue}`);
		await global.query(`UPDATE attributions SET attribution=${newArabic},attribution_en=${newEnglish} WHERE attribution=${oldValue}`);
	} else if (type === 'chain_classification') {
		contexts = await global.query(`SELECT DISTINCT h.id AS hadith_id,b.alias FROM hdith_hadith_metadata m
			JOIN hadiths h ON h.id=m.hadith_id JOIN books b ON b.id=h.bookId
			WHERE FIND_IN_SET(${oldValue},REPLACE(REPLACE(m.chain_type,' · ',','),'·',','))>0`);
	} else if (type === 'grader') {
		contexts = await global.query(`SELECT DISTINCT h.id AS hadith_id,b.alias FROM hadiths h JOIN books b ON b.id=h.bookId
			LEFT JOIN graders g ON g.id=h.graderId LEFT JOIN hdith_hadith_grades hg ON hg.hadith_id=h.id
			WHERE g.shortName=${oldValue} OR hg.grader=${oldValue}`);
		await global.query(`UPDATE hdith_hadith_grades SET grader=${newArabic},grader_en=${newEnglish} WHERE grader=${oldValue}`);
		await global.query(`UPDATE graders SET shortName=${newArabic},shortName_en=${newEnglish} WHERE shortName=${oldValue}`);
	} else if (type === 'grade') {
		contexts = await global.query(`SELECT DISTINCT h.id AS hadith_id,b.alias FROM hadiths h JOIN books b ON b.id=h.bookId
			LEFT JOIN grades g ON g.id=h.gradeId LEFT JOIN hdith_hadith_grades hg ON hg.hadith_id=h.id
			WHERE g.grade=${oldValue} OR hg.grade=${oldValue}`);
		await global.query(`UPDATE hdith_hadith_grades SET grade=${newArabic},grade_en=${newEnglish} WHERE grade=${oldValue}`);
		await global.query(`UPDATE grades SET grade=${newArabic},grade_en=${newEnglish} WHERE grade=${oldValue}`);
	}
	return {
		hadithIds: [...new Set(contexts.map(row => Number(row.hadith_id)).filter(id => Number.isSafeInteger(id) && id > 0))],
		bookAliases: [...new Set(contexts.map(row => String(row.alias || '')).filter(Boolean))]
	};
}

async function save(typeValue, valueArValue, valueEnValue, originalArValue, originalKeyValue) {
	const type = pairType(typeValue);
	const valueAr = String(valueArValue || '').trim();
	const valueEn = String(valueEnValue || '').trim();
	if (!valueAr || !valueEn) throw new Error('Both Arabic and English values are required');
	await ensureSchema();
	const valueKey = normalize(valueAr);
	const originalKey = normalize(originalArValue || valueAr);
	const key = normalize(originalKeyValue) || originalKey || valueKey;
	await global.query(`INSERT INTO hdith_bilingual_pairs (pair_type, pair_key, value_ar, value_en, hidden)
		VALUES (${MySQL.escape(type)}, ${MySQL.escape(key)}, ${MySQL.escape(valueAr)}, ${MySQL.escape(valueEn)}, 0)
		ON DUPLICATE KEY UPDATE value_ar=VALUES(value_ar), value_en=VALUES(value_en), hidden=0`);
	const propagated = await propagate(type, String(originalArValue || valueAr).trim(), valueAr, valueEn);
	return { type, key, value_ar: valueAr, value_en: valueEn,
		affected_book_aliases: propagated.bookAliases, affected_hadith_ids: propagated.hadithIds };
}

async function hide(typeValue, valueArValue, pairKeyValue) {
	const type = pairType(typeValue);
	const valueAr = String(valueArValue || '').trim();
	if (!valueAr) throw new Error('Arabic value is required');
	await ensureSchema();
	const key = normalize(pairKeyValue) || normalize(valueAr);
	await global.query(`INSERT INTO hdith_bilingual_pairs (pair_type, pair_key, value_ar, value_en, hidden)
		VALUES (${MySQL.escape(type)}, ${MySQL.escape(key)}, ${MySQL.escape(valueAr)}, NULL, 1)
		ON DUPLICATE KEY UPDATE value_ar=VALUES(value_ar), value_en=NULL, hidden=1`);
	return { type, key };
}

function resetSchemaForTests() {
	schemaPromise = null;
}

module.exports = { ensureSchema, hide, list, managed, normalize, pairType, resetSchemaForTests, resolve, save, TYPES };
