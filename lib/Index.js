// @ts-check
'use strict';

const debug = require('debug')('hadithdb:Index');
const createError = require('http-errors');
const fs = require('fs');
const HomeDir = require('os').homedir();
const axios = require('axios');
const Utils = require('./Utils');

const BULK_INDEX_BATCH_SIZE = 25;

/**
 * @type {Index} Document search index
 */
class Index {

	/**
	 * @param {string} indexName
	 * @param {string} queryString
	 * @returns {Promise<*>}
	 */
	static async docRandomnly(indexName, queryString) {
		var query;
		if (queryString) {
			query = {
				function_score: {
					query: {
						query_string: {
							query: queryString
						}
					},
					random_score: {}
				}
			};
		} else {
			query = {
				function_score: {
					query: {
						match_all: {}
					},
					random_score: {}
				}
			};
		}
		return await Index.docsFromQuery(indexName, query, 0, 1);
	}

	/**
	 * @param {string} indexName
	 * @param {number|string} id 
	 * @returns {Promise<*>}
	 */
	static async docFromId(indexName, id) {
		var t0 = new Date().getTime();
		try {
			// @ts-ignore
			var _doc = await axios.get(`${global.settings.search.domain}/${indexName}/_doc/${id}`, {
				headers: {
					'Content-Type': 'application/json'
				}
			});
			if (_doc.status != 200)
				throw createError(502, `${_doc.status} Error finding doc ${id} in Index ${indexName}: ${_doc.statusText}`);
			return _doc.data._source;
		} catch (e) {
			if (e.status || e.statusCode)
				throw e;
			throw searchBackendError('_doc', indexName, e, `Error finding doc ${id} in Index ${indexName}`);
		} finally {
			var t = new Date().getTime();
			debug(`${((t - t0) / 1000).toFixed(3)} secs from /${indexName}/_doc/${id}`);
		}
	}

	/**
	 * @param {string} indexName
	 * @param {*[]} arr 
	 * @param {string} [idColName = 'id']
	 * @param {number} [offset = 0]
	 * @param {number} [size]
	 * @param {string} [orderBy = '']
	 * @returns {Promise<*[]>}
	 */
	static async docsFromObjectArray(indexName, arr, idColName, offset, size, orderBy) {
		if (idColName == undefined)
			idColName = 'id';
		var ids = [];
		for (var i = 0; i < arr.length; i++)
			ids.push(arr[i][idColName]);
		return await Index.docsFromIdArray(indexName, ids, offset, size, orderBy);
	}

	/**
	 * @param {string} indexName
	 * @param {number[]} ids 
	 * @param {number} [offset = 0]
	 * @param {number} [size]
	 * @param {string} [orderBy = '']
	 * @returns {Promise<*[]>}
	 */
	static async docsFromIdArray(indexName, ids, offset, size, orderBy) {
		return await _query(indexName, {
			ids: {
				values: ids
			}
		},
			offset,
			size,
			orderBy);
	}

	/**
	 * @param {string} indexName
	 * @param {Object.<string, *>} keyValue 
	 * @param {number} [offset = 0]
	 * @param {number} [size]
	 * @param {string} [orderBy = '']
	 * @returns {Promise<*[]>}
	 */
	static async docsFromKeyValue(indexName, keyValue, offset, size, orderBy) {
		return await _query(indexName, { match: keyValue }, offset, size, orderBy);
	}

	/**
	 * @param {string} indexName
	 * @param {string} queryString 
	 * @param {number} [offset = 0]
	 * @param {number} [size] 
	 * @param {string} [orderBy = '']
	 * @param {boolean} [highlight]
	 * @param {boolean} [simple]
	 * @returns {Promise<*[]>}
	 */
	static async docsFromQueryString(indexName, queryString, offset, size, orderBy, highlight, simple) {
		queryString = queryString.replace(/([{}])/g, '\\$1');
		var query = null;
		if (simple) {
			query = {
				'query_string': {
					'query': queryString,
					// 'lenient': true
				}
			};
		} else {
			query = {
				'query_string': {
					'query': queryString
				}
			};
		}
		return await Index.docsFromQuery(indexName, query, offset, size, orderBy, highlight);
	}

	/**
	 * @param {string} indexName
	 * @param {*} query 
	 * @param {number} [offset = 0]
	 * @param {number} [size] 
	 * @param {string} [orderBy = '']
	 * @param {boolean} [highlight] 
	 * @returns {Promise<*[]>}
	 */
	static async docsFromQuery(indexName, query, offset, size, orderBy, highlight) {
		return await _query(indexName, query, offset, size, orderBy, highlight);
	}

