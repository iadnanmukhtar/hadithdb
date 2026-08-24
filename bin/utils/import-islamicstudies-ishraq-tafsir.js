#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

const importer = require('./import-islamicstudies-dawat-tafsir');

if (require.main === module) {
	importer.run(['--alias', 'ishraq', ...process.argv.slice(2)]).catch(err => {
		console.error(`ERROR: ${err.stack || err.message}`);
		process.exitCode = 1;
	});
}

module.exports = importer;
