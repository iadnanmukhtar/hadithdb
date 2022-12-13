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
	var rows = await Hadith.a_dbGetDisemvoweledHadiths();
	for (var i = 0; i < rows.length; i++) {
		if (rows[i].bookId == 8 && rows[i].num0 == 1719) go = true;
		if (!go) console.log(`skipping ${rows[i].bookId}:${rows[i].num0}`);
		if (go) await Hadith.a_recordSimilarMatches(rows[i], rows);
	}
})();