	/**
	 * @param {string} indexName
	 * @param {*} rec 
	 */
	static async update(indexName, rec) {
		var settings = /** @type Settings */ JSON.parse(fs.readFileSync(HomeDir + '/.hadithdb/settings.json').toString());
		if (settings.search.reindex) {
			try {
				var data = {};
				for (var k in rec)
					data[k] = rec[k];
				decorateSearchFields(data);
				debug(`reindexing hId=${data.hId}, ${data.ref} on ${indexName}`);
				await _post(indexName, `_update/${data.hId}`, JSON.stringify({
					doc: data,
					doc_as_upsert: true
				}));
			} catch (err) {
				console.error(`ERROR: reindexing: ${err}\n${err.stack}`);
				throw err;
			}
		}
	}

	/**
	 * @param {string} indexName
	 * @param {*[]} recs
	 */
	static async updateBulk(indexName, recs, full) {
		debug(`reindexing ${recs.length} docs...`);
		var indexURL = `${global.settings.search.domain}/${indexName}/_bulk`;
		const headers = {
			'Content-Type': 'application/x-ndjson'
		};
		var bulk = '';
		for (var i = 0; i < recs.length; i++) {
			delete recs[i].highlight;
			var data = {};
			for (var k in recs[i])
				data[k] = recs[i][k];
			if (full) {
				if (data.prevId === undefined && i > 0 && recs[i].book_id == recs[i - 1].book_id) {
					data.prevId = recs[i - 1].hId;
					data.prev_ref = recs[i - 1].ref;
					data.prev_path = recs[i - 1].path;
				}
				if (data.nextId === undefined && i < (recs.length - 1) && recs[i].book_id == recs[i + 1].book_id) {
					data.nextId = recs[i + 1].hId;
					data.next_ref = recs[i + 1].ref;
					data.next_path = recs[i + 1].path;
				}
			}
			decorateSearchFields(data);
			bulk += `{ "index" : { "_index":"${indexName}","_id":"${recs[i].hId}" } }\n${JSON.stringify(data)}\n`;
			if (i > 0 && (i % BULK_INDEX_BATCH_SIZE) == 0) {
				Utils.msleep(250);
				debug(`POSTing ${data.ref}`);
				// @ts-ignore
				var res = await axios.post(indexURL, bulk + '\n', { headers });
				debug(`${res.status} errors=${res.data.errors}`);
				bulk = "";
			}
		}
		if (bulk.length > 0) {
			Utils.msleep(500);
			debug(`POSTing last batch`);
			// @ts-ignore
			res = await axios.post(indexURL, bulk + '\n', { headers });
			debug(`${res.status} errors=${res.data.errors}`);
			bulk = "";
		}
	}

	static async refresh(indexName) {
		var t0 = new Date().getTime();
		try {
			await axios.post(`${global.settings.search.domain}/${indexName}/_refresh`);
		} catch (e) {
			throw searchBackendError('_refresh', indexName, e);
		} finally {
			var t = new Date().getTime();
			debug(`${((t - t0) / 1000).toFixed(3)} secs from ${indexName}: _refresh`);
		}
	}

	static async delete(indexName, id) {
		var t0 = new Date().getTime();
		try {
			await axios.delete(`${global.settings.search.domain}/${indexName}/_doc/${id}`);
		} catch (e) {
			if (e.response && e.response.status === 404)
				return;
			throw searchBackendError('_delete', indexName, e);
		} finally {
			var t = new Date().getTime();
			debug(`${((t - t0) / 1000).toFixed(3)} secs from ${indexName}: _delete/${id}`);
		}
	}

	/**
	 * @param {string} indexName
	 * @param {number|string} bookId
	 * @returns {Promise<*[]>}
	 */
	static async deleteByBookId(indexName, bookId) {
		var data = JSON.stringify({
			query: {
				match: {
					book_id: bookId
				}
			}
		});
		return await _post(indexName, '_delete_by_query', data);
	}

