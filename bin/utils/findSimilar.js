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
	var go = true;
	var main = await global.query(
		`SELECT h.id, bookId, num0, body, back_ref, lastmod
		FROM riyad h`);
	main = main.map(Hadith.disemvoweledHadith);
	var all = await Hadith.a_dbGetDisemvoweledHadiths(`SELECT id, bookId, num0, body, back_ref, lastmod FROM hadiths WHERE bookId BETWEEN 1 AND 6 ORDER BY bookId, h1, num0`);
	for (var i = 0; i < main.length; i++) {
		// if (main[i].bookId == 1) go = true ;
		if (!go) console.log(`skipping ${main[i].bookId}:${main[i].num0}`);
		if (go) await Hadith.a_recordSimilarMatches(main[i], all, 'riyad_sim');
	}
	console.log('done');
})();

