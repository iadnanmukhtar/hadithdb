// @ts-check
'user strict';

const debug = require('debug')('hadithdb:search');
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
	 * @returns {Promise<*>}
	 */
	static async docRandomnly(indexName) {
		var query = {
			function_score: {
				query: { match_all: {} },
				random_score: {}
			}
		};
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
	 * @returns {Promise<*[]>}
	 */
	static async docsFromQueryString(indexName, queryString, offset, size, orderBy) {
		var query = {
			'query_string': {
				'query': queryString
			}
		};
		return await Index.docsFromQuery(indexName, query, offset, size, orderBy);
	}

	/**
	 * @param {string} indexName
	 * @param {*} query 
	 * @param {number} [offset = 0]
	 * @param {number} [size] 
	 * @param {string} [orderBy = '']
	 * @returns {Promise<*[]>}
	 */
	static async docsFromQuery(indexName, query, offset, size, orderBy) {
		return await _query(indexName, query, offset, size, orderBy);
	}

	/**
	 * 
	 */
	static async update(indexName, item) {
		var settings = JSON.parse(fs.readFileSync(HomeDir + '/.hadithdb/settings.json').toString());
		if (settings.search.reindex || settings.search.findSimilar) {

			item.id = item.hId;
			if (settings.search.reindex) {
				try {
					var data = {};
					for (var k in item)
						data[k] = item[k];
					console.log(`reindexing hId=${data.hId}, ${data.ref} on ${indexName}`);
					await _post(indexName, `_update/${data.hId}`, JSON.stringify({ doc: data }));
				} catch (err) {
					console.error(`ERROR: reindexing: ${err}\n${err.stack}`);
					throw err;
				}
			}
			// if (settings.search.findSimilar) {
			//     try {
			//         rows[0].id = id;
			//         console.log(`recording similar matches for ${rows[0].book_alias}:${rows[0].num}`);
			//         var deHadith = Hadith.disemvoweledHadith(rows[0]);
			//         await Hadith.a_recordSimilarMatches(deHadith);
			//     } catch (err) {
			//         console.error(`ERROR: reindexing: ${err}\n${err.stack}`);
			//     }
			// }

		}
	}
}

/**
 * @param {string} indexName
 * @param {*} query 
 * @param {number} [offset = 0]
 * @param {number} [size]
 * @param {string} [orderBy = '']
 * @returns {Promise<*[]>}
 * @private
 */
async function _query(indexName, query, offset, size, orderBy) {
	if (offset === undefined)
		offset = 0;
	if (size === undefined)
		size = (global.settings.search.itemsPerPage + 1);
	var sort = sqlOrderByToElasticSort(orderBy);
	var docs = [];
	var fullQuery = JSON.stringify({
		query: query,
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
		debug(`${((t - t0) / 1000).toFixed(3)} secs from ${indexName}: ${data}`);
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