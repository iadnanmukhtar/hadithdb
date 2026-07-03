#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
require('../lib/Globals');

const HadithTranslationIndexView = require('../lib/HadithTranslationIndexView');
const Index = require('../lib/Index');
const { Item } = require('../lib/Model');

(async () => {
	try {
		await HadithTranslationIndexView.refreshAvailability();
		const view = await HadithTranslationIndexView.ensureView({ force: true });
		log(`v_hadiths availability column ${view.updated ? 'updated' : 'ready'}`);
		await HadithTranslationIndexView.dropAvailabilityTable();
		const rows = await global.query(`
			SELECT *
			FROM v_hadiths
			WHERE available_translation_languages IS NOT NULL
				AND JSON_LENGTH(available_translation_languages) > 0
			ORDER BY book_id, ordinal
		`);
		log(`updating ${rows.length} translated hadith document(s)`);
		await Index.updateBulkPartial(Item.INDEX, rows);
		await Index.refresh(Item.INDEX);
		log('hadith translation availability update complete');
	} finally {
		global.dbPool.end();
	}
})().catch(err => {
	console.error(err.stack || err.message || err);
	process.exit(1);
});

function log(message) {
	console.log(message);
}
