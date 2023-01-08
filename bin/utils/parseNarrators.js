/* jslint node:true, esversion:9 */
'use strict';

const HomeDir = require('os').homedir();
const util = require('util');
const MySQL = require('mysql');
const Hadith = require('../../lib/Hadith');

const MySQLConfig = require(HomeDir + '/.hadithdb/store.json');
var dbPool = MySQL.createPool(MySQLConfig.connection);
global.query = util.promisify(dbPool.query).bind(dbPool);

(async () => {
	var go = false;
	var rows = await global.query(`SELECT id, bookId, num, num0, chain_en, chain FROM hadiths WHERE bookId>0 ORDER BY bookId, h1, h2, h3, num0`);
	for (var i = 0; i < rows.length; i++) {
		if (rows[i].bookId == 5 && rows[i].num == 2575) go = true ;
		if (!go) console.log(`skipping ${rows[i].bookId}:${rows[i].num0}`);
		try {
			if (go) await Hadith.a_parseNarrators(rows[i]);
		} catch (err) {
			console.log(`${err}\n${err.stack}`);
		}
	}
	console.log('done');
})();

