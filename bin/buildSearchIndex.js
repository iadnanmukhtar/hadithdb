/* jslint node:true, esversion:9 */

const HomeDir = require('os').homedir();
const si = require('search-index');
const util = require('util');
const MySQL = require('mysql');
const natural = require('natural');
const arabicStem = require('arabic-stem');
const Arabic = require('../lib/Arabic');
const jsastem = require('../lib/jsastem');

const RE_WORD = /(\p{N}+:\p{N}+|[\p{L}\p{M}\d]+)/gu;

var idx = null;

(async () => {
	idx = await si({ name: `${HomeDir}/.hadithdb/si` });
	console.log(`retreiving data to index...`);
	var rows = await getData();
	console.log(`creating index...`);
	await idx.FLUSH();
	var idxPutOptions = {
		tokenizer: customTokenizer,
		tokenSplitRegex: RE_WORD
	};
	var batch = [];
	for (var i = 0; i < rows.length; i++) {
		var data = {
			_id: rows[i].hId
		};
		if (i > 0 && rows[i].bookId == rows[i - 1].bookId)
			data.prev = rows[i - 1].hId;
		if (i < (rows.length - 1) && rows[i].bookId == rows[i + 1].bookId)
			data.next = rows[i + 1].hId;
		for (var k in rows[i])
			data[k] = rows[i][k];
		if (batch.length > 1000) {
			console.log(`PUT ${data.bookAlias}:${data.num}`);
			await idx.PUT(batch, idxPutOptions);
			batch = [];
		}
		batch.push(data);
	}
	console.log(`PUT last batch`);
	await idx.PUT(batch, idxPutOptions);
	var result = await idx.SEARCH(['abu'], { DOCUMENTS: true });
	console.log(result.RESULT.length);
	console.log('done');
})();

async function getData() {
	const MySQLConfig = require(HomeDir + '/.hadithdb/store.json');
	var dbPool = MySQL.createPool(MySQLConfig.connection);
	var query = util.promisify(dbPool.query).bind(dbPool);
	var rows = await query(`
		SELECT * FROM v_hadiths 
		ORDER BY bookId, h1, numInChapter, num0
		-- LIMIT 1`);
	dbPool.end();
	return rows;
}

async function getTestData() {
	return [
		{
			test: 'Abū Hurayrah 1:3'
		}
	];
}

const customTokenizer = (tokens, field, ops) =>
	idx.TOKENIZATION_PIPELINE_STAGES.SPLIT([tokens, field, ops])
		.then(idx.TOKENIZATION_PIPELINE_STAGES.SKIP)
		.then(idx.TOKENIZATION_PIPELINE_STAGES.LOWCASE)
		.then(idx.TOKENIZATION_PIPELINE_STAGES.REPLACE)
		.then(function (arr) {
			var tokens = arr[0];
			tokens = tokens.map(tok => tok.toLowerCase());
			tokens = tokens.map(tok => tok.normalize("NFD").replace(/[\u0300-\u036f]/g, ''));
			tokens = tokens.map(function (tok) {
				return tok.replace(/[ʿʾ`']/g, '');
			});
			var newTokens = [];
			for (var i = 0; i < tokens.length; i++) {
				if (tokens[i].indexOf(':') >= 0)
					newTokens = newTokens.concat(tokens[i].split(/:/));
			}
			tokens = tokens.map(function (tok) {
				if (Arabic.isArabic(tok)) {
					var tok0 = Arabic.removeArabicDiacritics(tok);
					tok = Arabic.normalize(tok0);
					if (tok0 != tok && newTokens.indexOf(tok0) < 0)
						newTokens.push(tok0);
				}
				return tok;
			});
			tokens = tokens.concat(newTokens);
			arr[0] = tokens;
			return arr;
		})
		.then(function (arr) {
			var tokens = arr[0];
			// english stemmer
			tokens = tokens.map(function (tok) {
				if (!Arabic.isArabic(tok))
					tokens.push(natural.PorterStemmer.stem(tok));
				return tok;
			});
			// arabic stemmer
			var newTokens = [];
			for (var i = 0; i < tokens.length; i++) {
				if (Arabic.isArabic(tokens[i])) {
					try {
						var stems = new arabicStem().stem(tokens[i]);
						if (stems && stems.stem)
							newTokens.push(...stems.stem);
						if (stems && stems.normalized && newTokens.indexOf(stems.normalized) < 0)
							newTokens.push(stems.normalized);
						var stem = jsastem(tokens[i]);
						if (newTokens.indexOf(stem) < 0)
							newTokens.push(stem);
					} catch (err) {
						// console.error(err);
					}
				}
			}
			tokens = tokens.concat(newTokens);
			arr[0] = tokens;
			return arr;
		})
		// .then(function (arr) {
		// 	console.log(arr[0]);
		// 	return arr;
		// })
		.then(idx.TOKENIZATION_PIPELINE_STAGES.STOPWORDS)
		.then(idx.TOKENIZATION_PIPELINE_STAGES.NGRAMS)
		.then(idx.TOKENIZATION_PIPELINE_STAGES.SCORE_TERM_FREQUENCY)
		.then(([tokens, field, ops]) => tokens);

