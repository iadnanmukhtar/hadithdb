/* jslint node:true, esversion:9 */
'use strict';

const fs = require('fs');
const HomeDir = require('os').homedir();
const axios = require('axios');
const Hadith = require("../lib/Hadith");

exports.postSave = async function (req, res, args, next) {
	try {
		console.log(`updated ${args.name}:${args.id[0]} by ${req.session.user.name}`);
		//console.log(`${JSON.stringify(args.data.view)}`);

		try {
			await global.query(`UPDATE ${args.name} SET lastmod_user='${req.session.user.name}' WHERE id=${args.id[0]}`);
		} catch (err) { }

		if (args.name == 'hadiths') {

			var settings = JSON.parse(fs.readFileSync(HomeDir + '/.hadithdb/settings.json'));
			if (settings.reindex || settings.findSimilar) {

				console.log(`post processing ${args.id[0]}`);

				var rows = await global.query(`SELECT * FROM v_hadiths WHERE hId=${args.id[0]}`);
				if (rows.length > 0) {
					rows[0].id = rows[0].hId;

					try {
						if (!args.data.view.hadiths.records[0].columns.chain_en)
							await Hadith.a_parseNarrators(rows[0]);
					} catch (err) {
						console.error(`ERROR: parsing narrators: ${err}\n${err.stack}`);
					}

					if (settings.reindex) {
						try {
							var data = {
								ref: rows[0].book_alias + ':' + rows[0].num
							};
							delete rows[0].lastmod;
							delete rows[0].highlight;
							for (var k in rows[0])
								data[k] = rows[0][k];
							console.log(`reindexing ${data.book_alias}:${data.num}`);
							var res = await axios.post(
								global.searchURL + '/_update/' + rows[0].hId,
								{ doc: data },
								{ 'Content-Type': 'application/json' });
							console.log(`${res.status} ${JSON.stringify(res.data)}`);
						} catch (err) {
							console.error(`ERROR: reindexing: ${err}\n${err.stack}`);
						}
					}
					if (settings.findSimilar) {
						try {
							rows[0].id = args.id[0];
							console.log(`recording similar matches for ${rows[0].book_alias}:${rows[0].num}`);
							var deHadith = Hadith.disemvoweledHadith(rows[0]);
							await Hadith.a_recordSimilarMatches(deHadith);
						} catch (err) {
							console.error(`ERROR: reindexing: ${err}\n${err.stack}`);
						}
					}

				}
			}
		}

	} catch (err) {
		console.error(err);
	}
	next();
};