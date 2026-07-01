#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
require('../lib/Globals');

const HadithTranslationIndexView = require('../lib/HadithTranslationIndexView');

(async function main() {
	try {
		const force = process.argv.includes('--force');
		const result = await HadithTranslationIndexView.ensureBaseView({ force });
		const fields = await HadithTranslationIndexView.loadIndexFields({ forceLanguages: true });
		console.log(`v_hadiths base view ${result.updated ? 'restored' : 'ready'}; translated hadith index fields are loaded separately for ${fields.languages.length} language(s).`);
	} finally {
		global.dbPool.end();
	}
})().catch(err => {
	console.error(err.stack || err.message);
	process.exit(1);
});
