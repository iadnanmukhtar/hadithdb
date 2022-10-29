/* jslint node:true, esversion:8 */

const HomeDir = require('os').homedir();
const si = require('search-index');
const util = require('util');
const MySQL = require('mysql');
const Arabic = require('../lib/Arabic');

const MySQLConfig = require(HomeDir + '/.hadithdb/store.json');
var dbPool = MySQL.createPool(MySQLConfig.connection);
var query = util.promisify(dbPool.query).bind(dbPool);

(async () => {
	var idx = await si({ name: `${HomeDir}/.hadithdb/si` });
	console.log(`retreiving data to index...`);
	var rows = await query('SELECT * FROM v_hadiths');
	console.log(`creating index...`);
	await idx.FLUSH();
	var batch = [];
	for (var i = 0; i < rows.length; i++) {
		var data = {
			_id: rows[i].hId
		};
		for (var k in rows[i])
			data[k] = rows[i][k];
		data.h1_title = Arabic.removeArabicDiacritics(data.h1_title);
		data.h2_title = Arabic.removeArabicDiacritics(data.h2_title);
		if (batch.length > 1000) {
			console.log(`PUT ${data.bookAlias}:${data.num}`);
			await idx.PUT(batch);
			batch = [];
		}
		batch.push(data);
	}
	console.log(`PUT last batch`);
	await idx.PUT(batch);
	console.log('done');
})();