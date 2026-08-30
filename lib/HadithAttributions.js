// @ts-check
'use strict';

const ATTRIBUTIONS = Object.freeze([
	Object.freeze({ id: -1, key: 'unknown', title_en: 'No attribution', title: 'لا نعرف نسبته' }),
	Object.freeze({ id: 100, key: 'qudsi', title_en: 'Divine', title: 'قدسي' }),
	Object.freeze({ id: 200, key: 'marfu', title_en: 'Prophetic', title: 'مرفوع' }),
	Object.freeze({ id: 300, key: 'mawquf', title_en: 'Companion', title: 'موقوف' }),
	Object.freeze({ id: 400, key: 'maqtu', title_en: 'Successor', title: 'مقطوع' })
]);

function normalize(value) {
	return String(value || '')
		.normalize('NFKC')
		.replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/gu, '')
		.replace(/[إأآٱ]/gu, 'ا')
		.replace(/\s+/g, ' ')
		.trim();
}

function idForArabic(value) {
	const normalized = normalize(value);
	if (/^(?:حديث )?قدسي(?: |$)/u.test(normalized)) return 100;
	if (/^مرفوع(?: |$)/u.test(normalized)) return 200;
	if (/^موقوف(?: |$)/u.test(normalized)) return 300;
	if (/^مقطوع(?: |$)/u.test(normalized)) return 400;
	return -1;
}

function byId(id) {
	return ATTRIBUTIONS.find(attribution => attribution.id === Number(id)) || ATTRIBUTIONS[0];
}

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS attributions (
	id INT NOT NULL, attribution_en VARCHAR(45) NOT NULL, attribution VARCHAR(45) NOT NULL,
	PRIMARY KEY (id), UNIQUE KEY undx_attribution (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

async function ensureSchema(runQuery, options = {}) {
	await runQuery(CREATE_TABLE_SQL);
	for (const attribution of ATTRIBUTIONS)
		await runQuery(`INSERT INTO attributions (id, attribution_en, attribution) VALUES (?, ?, ?)
			ON DUPLICATE KEY UPDATE attribution_en=VALUES(attribution_en), attribution=VALUES(attribution)`,
			[attribution.id, attribution.title_en, attribution.title]);
	const columns = await runQuery(`SELECT 1 FROM information_schema.columns
		WHERE table_schema=DATABASE() AND table_name='hadiths' AND column_name='attributionId' LIMIT 1`);
	const addedColumn = !columns.length;
	if (addedColumn)
		await runQuery('ALTER TABLE hadiths ADD COLUMN attributionId INT NOT NULL DEFAULT -1 AFTER graderId');
	const indexes = await runQuery(`SELECT 1 FROM information_schema.statistics
		WHERE table_schema=DATABASE() AND table_name='hadiths' AND index_name='ndx_attributionId' LIMIT 1`);
	if (!indexes.length)
		await runQuery('ALTER TABLE hadiths ADD KEY ndx_attributionId (attributionId)');
	const constraints = await runQuery(`SELECT 1 FROM information_schema.table_constraints
		WHERE constraint_schema=DATABASE() AND table_name='hadiths' AND constraint_name='fk_hadith_attribution' LIMIT 1`);
	if (!constraints.length)
		await runQuery('ALTER TABLE hadiths ADD CONSTRAINT fk_hadith_attribution FOREIGN KEY (attributionId) REFERENCES attributions(id) ON UPDATE CASCADE');
	if (addedColumn || options.backfill)
		await backfill(runQuery);
}

async function backfill(runQuery) {
	await runQuery(`UPDATE hadiths h JOIN hdith_hadith_metadata m ON m.hadith_id=h.id SET h.attributionId=-1`);
	for (const attribution of ATTRIBUTIONS.filter(item => item.id >= 0))
		await runQuery(`UPDATE hadiths h JOIN hdith_hadith_metadata m ON m.hadith_id=h.id
			SET h.attributionId=? WHERE m.attribution=?`, [attribution.id, attribution.title]);
}

module.exports = { ATTRIBUTIONS, CREATE_TABLE_SQL, backfill, byId, ensureSchema, idForArabic };
