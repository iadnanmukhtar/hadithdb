#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
require('../lib/Globals');

const HadithTranslationIndexView = require('../lib/HadithTranslationIndexView');

(async function main() {
	try {
		const force = process.argv.includes('--force');
		const result = await HadithTranslationIndexView.ensureView({ force, forceLanguages: true });
		console.log(`v_hadiths translation columns ${result.updated ? 'updated' : 'ready'} for ${result.languages.length} language(s), ${result.columns.length} column(s).`);
	} finally {
		global.dbPool.end();
	}
})().catch(err => {
	console.error(err.stack || err.message);
	process.exit(1);
});