	/**
	 * @param {string} indexName
	 * @param {{ id?: number|string; alias?: string }} book
	 * @returns {Promise<*[]>}
	 */
	static async deleteByBook(indexName, book) {
		var should = [];
		if (book && book.id !== undefined)
			should.push({ term: { book_id: book.id } });
		if (book && Utils.trimToEmpty(book.alias) !== '')
			should.push({ term: { book_alias: book.alias } });
		if (should.length < 1)
			throw new TypeError(`deleteByBook requires a book id or alias`);
		var data = JSON.stringify({
			query: {
				bool: {
					should: should,
					minimum_should_match: 1
				}
			}
		});
		return await _post(indexName, '_delete_by_query', data);
	}

}


/**
 * @param {string} indexName
 * @param {*} query 
 * @param {number} [offset = 0]
 * @param {number} [size]
 * @param {string} [orderBy = '']
 * @param {boolean} [highlight] 
 * @returns {Promise<*[]>}
 * @private
 */
async function _query(indexName, query, offset, size, orderBy, highlight) {
	if (offset === undefined)
		offset = 0;
	if (size === undefined)
		size = (global.settings.search.itemsPerPage + 1);
	var sort = sqlOrderByToElasticSort(orderBy);
	var docs = [];
	var highlightParams = {};
	if (highlight) {
		highlightParams = {
			'pre_tags': [
				'<i>'
			],
			'post_tags': [
				'</i>'
			],
			'require_field_match': false,
			'number_of_fragments': 3,
			'fragment_size': 180,
			'fields': [
				{ 'title': {} },
				{ 'title_search_ar': {} },
				{ 'title_en': {} },
				{ 'title_en_search': {} },
				{ 'title_search_en': {} },
				{ 'chain': {} },
				{ 'body': {} },
				{ 'footnote': {} },
				{ 'chain_en': {} },
				{ 'body_en': {} },
				{ 'footnote_en': {} },
				{ 'intro': {} },
				{ 'intro_search_ar': {} },
				{ 'intro_en': {} },
				{ 'intro_search_en': {} },
				{ 'h1_title': {} },
				{ 'h1_title_en': {} },
				{ 'h1_intro': {} },
				{ 'h1_intro_en': {} },
				{ 'h2_title': {} },
				{ 'h2_title_en': {} },
				{ 'h2_intro': {} },
				{ 'h2_intro_en': {} },
				{ 'h3_title': {} },
				{ 'h3_title_en': {} },
				{ 'h3_intro': {} },
				{ 'h3_intro_en': {} },
			]
		}
	}
	var fullQuery = JSON.stringify({
		query: query,
		highlight: highlightParams,
		from: offset,
		size: size,
		sort: sort,
	});
	try {
		var _docs = await _post(indexName, '_search', fullQuery);
		if (_docs.status != 200)
			throw createError(502, `${_docs.status} Error finding docs in Index ${indexName}: ${_docs.statusText}`);
		docs.total = _docs.data?.hits?.total?.value ?? 0;
		for (var n = 0; n < _docs.data.hits.hits.length; n++) {
			var hit = _docs.data.hits.hits[n];
			var doc = hit._source || {};
			doc._score = hit._score;
			if (hit.highlight)
				doc._highlight = hit.highlight;
			docs.push(doc);
		}
	} catch (e) {
		if (e.status || e.statusCode)
			throw e;
		throw searchBackendError('_search', indexName, e, `Error finding docs in Index ${indexName}`);
	}
	return docs;
}

/**
 * @param {string} indexName
 * @param {string} action 
 * @param {string} data 
 */
async function _post(indexName, action, data) {
	var t0 = new Date().getTime();
	var res;
	try {
		// @ts-ignore
		res = await axios.post(`${global.settings.search.domain}/${indexName}/${action}`, data, {
			headers: {
				'Content-Type': 'application/json'
			}
		});
	} catch (e) {
		throw searchBackendError(action, indexName, e);
	} finally {
		var t = new Date().getTime();
		debug(`${((t - t0) / 1000).toFixed(3)} secs from ${indexName}: ${data.substring(0, 500)}`);
	}
	return res;
}

function searchBackendError(action, indexName, e, prefix) {
	if (e.status || e.statusCode)
		return e;
	prefix = prefix || `Error performing '${action}' on Index ${indexName}`;
	if (e.response) {
		const status = e.response.status >= 500 ? 502 : e.response.status;
		return createError(status, `${prefix}: ${searchBackendReason(e)}`);
	}
	const code = e.code || e.cause?.code;
	if (code) {
		return createError(503, `Search backend connection failed while performing '${action}' on Index ${indexName}: ${code}`);
	}
	return createError(503, `${prefix}: ${e.message}`);
}

