#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

/**
 * Usage:
 *   node bin/tagHadithsByPhrase.js "<phrase to find>" "<tag-name>"
 *
 * Finds hadiths in the Elasticsearch index whose text contains the phrase,
 * applies the tag in MySQL (tags/text_en + hadiths_tags), and reindexes
 * the updated hadith documents.
 */

require('dotenv').config();
require('../lib/Globals');
const axios = require('axios');
const Utils = require('../lib/Utils');
const Index = require('../lib/Index');
const { Item } = require('../lib/Model');

const phrase = process.argv[2];
const tagName = process.argv[3];

if (!phrase || !tagName) {
	console.error('Usage: node bin/tagHadithsByPhrase.js "<phrase to find>" "<tag-name>"');
	process.exit(1);
}

(async () => {
	try {
		console.log(`Searching for phrase "${phrase}"...`);
		const hadithIds = await searchHadithIds(phrase);
		if (!hadithIds.length) {
			console.log('No hadiths matched that phrase.');
			return;
		}
		console.log(`Found ${hadithIds.length} hadith(s). Applying tag "${tagName}"...`);
		const tagId = await ensureTag(tagName);
		await tagHadiths(hadithIds, tagId);
		console.log('Done.');
	} catch (err) {
		console.error('Error tagging hadiths:', err.message);
		process.exitCode = 1;
	} finally {
		global.dbPool.end();
	}
})();

async function searchHadithIds(queryText) {
	const size = 200;
	let from = 0;
	const ids = [];
	const fields = ['title', 'title_en', 'body', 'body_en', 'footnote', 'footnote_en', 'chain', 'chain_en'];
	while (true) {
		const res = await axios.post(`${global.settings.search.domain}/${Item.INDEX}/_search`, {
			query: {
				multi_match: {
					query: queryText,
					type: 'phrase',
					fields
				}
			},
			_source: ['hId'],
			from,
			size
		}, {
			headers: { 'Content-Type': 'application/json' }
		});
		const hits = res.data && res.data.hits && Array.isArray(res.data.hits.hits) ? res.data.hits.hits : [];
		if (!hits.length) break;
		hits.forEach(hit => {
			if (hit._source && hit._source.hId !== undefined) {
				const hId = parseInt(hit._source.hId, 10);
				if (Number.isInteger(hId)) ids.push(hId);
			}
		});
		if (hits.length < size) break;
		from += size;
	}
	return Array.from(new Set(ids));
}

async function ensureTag(text) {
	const tagText = Utils.trimToEmpty(text);
	if (!tagText) throw new Error('Tag name cannot be empty');
	const esc = Utils.escSQL(tagText);
	const existing = await global.query(`SELECT id FROM tags WHERE text_en='${esc}' LIMIT 1`);
	if (existing && existing.length) return existing[0].id;
	await global.query(`INSERT INTO tags (text_en) VALUES ('${esc}')`);
	const rows = await global.query(`SELECT id FROM tags WHERE text_en='${esc}' LIMIT 1`);
	if (!rows.length) throw new Error('Failed to create/find tag');
	return rows[0].id;
}

async function tagHadiths(hadithIds, tagId) {
	for (const id of hadithIds) {
		await global.query(`INSERT IGNORE INTO hadiths_tags (hadithId, tagId) VALUES (${id}, ${tagId})`);
		await global.query(`UPDATE hadiths SET lastfixed=CURRENT_TIMESTAMP() WHERE id=${id}`);
		const itemRows = await global.query(`SELECT * FROM v_hadiths WHERE hId=${id} LIMIT 1`);
		if (itemRows && itemRows.length) {
			await Index.update(Item.INDEX, itemRows[0]);
		}
		console.log(`Tagged and reindexed hadith ${id}`);
	}
}
