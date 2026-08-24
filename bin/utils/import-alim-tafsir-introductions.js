#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

const importer = require('./import-alim-maududi-introductions');

if (require.main === module) {
	importer.run().catch(err => {
		console.error(`ERROR: ${err.stack || err.message}`);
		process.exitCode = 1;
	});
}

module.exports = importer;
