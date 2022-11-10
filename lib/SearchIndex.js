/* jslint node:true, esversion:9 */
'use strict';

const natural = require('natural');
const arabicStem = require('arabic-stem');
const Arabic = require('../lib/Arabic');
const jsastem = require('../lib/jsastem');

const RE_WORD = /(\p{N}+:\p{N}+|[\p{L}\p{M}\d]+)/gu;

const customerTokenizer = (tokens, field, ops) =>
	global.searchIdx.TOKENIZATION_PIPELINE_STAGES.SPLIT([tokens, field, ops])
		.then(global.searchIdx.TOKENIZATION_PIPELINE_STAGES.SKIP)
		.then(global.searchIdx.TOKENIZATION_PIPELINE_STAGES.LOWCASE)
		.then(global.searchIdx.TOKENIZATION_PIPELINE_STAGES.REPLACE)
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
		.then(global.searchIdx.TOKENIZATION_PIPELINE_STAGES.STOPWORDS)
		.then(global.searchIdx.TOKENIZATION_PIPELINE_STAGES.NGRAMS)
		.then(global.searchIdx.TOKENIZATION_PIPELINE_STAGES.SCORE_TERM_FREQUENCY)
		.then(([tokens, field, ops]) => tokens);

module.exports = {
	TOKENIZER_OPTIONS: {
		tokenizer: customerTokenizer,
		tokenSplitRegex: RE_WORD
	}
};
