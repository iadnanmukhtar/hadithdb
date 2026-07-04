// @ts-check
'use strict';

const crypto = require('crypto');
const Index = require('./Index');
const Utils = require('./Utils');

const INDEX = 'hadith_knowledge';
const DISABLED_STATUS = Object.freeze({
	status: 'disabled',
	reason: 'hadith knowledge building is disabled'
});

class HadithKnowledge {

	static INDEX = INDEX;

	static async ensureTable() {
		return DISABLED_STATUS;
	}

	static async getHadithRows(options) {
		return [];
	}

	static sourceHash(row) {
		return crypto.createHash('sha256')
			.update([
				row?.title || '',
				row?.chain || '',
				row?.body || '',
				row?.footnote || ''
			].join('\n'))
			.digest('hex');
	}

	static async buildForHadith(row, options) {
		return disabledResult(row);
	}

	static async syncForHadith(row, options) {
		return disabledResult(row);
	}

	static async syncForHadithId(hadithId, options) {
		return Object.assign({}, DISABLED_STATUS, { hadithId: hadithId });
	}

	static async syncForHadithRows(rows, options) {
		return (rows || []).map(row => disabledResult(row));
	}

	static async save(doc) {
		return DISABLED_STATUS;
	}

	static async indexStored(options) {
		return [];
	}

	static async search(question, books, topK) {
		topK = parseInt((topK || 6).toString(), 10);
		if (!Number.isInteger(topK) || topK < 1)
			topK = 6;
		var query = buildKnowledgeQuery(question, books);
		var matches = await Index.docsFromQuery(INDEX, query, 0, Math.min(topK * 4, 40), '_score DESC, book_id ASC, ordinal ASC', true);
		var ids = [];
		var seen = new Set();
		for (var match of matches) {
			var id = parseInt((match.hadithId || match.hId || '').toString(), 10);
			if (!Number.isInteger(id) || seen.has(id))
				continue;
			seen.add(id);
			ids.push(id);
			if (ids.length >= topK)
				break;
		}
		if (ids.length < 1)
			return [];
		var items = await Index.docsFromIdArray('hadiths', ids, 0, ids.length);
		var byId = new Map(items.map(item => [parseInt((item.hId || item.id || '').toString(), 10), item]));
		return ids.map(id => byId.get(id)).filter(Boolean);
	}

}

module.exports = HadithKnowledge;

function disabledResult(row) {
	return Object.assign({}, DISABLED_STATUS, {
		hadithId: row?.hId || row?.hadithId || row?.id,
		ref: row?.ref
	});
}

function buildKnowledgeQuery(question, books) {
	var filters = [];
	var bookAliases = normalizeBookFilters(books);
	if (bookAliases.length > 0)
		filters.push({ terms: { book_alias: bookAliases } });
	var query = {
		bool: {
			should: [
				{ multi_match: { query: question, type: 'phrase', fields: ['likely_questions_en_search^8', 'summary_en_search^5', 'topics_en_search^5', 'teaching_en_search^4', 'keywords_en_search^3', 'search_text_en^3'] } },
				{ multi_match: { query: question, type: 'best_fields', operator: 'and', fields: ['likely_questions_en_search^6', 'summary_en_search^4', 'topics_en_search^4', 'teaching_en_search^3', 'keywords_en_search^3', 'search_text_en^2'] } },
				{ multi_match: { query: question, type: 'best_fields', operator: 'or', fields: ['likely_questions_en_search^4', 'summary_en_search^3', 'topics_en_search^3', 'teaching_en_search^2', 'keywords_en_search^2', 'search_text_en'] } }
			],
			minimum_should_match: 1
		}
	};
	if (filters.length > 0)
		query.bool.filter = filters;
	return query;
}

function normalizeBookFilters(books) {
	if (!books)
		return [];
	if (!Array.isArray(books))
		books = [books];
	var aliases = books.map(book => Utils.trimToEmpty(book)).filter(Boolean);
	if (aliases.indexOf('sahihayn') >= 0)
		aliases.push('bukhari', 'muslim');
	if (aliases.indexOf('kutubarbaah') >= 0)
		aliases.push('abudawud', 'tirmidhi', 'nasai', 'ibnmajah');
	if (aliases.indexOf('sixbooks') >= 0)
		aliases.push('bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah');
	return Array.from(new Set(aliases.filter(alias => alias !== 'sahihayn' && alias !== 'kutubarbaah' && alias !== 'sixbooks' && alias !== 'toc')));
}
