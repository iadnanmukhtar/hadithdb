#!/usr/bin/env node
'use strict';

require('dotenv').config();
require('../../lib/Globals');

const Utils = require('../../lib/Utils');
const RuntimeRefresh = require('../../lib/RuntimeRefresh');

(async () => {
	const alias = Utils.trimToEmpty(process.argv[2]).toLowerCase();
	if (!alias)
		throw new Error('Usage: node bin/utils/flush-book-disk-cache.js <book-alias>');
	const rows = await global.query(`SELECT id, alias FROM books WHERE alias='${Utils.escSQL(alias)}' LIMIT 1`);
	if (!rows.length)
		throw new Error(`Book not found: ${alias}`);
	const result = await Utils.flushBookDiskCache(alias, { strict: true });
	const generation = await RuntimeRefresh.publish();
	console.log(JSON.stringify({ ...result, runtimeGeneration: generation }, null, 2));
	process.exit();
})().catch(error => {
	console.error(error.stack || error.message || error);
	process.exit(1);
});
