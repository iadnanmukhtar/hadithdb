// @ts-check
'use strict';

const cheerio = require('cheerio');
const HadithChainCategories = require('./HadithChainCategories');
const HadithAttributions = require('./HadithAttributions');

const CUSTOM_SHARH_SOURCE_BOOK_ID = -1;

const VOCALIZED_NARRATOR_NAME_OVERRIDES = new Map([
	['p-5495', 'الْبُخَارِيُّ'],
	['p-6116', 'مُسْلِمٌ'],
	['p-2577', 'أَبُو دَاوُدَ السِّجِسْتَانِيُّ'],
	['p-10859', 'التِّرْمِذِيُّ'],
	['p-9712', 'النَّسَائِيُّ'],
	['p-10935', 'ابْنُ مَاجَهْ']
]);
const SOURCE_GRADE_TRANSLATIONS = new Map([
	['أصح شيء في هذا الباب وأحسن', 'The soundest and best report in this chapter']
]);
const SOURCE_GRADER_TRANSLATIONS = new Map([
	['البخاري', 'al-Bukhārī'],
	['مسلم', 'Muslim'],
	['أبو داود', 'Abū Dāwūd'],
	['الترمذي', 'al-Tirmidhī'],
	['النسائي', 'al-Nasāʾī'],
	['ابن ماجه', 'Ibn Mājah']
]);
const HDITH_GRADE_COLORS = Object.freeze({
	0: 'oklch(58% .02 250)', 1: 'oklch(58% .135 155)', 2: 'oklch(68% .105 155)',
	3: 'oklch(57% .165 22)', 4: 'oklch(68% .115 22)'
});
const HDITH_GRADE_COLOR_OPTIONS = Object.freeze([
	{ id: 0, label: 'Neutral', color: HDITH_GRADE_COLORS[0] },
	{ id: 1, label: 'Authentic green', color: HDITH_GRADE_COLORS[1] },
	{ id: 2, label: 'Acceptable green', color: HDITH_GRADE_COLORS[2] },
	{ id: 3, label: 'Weak red', color: HDITH_GRADE_COLORS[3] },
	{ id: 4, label: 'Severe red', color: HDITH_GRADE_COLORS[4] }
]);
let editableColumnsPromise = null;

async function ensureEditableColumns() {
	if (editableColumnsPromise) return editableColumnsPromise;
	editableColumnsPromise = (async () => {
		const definitions = [
			['hdith_hadith_sharh', 'text_en', 'LONGTEXT NULL AFTER text'],
			['hdith_hadith_sharh', 'title', 'VARCHAR(255) NULL AFTER page_num'],
			['hdith_hadith_sharh', 'title_en', 'VARCHAR(255) NULL AFTER title'],
			['hdith_sharh_sources', 'title_en', 'VARCHAR(255) NULL AFTER title'],
			['hdith_hadith_grades', 'grader_en', 'VARCHAR(255) NULL AFTER grader'],
			['hdith_hadith_grades', 'grade_en', 'TEXT NULL AFTER grade']
		];
		for (const [table, column, definition] of definitions) {
			const rows = await global.query(`SELECT 1 FROM information_schema.columns
				WHERE table_schema=DATABASE() AND table_name='${table}' AND column_name='${column}' LIMIT 1`);
			if (!rows.length) {
				try { await global.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); }
				catch (err) { if (!err || err.code !== 'ER_DUP_FIELDNAME') throw err; }
			}
		}
	})().catch(err => {
		editableColumnsPromise = null;
		throw err;
	});
	return editableColumnsPromise;
}

function parseJson(value, fallback) {
	if (value === null || value === undefined || value === '') return fallback;
	if (typeof value === 'object') return value;
	try { return JSON.parse(value); } catch (err) { return fallback; }
}

function gradeColorForCategory(value) {
	const category = Number(value);
	return Object.prototype.hasOwnProperty.call(HDITH_GRADE_COLORS, category) ? HDITH_GRADE_COLORS[category] : null;
}

function legacyGradeCategoryForId(value) {
	if (value === null || value === undefined || value === '') return 0;
	const id = Number(value);
	if (!Number.isInteger(id) || id < 0 || id > 1999) return 0;
	if (id <= 199) return 1;
	if (id <= 499) return 2;
	if (id <= 599) return 3;
	return 4;
}