function searchBackendReason(e) {
	return e.response?.data?.error?.root_cause?.[0]?.reason ||
		e.response?.data?.error?.reason ||
		e.response?.statusText ||
		e.message;
}

function decorateSearchFields(data) {
	if (data && data.doctype === 'toc')
		decorateTocSearchFields(data);
	copySearchField(data, 'book_name_search_ar', 'book_name');
	copySearchField(data, 'book_shortName_search_ar', 'book_shortName');
	copySearchField(data, 'book_name_search_en', 'book_name_en');
	copySearchField(data, 'book_name_search_en_prefix', 'book_name_en');
	copySearchField(data, 'book_shortName_search_en', 'book_shortName_en');
	copySearchField(data, 'book_shortName_search_en_prefix', 'book_shortName_en');
	copySearchField(data, 'title_en_search', 'title_en');
	copySearchField(data, 'title_en_prefix', 'title_en');
	copySearchField(data, 'chain_en_search', 'chain_en');
	copySearchField(data, 'part_en_search', 'part_en');
	copySearchField(data, 'body_en_search', 'body_en');
	copySearchField(data, 'footnote_en_search', 'footnote_en');
	copySearchField(data, 'h1_title_en_search', 'h1_title_en');
	copySearchField(data, 'h1_title_en_prefix', 'h1_title_en');
	copySearchField(data, 'h2_title_en_search', 'h2_title_en');
	copySearchField(data, 'h2_title_en_prefix', 'h2_title_en');
	copySearchField(data, 'h3_title_en_search', 'h3_title_en');
	copySearchField(data, 'h3_title_en_prefix', 'h3_title_en');

	copySearchField(data, 'title_search_ar', 'title');
	copySearchField(data, 'intro_search_ar', 'intro');
	copySearchField(data, 'title_search_en', 'title_en');
	copySearchField(data, 'title_search_en_prefix', 'title_en');
	copySearchField(data, 'intro_search_en', 'intro_en');

	copySearchField(data, 'grader_name_search_ar', 'grader_name');
	copySearchField(data, 'grader_shortName_search_ar', 'grader_shortName');
	copySearchField(data, 'grade_grade_search_ar', 'grade_grade');
	copySearchField(data, 'grader_name_search_en', 'grader_name_en');
	copySearchField(data, 'grader_shortName_search_en', 'grader_shortName_en');
	copySearchField(data, 'grade_grade_search_en', 'grade_grade_en');
}

function decorateTocSearchFields(data) {
	var level = Number.isFinite(data.level) ? data.level : parseInt(data.level, 10);
	if (![1, 2, 3].includes(level))
		return;
	var titleKey = `h${level}_title`;
	var titleEnKey = `h${level}_title_en`;
	var introKey = `h${level}_intro`;
	var introEnKey = `h${level}_intro_en`;

	copyDisplayField(data, 'title', titleKey);
	copyDisplayField(data, 'title_en', titleEnKey);
	copyDisplayField(data, 'intro', introKey);
	copyDisplayField(data, 'intro_en', introEnKey);

	for (var i = 1; i <= 3; i++) {
		if (i === level)
			continue;
		delete data[`h${i}_title_en_search`];
		delete data[`h${i}_title_en_prefix`];
	}
}

function copyDisplayField(data, targetKey, sourceKey) {
	var value = data[sourceKey];
	if (typeof value === 'string') {
		value = Utils.trimToEmpty(value);
		if (value !== '')
			data[targetKey] = value;
		else
			delete data[targetKey];
	} else {
		delete data[targetKey];
	}
}

function copySearchField(data, targetKey, sourceKey) {
	var value = data[sourceKey];
	if (typeof value === 'string') {
		value = Utils.trimToEmpty(value);
		if (value !== '')
			data[targetKey] = value;
		else
			delete data[targetKey];
	} else {
		delete data[targetKey];
	}
}

/**
 * @param {string} [orderBy = '']
 * @returns {*[]}
 */
function sqlOrderByToElasticSort(orderBy) {
	var sort = [];
	if (orderBy === undefined || Utils.trimToEmpty(orderBy) === '')
		return sort;
	var cols = orderBy.split(/,/);
	for (var col of cols) {
		var toks = Utils.trimToEmpty(col).split(/\s/);
		col = toks[0];
		var dir = (toks.length > 1) ? toks[1].toLowerCase() : 'asc';
		var _col = {};
		_col[col] = dir;
		sort.push(_col);
	}
	return sort;
}

module.exports = Index;
