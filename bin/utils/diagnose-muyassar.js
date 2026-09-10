#!/usr/bin/env node
'use strict';

require('dotenv').config();
require('../../lib/Globals');

(async () => {
	try {
		const bilingual = await global.query(`
			SELECT id, alias, lang, source, format, surah_dir
			FROM books WHERE alias IN ('ibn-kathir','jalalayn','mokhtasar','muntakhab','muyassar')
			ORDER BY alias`);
		console.log('BOOKS:', JSON.stringify(bilingual, null, 2));

		const mokhtasar = bilingual.find(row => row.alias === 'mokhtasar');
		if (mokhtasar) {
			const counts = await global.query(`
				SELECT COUNT(*) AS row_count,
					SUM(CASE WHEN TRIM(COALESCE(text,''))<>'' THEN 1 ELSE 0 END) AS ar_rows,
					SUM(CASE WHEN TRIM(COALESCE(text_en,''))<>'' THEN 1 ELSE 0 END) AS en_rows
				FROM hadiths_commentary WHERE bookId=${mokhtasar.id}`);
			console.log('MOKHTASAR COUNTS:', JSON.stringify(counts, null, 2));
		}

		const muyassar = bilingual.find(row => row.alias === 'muyassar');
		if (muyassar) {
			const uct = await global.query(`
				SELECT COUNT(*) AS c, COUNT(DISTINCT item_id) AS distinct_items
				FROM user_content_translations WHERE item_type='tafsir' AND mode='translate'`);
			console.log('USER_CONTENT_TRANSLATIONS (tafsir):', JSON.stringify(uct, null, 2));
			const muyassarUct = await global.query(`
				SELECT COUNT(*) AS c
				FROM user_content_translations uct
				JOIN hadiths_commentary hc ON hc.id=CAST(uct.item_id AS UNSIGNED)
				WHERE hc.bookId=${muyassar.id} AND uct.item_type='tafsir' AND uct.mode='translate'`);
			console.log('MUYASSAR UCT:', JSON.stringify(muyassarUct, null, 2));
			const lengths = await global.query(`
				SELECT
					MIN(CHAR_LENGTH(COALESCE(text,''))) AS min_ar,
					MAX(CHAR_LENGTH(COALESCE(text,''))) AS max_ar,
					ROUND(AVG(CHAR_LENGTH(COALESCE(text,''))),1) AS avg_ar,
					SUM(CHAR_LENGTH(COALESCE(text,''))) AS total_ar,
					SUM(ayahTo-ayahFrom+1) AS total_ayahs
				FROM hadiths_commentary WHERE bookId=${muyassar.id}`);
			console.log('MUYASSAR LENGTHS:', JSON.stringify(lengths, null, 2));
		}
	} finally {
		global.dbPool.end();
	}
})().catch(err => {
	console.error(err.stack || err);
	process.exit(1);
});