function legacyGradeColorForId(value) {
	const category = legacyGradeCategoryForId(value);
	return gradeColorForCategory(category);
}

function normalizedGradePart(value) {
	return String(value || '').normalize('NFKC').replace(/[ـً-ٰٟۖ-ۭ]/gu, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function uniqueGradeGraderPairs(grades) {
	const seen = new Set();
	return (Array.isArray(grades) ? grades : []).filter(row => {
		const grade = normalizedGradePart(row?.grade || row?.grade_en);
		const grader = normalizedGradePart(row?.grader || row?.grader_en);
		if (!grade || !grader) return true;
		const key = `${grader}\u0000${grade}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function preferredColoredGradeOpinion(grades) {
	return (Array.isArray(grades) ? grades : []).map((grade, index) => ({ grade, index }))
		.filter(entry => Number(entry.grade?.grade_category_id) >= 1 && Number(entry.grade?.grade_category_id) <= 4
			&& normalizedGradePart(entry.grade?.grade))
		.sort((left, right) => Number(right.grade.grade_category_id) - Number(left.grade.grade_category_id)
			|| normalizedGradePart(left.grade.grade).length - normalizedGradePart(right.grade.grade).length
			|| left.index - right.index)[0]?.grade || null;
}

function withPreferredColoredGradeFirst(grades) {
	const rows = Array.isArray(grades) ? [...grades] : [];
	const preferred = preferredColoredGradeOpinion(rows);
	if (!preferred) return rows;
	const index = rows.indexOf(preferred);
	if (index > 0) rows.unshift(rows.splice(index, 1)[0]);
	return rows;
}

function translatedSourceGrade(value) {
	return SOURCE_GRADE_TRANSLATIONS.get(String(value || '').trim()) || null;
}

function translatedSourceGrader(value) {
	return SOURCE_GRADER_TRANSLATIONS.get(String(value || '').trim()) || null;
}

function sourceNarratorNames(sourceIsnadHtml) {
	const names = new Map();
	if (!sourceIsnadHtml) return names;
	const $ = cheerio.load(`<div id="hdith-source-isnad">${sourceIsnadHtml}</div>`, null, false);
	$('#hdith-source-isnad a[href]').each(function () {
		const sourceUrl = String($(this).attr('href') || '').trim();
		const name = $(this).text().replace(/\s+/g, ' ').trim().replace(/\s*[:،]\s*$/u, '');
		if (/^https:\/\/hdith\.com\/encyclopedia\/rawi\/p-[0-9]+$/u.test(sourceUrl) && name)
			names.set(sourceUrl, name);
	});
	return names;
}

function vocalizedNarratorName(narrator, sourceNames) {
	return sourceNames.get(narrator.source_url)
		|| VOCALIZED_NARRATOR_NAME_OVERRIDES.get(narrator.source_slug)
		|| narrator.name;
}

function narratorDisplayFullname(narrator) {
	const fullname = String(narrator?.fullname || '').split(/\s*[،:]\s*/u)[0].replace(/\s+/g, ' ').trim();
	if (!fullname) return null;
	const name = String(narrator?.name || '').replace(/\s+/g, ' ').trim();
	return normalizedGradePart(fullname) === normalizedGradePart(name) ? null : fullname;
}

function withPrimaryGrade(grades, item) {
	let rows = uniqueGradeGraderPairs(grades);
	const grade = item && ((item.ar && item.ar.grade_grade) || item.grade_grade || (item.en && item.en.grade_grade));
	const grader = item && ((item.ar && item.ar.grader_shortName) || item.grader_shortName || (item.en && item.en.grader_shortName));
	const legacyGradeId = item?.grade?.id ?? item?.actual?.grade?.id ?? item?.gradeId ?? item?.actual?.gradeId;
	const legacyGradeColor = legacyGradeColorForId(legacyGradeId);
	if (item) item.legacyGradeColor = legacyGradeColor;
	if (Number(legacyGradeId) === -1) {
		rows = withPreferredColoredGradeFirst(rows);
		if (rows[0] && Number(rows[0].grade_category_id) >= 1 && Number(rows[0].grade_category_id) <= 4) {
			if (item) {
				item.legacyGradeOverride = rows[0];
				item.legacyGradeColor = rows[0].grade_color || gradeColorForCategory(rows[0].grade_category_id);
			}
			return rows;
		}
	}
	if (!grade || !grader) return rows;
	const duplicateIndex = rows.findIndex(row => normalizedGradePart(row.grade) === normalizedGradePart(grade)
		&& normalizedGradePart(row.grader) === normalizedGradePart(grader));
	if (duplicateIndex >= 0) {
		const duplicate = Object.assign({}, rows.splice(duplicateIndex, 1)[0], {
			grade_color: legacyGradeColor,
			legacy_grade_id: legacyGradeId,
			primary: true
		});
		rows.unshift(duplicate);
		return rows;
	}
	rows.unshift({
		grader,
		grader_name: (item.ar && item.ar.grader_name) || item.grader_name || (item.en && item.en.grader_name) || grader,
		grader_en: (item.en && item.en.grader_shortName) || item.grader_shortName_en || null,
		grader_name_en: (item.en && item.en.grader_name) || item.grader_name_en || (item.en && item.en.grader_shortName) || null,
		grade,
		grade_en: (item.en && item.en.grade_grade) || item.grade_grade_en || null,
		grade_color: legacyGradeColor,
		legacy_grade_id: legacyGradeId,
		primary: true
	});
	return rows;
}

function classificationFromRow(row) {
	if (!row) return { attribution: null, chainCategories: [] };
	const sourceAttributionId = HadithAttributions.idForArabic(row.source_attribution);
	const attribution = Number(row.attribution_id) >= 0 ? {
		id: Number(row.attribution_id),
		title_en: row.attribution_en,
		title: row.attribution
	} : sourceAttributionId >= 0 ? HadithAttributions.byId(sourceAttributionId) : null;
	return {
		attribution,
		chainCategories: HadithChainCategories.parse(row.chain_type)
	};
}

async function attachClassifications(items) {
	const list = Array.isArray(items) ? items : [];
	const ids = [...new Set(list.map(item => Number(item?.actual?.id || item?.id)).filter(id => Number.isSafeInteger(id) && id > 0))];
	if (!ids.length) return list;
	try {
		const rows = await global.query(`SELECT h.id AS hadith_id, m.attribution AS source_attribution, m.chain_type,
			a.id AS attribution_id, a.attribution_en, a.attribution
			FROM hadiths h LEFT JOIN hdith_hadith_metadata m ON m.hadith_id=h.id
			LEFT JOIN attributions a ON a.id=h.attributionId
			WHERE h.id IN (${ids.join(',')})`);
		const byHadithId = new Map(rows.map(row => [Number(row.hadith_id), classificationFromRow(row)]));
		list.forEach(item => {
			const classification = byHadithId.get(Number(item?.actual?.id || item?.id));
			if (classification) item.hdithClassification = classification;
			item.legacyGradeColor = legacyGradeColorForId(item?.grade?.id ?? item?.actual?.grade?.id ?? item?.gradeId ?? item?.actual?.gradeId);
		});
		return list;
	} catch (err) {
		if (err && (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR')) return list;
		throw err;
	}
}

function resolvedSimilarLinks(links) {
	return (Array.isArray(links) ? links : []).filter(row => row.link_type === 'similar' && row.internal_ref);
}

async function forHadith(hadithId) {
	const id = Number(hadithId);
	if (!Number.isSafeInteger(id) || id < 1) return null;
	try {
		await ensureEditableColumns();
		const [metadataRows, narratorRows, linkRows, sharhRows, gradeRows] = await Promise.all([
			global.query(`SELECT m.source_book_slug, m.source_entry_id, m.source_reference, m.attribution AS source_attribution, m.chain_type, m.source_isnad_html, m.gharib_json,
				a.id AS attribution_id, a.attribution_en, a.attribution
				FROM hdith_hadith_metadata m JOIN hadiths h ON h.id=m.hadith_id
				LEFT JOIN attributions a ON a.id=h.attributionId WHERE m.hadith_id=${id} LIMIT 1`),
			global.query(`SELECT hn.ordinal, hn.formula, hn.flags_json, n.source_slug, n.name, n.fullname, n.reliability, n.generation_name, n.death_text, n.source_url FROM hdith_hadith_narrators hn JOIN hdith_narrators n ON n.id=hn.narrator_id WHERE hn.hadith_id=${id} ORDER BY hn.ordinal`),
			global.query(`SELECT link_type, source_book_id, source_book_title, source_entry_id, source_num, label, source_body_start, internal_ref, source_url FROM hdith_hadith_links WHERE hadith_id=${id} ORDER BY link_type, source_book_id, source_num, source_entry_id`),
			global.query(`SELECT hs.id, hs.chapter, hs.page_num, hs.text, hs.text_en, hs.source_url,
				COALESCE(NULLIF(hs.title, ''), ss.title) AS title, COALESCE(NULLIF(hs.title_en, ''), ss.title_en) AS title_en,
				ss.author, ss.source_book_id, (ss.source_book_id=${CUSTOM_SHARH_SOURCE_BOOK_ID}) AS custom, (ss.source_book_id<0) AS local
				FROM hdith_hadith_sharh hs JOIN hdith_sharh_sources ss ON ss.id=hs.source_id WHERE hs.hadith_id=${id} ORDER BY hs.id`),
			global.query(`SELECT hg.id, hg.grader, hg.grade, hg.grade_category_id,
				COALESCE(hg.grade_color, CASE hg.grade_category_id
					WHEN 1 THEN '${HDITH_GRADE_COLORS[1]}' WHEN 2 THEN '${HDITH_GRADE_COLORS[2]}'
					WHEN 3 THEN '${HDITH_GRADE_COLORS[3]}' WHEN 4 THEN '${HDITH_GRADE_COLORS[4]}'
					ELSE '${HDITH_GRADE_COLORS[0]}' END) AS grade_color,
				hg.source_name, hg.book_page, hg.source_url,
				COALESCE(hg.grade_en, (SELECT g.grade_en FROM grades g WHERE g.grade=hg.grade LIMIT 1)) AS grade_en,
				COALESCE(hg.grader_en, (SELECT gr.shortName_en FROM graders gr WHERE gr.shortName=hg.grader LIMIT 1)) AS grader_en,
				(SELECT gr.name_en FROM graders gr WHERE gr.shortName=hg.grader LIMIT 1) AS grader_name_en
				FROM hdith_hadith_grades hg WHERE hg.hadith_id=${id} ORDER BY hg.ordinal`)
		]);
		const metadata = metadataRows[0] || {};
		const vocalizedNarratorNames = sourceNarratorNames(metadata.source_isnad_html);
		const classification = classificationFromRow(metadata);
		return {
			gradeColors: HDITH_GRADE_COLOR_OPTIONS,
			sourceBookSlug: metadata.source_book_slug,
			sourceEntryId: metadata.source_entry_id,
			sourceReference: metadata.source_reference,
			sourceUrl: metadata.source_book_slug && metadata.source_entry_id ? `https://hdith.com/encyclopedia/book/${metadata.source_book_slug}/h/${metadata.source_entry_id}` : null,
			attribution: classification.attribution,
			sourceAttribution: metadata.source_attribution,
			chainCategories: classification.chainCategories,
			sourceIsnadHtml: metadata.source_isnad_html || null,
			gharib: parseJson(metadata.gharib_json, []),
			narrators: narratorRows.map(row => Object.assign({}, row, {
				vocalized_name: vocalizedNarratorName(row, vocalizedNarratorNames),
				display_fullname: narratorDisplayFullname(row),
				flags: parseJson(row.flags_json, [])
			})),
			takhrij: linkRows.filter(row => row.link_type === 'takhrij'),
			shawahid: linkRows.filter(row => row.link_type === 'shahid'),
			similar: resolvedSimilarLinks(linkRows),
			sharh: sharhRows,
			grades: uniqueGradeGraderPairs(gradeRows.map(row => Object.assign({}, row, {
				grade_en: row.grade_en || translatedSourceGrade(row.grade),
				grader_en: row.grader_en || translatedSourceGrader(row.grader),
				grader_name_en: row.grader_name_en || translatedSourceGrader(row.grader)
			})))
		};
	} catch (err) {
		if (err && (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR')) return null;
		throw err;
	}
}

module.exports = { attachClassifications, classificationFromRow, CUSTOM_SHARH_SOURCE_BOOK_ID, ensureEditableColumns, forHadith, gradeColorForCategory, HDITH_GRADE_COLOR_OPTIONS, legacyGradeCategoryForId, legacyGradeColorForId, narratorDisplayFullname, preferredColoredGradeOpinion, resolvedSimilarLinks, sourceNarratorNames, translatedSourceGrade, translatedSourceGrader, uniqueGradeGraderPairs, vocalizedNarratorName, withPreferredColoredGradeFirst, withPrimaryGrade };
