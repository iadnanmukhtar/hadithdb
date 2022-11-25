/* jslint node:true, esversion:9 */
'use strict';

const SearchIndex = require("../../lib/SearchIndex");

exports.postSave = async function (req, res, args, next) {

	var rows = await global.query(`SELECT bookId FROM hadiths WHERE id=${args.id[0]}`);
	var sql = `SELECT * FROM v_hadiths WHERE bookId=${rows[0].bookId} ORDER BY h1, numInChapter`;
	rows = await global.query(sql);
	console.log(sql); console.log(`results = ${rows.length}`);
	var i = rows.findIndex(function (row) {
		return (row.hId == parseInt(args.id[0]));
	});
	if (i != undefined) {
		var data = {
			_id: rows[i].hId
		};
		if (i > 0 && rows[i].bookId == rows[i - 1].bookId)
			data.prevId = rows[i - 1].hId;
		if (i < (rows.length - 1) && rows[i].bookId == rows[i + 1].bookId)
			data.nextId = rows[i + 1].hId;
		for (var k in rows[i])
			data[k] = rows[i][k];
		console.log(`PUT ${data.bookAlias}:${data.num}`);
		await global.searchIdx.PUT([data], SearchIndex.TOKENIZER_OPTIONS);
	}
	next();
};