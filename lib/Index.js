// @ts-check
'user strict';

const debug = require('debug')('hadithdb:Index');
const fs = require('fs');
const HomeDir = require('os').homedir();
const axios = require('axios');
const Utils = require('./Utils');

/**
 * @type {Index} Document search index
 */
class Index {

	/**
	 * @param {string} indexName
	 * @param {object} keyValue
	 * @returns {Promise<*>}
	 */
	static async docRandomnly(indexName, keyValue) {
		var query;
		if (keyValue) {
			query = {
				function_score: {
					query: {
						term: keyValue
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
				throw new ReferenceError(`${_doc.status} Error finding Id ${id} in Index ${indexName}: ${_doc.statusText}`);
			return _doc.data._source;
		} catch (e) {
			throw new ReferenceError(`${e.response.status} Error finding Doc ${id} in Index ${indexName}: ${e.response.statusText}`);
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
	 * @returns {Promise<*[]>}
	 */
	static async docsFromQueryString(indexName, queryString, offset, size, orderBy, highlight) {
		queryString = queryString.replace(/([{}])/g, '\\$1');
		var query = {
			'query_string': {
				'query': queryString
			}
		};
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
				debug(`reindexing hId=${data.hId}, ${data.ref} on ${indexName}`);
				await _post(indexName, `_update/${data.hId}`, JSON.stringify({ doc: data }));
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
	static async updateBulk(indexName, recs) {
		debug(`reindexing ${recs.length} docs...`);
		var indexURL = `${global.settings.search.domain}/${indexName}/_bulk`;
		const headers = {
			'Content-Type': 'application/x-ndjson'
		};
		var bulk = '';
		for (var i = 0; i < recs.length; i++) {
			delete recs[i].highlight;
			var data = {};
			if (i > 0 && recs[i].book_id == recs[i - 1].book_id) {
				data.prevId = recs[i - 1].hId;
				data.prev_ref = recs[i - 1].ref;
				data.prev_path = recs[i - 1].path;
			}
			if (i < (recs.length - 1) && recs[i].book_id == recs[i + 1].book_id) {
				data.nextId = recs[i + 1].hId;
				data.next_ref = recs[i + 1].ref;
				data.next_path = recs[i + 1].path;
			}
			for (var k in recs[i])
				data[k] = recs[i][k];
			bulk += `{ "index" : { "_index":"${indexName}","_id":"${recs[i].hId}" } }\n${JSON.stringify(data)}\n`;
			if (i > 0 && (i % 50) == 0) {
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
			'fields': [
				{ 'title': {} },
				{ 'title_en': {} },
				{ 'chain': {} },
				{ 'body': {} },
				{ 'footnote': {} },
				{ 'chain_en': {} },
				{ 'body_en': {} },
				{ 'footnote_en': {} },
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
			throw new ReferenceError(`${_docs.status} Error finding Docs in Index ${indexName}: ${_docs.statusText}`);
		for (var n = 0; n < _docs.data.hits.hits.length; n++)
			docs.push(_docs.data.hits.hits[n]._source);
	} catch (e) {
		throw new ReferenceError(`${e.response ? e.response.status : ''} Error finding Docs in Index ${indexName}: ${e.response ? e.response.data.error.root_cause[0].reason : e.message}`)
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
		throw new ReferenceError(`${e.response ? e.response.status : ''} Error performing '${action}' on Index ${indexName}: ${e.response ? e.response.data.error.root_cause[0].reason : e.message}`)
	} finally {
		var t = new Date().getTime();
		debug(`${((t - t0) / 1000).toFixed(3)} secs from ${indexName}: ${data.substring(0, 500)}`);
	}
	return res;
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