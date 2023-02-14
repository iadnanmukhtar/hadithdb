/* jslint node:true, esversion:9 */
'use strict';

const natural = require('natural');
const Arabic = require('../lib/Arabic');
const fs = require('fs');
const path = require('path');
const stopwords = fs.readFileSync(path.join(__dirname, '/stopwords.txt')).toString().split('\n');

const RE_WORD = /(\p{N}+:\p{N}+|[\p{L}\p{M}\d]+)/gu;

const customerTokenizer = (tokens, field, ops) =>
	global.searchIdx.TOKENIZATION_PIPELINE_STAGES.SPLIT([tokens, field, ops])
		.then(global.searchIdx.TOKENIZATION_PIPELINE_STAGES.SKIP)
		.then(global.searchIdx.TOKENIZATION_PIPELINE_STAGES.LOWCASE)
		.then(global.searchIdx.TOKENIZATION_PIPELINE_STAGES.REPLACE)
		.then(global.searchIdx.TOKENIZATION_PIPELINE_STAGES.STOPWORDS)
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
					{
						var tok1 = Arabic.replaceDagger(tok);
						tok1 = Arabic.removeArabicDiacritics(tok1);
						newTokens.push(Arabic.normalize(tok1, true));
						newTokens.push(Arabic.normalize(tok1, false));
					} {
						var tok2 = Arabic.removeArabicDiacritics(tok);
						newTokens.push(Arabic.normalize(tok2, true));
						newTokens.push(Arabic.normalize(tok2, false));
					}
				}
				return tok;
			});
			newTokens = [...new Set(newTokens)];
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
						newTokens.push(...Arabic.stemArabicWord(tokens[i]));
					} catch (err) {
						// console.error(err);
					}
				}
			}
			tokens = tokens.concat(newTokens);
			tokens = [...new Set(tokens)];
			arr[0] = tokens;
			return arr;
		})
		.then(global.searchIdx.TOKENIZATION_PIPELINE_STAGES.NGRAMS)
		.then(global.searchIdx.TOKENIZATION_PIPELINE_STAGES.SCORE_TERM_FREQUENCY)
		.then(([tokens, field, ops]) => tokens);

module.exports = {
	TOKENIZER_OPTIONS: {
		tokenizer: customerTokenizer,
		tokenSplitRegex: RE_WORD
		// , stopwords: stopwords
	}
};
