/* jslint node:true, esversion:9 */
'use strict';

const HomeDir = require('os').homedir();
const util = require('util');
const MySQL = require('mysql');
const Hadith = require('../../lib/Hadith');
const Utils = require('../../lib/Utils');

const MySQLConfig = require(HomeDir + '/.hadithdb/store.json');
var dbPool = MySQL.createPool(MySQLConfig.connection);
global.query = util.promisify(dbPool.query).bind(dbPool);

(async () => {
	var go = false;
	var rows = await global.query(`SELECT id, bookId, num, num0, chain_en, chain, body, text FROM hadiths WHERE remark=0 and bookId>0 and bookId<1000 ORDER BY bookId, h1, h2, h3, num0`);
	// await global.query(`create temporary table x (select distinct h.id from hadiths_narrs n, hadiths h where n.hadithId=h.id and length(n.name_en) > 100)`);
	// await global.query(`update hadiths set text=concat(chain, ' ', body) where id in (select * from x)`);
	// var rows = await global.query(`SELECT h.* FROM x, hadiths h WHERE x.id=h.id order by h.bookId,h.num0`);
	var updateCnt = 0;
	var updates = '';
	for (var i = 0; i < rows.length; i++) {
		if (rows[i].bookId == 12 && rows[i].num0 == 2048) go = true;
		if (!go) console.log(`skipping ${rows[i].bookId}:${rows[i].num0}`);
		if (go) {
			try {
				//var prevLen = rows[i].chain.length;
				rows[i].text = rows[i].chain + ' ' + rows[i].body;
				await Hadith.splitHadithText(rows[i]);
				//if (rows[i].chain.length < prevLen) {
				if (updateCnt > 0)
					updates += ` UNION ALL `;
				updates += ` SELECT ${rows[i].id} AS id, '${Utils.escSQL(rows[i].chain)}' AS new_chain, '${Utils.escSQL(rows[i].body)}' AS new_body`;
				updateCnt++;
				await Hadith.a_parseNarrators(rows[i]);
			} catch (err) {
				console.log(`${err}\n${err.stack}`);
			}
			if (updateCnt > 50) {
				console.log(`update chains ${updates}`);
				await global.query(`UPDATE hadiths h JOIN ( ${updates} ) vals ON h.id=vals.id SET chain=new_chain, body=new_body`);
				updates = '';
				updateCnt = 0;
			}
		}
	}
	if (updateCnt > 0) {
		console.log(`update chains ${updates}`);
		await global.query(`UPDATE hadiths h JOIN ( ${updates} ) vals ON h.id=vals.id SET chain=new_chain, body=new_body`);
		updates = '';
		updateCnt = 0;
	}
	console.log('done');
})();

