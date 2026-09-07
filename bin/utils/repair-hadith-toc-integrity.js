#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');
const util = require('util');
const zlib = require('zlib');
const Utils = require('../../lib/Utils');
const { normalizeHadithForComparison } = require('./import-hdith-six-books-enrichment');

const CACHE_DIR = process.env.HDITH_CACHE_DIR || path.join('/tmp', 'hadithdb-hdith-six-books-enrichment');
const IBN_HIBBAN_CACHE_DIR = path.join(CACHE_DIR, 'b-10');
const IBN_HIBBAN_BOOK_ID = 11;

function compact(value) {
	return String(value === null || value === undefined ? '' : value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizedTitle(value) {
	return Utils.normalizeArabicHonorifics(compact(value));
}

function payloadReference(payload) {
	return compact((payload.numberings || []).find(row => compact(row?.value))?.value);
}

function readCachedPayloads(directory = IBN_HIBBAN_CACHE_DIR) {
	if (!fs.existsSync(directory)) throw new Error(`Ibn Hibban cache is missing: ${directory}`);
	return fs.readdirSync(directory).filter(name => /^\d+\.json(?:\.gz)?$/.test(name)).map(name => {
		const file = path.join(directory, name);
		const data = fs.readFileSync(file);
		return JSON.parse((name.endsWith('.gz') ? zlib.gunzipSync(data) : data).toString('utf8'));
	}).filter(payload => payload.book?.slug === 'b-10' && !(payload.is_intro || payload.entry_kind === 'intro') && payloadReference(payload));
}

function sourcePath(payload) {
	const items = (payload.chapter_path || []).slice(0, 3).map(item => ({ id: Number(item.id), title: normalizedTitle(item.title) }));
	if (!items.length || items.some(item => !Number.isInteger(item.id)))
		throw new Error(`Cached source entry ${payload.id} has an invalid chapter path.`);
	const deepestTitle = normalizedTitle(payload.chapter_text);
	if (deepestTitle) items[items.length - 1].title = deepestTitle;
	return items;
}

function buildIbnHibbanPlan(payloads, hadiths, metadata) {
	const hadithById = new Map(hadiths.map(row => [Number(row.id), row]));
	const hadithsByNum = new Map();
	for (const row of hadiths) {
		const num = String(row.num);
		if (hadithsByNum.has(num)) throw new Error(`Ibn Hibban has duplicate local reference ${num}.`);
		hadithsByNum.set(num, row);
	}
	const metadataBySourceId = new Map(metadata.map(row => [Number(row.source_entry_id), row]));
	let metadataMismatches = 0;
	const assignedHadithIds = new Set();
	const unmatchedPayloads = [];
	const records = payloads.flatMap(payload => {
		const reference = payloadReference(payload);
		const mapped = metadataBySourceId.get(Number(payload.id));
		const metadataHadith = mapped ? hadithById.get(Number(mapped.hadith_id)) : null;
		let hadith = metadataHadith;
		if (mapped && compact(mapped.source_edition_reference) !== reference) {
			metadataMismatches++;
			hadith = null;
		}
		if (!hadith) {
			hadith = hadithsByNum.get(reference);
			if (!hadith) {
				const variants = hadiths.filter(row => String(row.num).match(new RegExp(`^${reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[a-z]+|-\\d+)$`, 'i')));
				if (variants.length === 1) hadith = variants[0];
			}
			if (!hadith) {
				const sourceNumberCandidate = hadithsByNum.get(compact(payload.numbering_harf));
				const sourceBody = normalizeHadithForComparison(payload.matn);
				const localBody = normalizeHadithForComparison(sourceNumberCandidate?.body);
				if (sourceNumberCandidate && sourceBody && localBody && sourceBody === localBody) hadith = sourceNumberCandidate;
			}
		}
		if (!hadith) {
			unmatchedPayloads.push({ sourceId: Number(payload.id), reference });
			return [];
		}
		if (assignedHadithIds.has(Number(hadith.id))) throw new Error(`Local Ibn Hibban ${hadith.num} is claimed by multiple cached source entries.`);
		assignedHadithIds.add(Number(hadith.id));
		return [{ payload, hadith, path: sourcePath(payload) }];
	}).sort((left, right) => Number(left.hadith.ordinal) - Number(right.hadith.ordinal) || Number(left.hadith.id) - Number(right.hadith.id));
	const uncoveredHadiths = hadiths.filter(row => !assignedHadithIds.has(Number(row.id)));

	const nodes = [];
	const nodeByKey = new Map();
	const promotedSourceIds = new Map();
	for (const record of records) {
		const parentKey = `${Number(record.hadith.h1)}|${record.hadith.h2 === null ? '' : Number(record.hadith.h2)}`;
		if (!promotedSourceIds.has(parentKey))
			promotedSourceIds.set(parentKey, record.path.length === 3 && record.hadith.h3 === null ? record.path[2].id : null);
	}
	for (const record of records) {
		const h1 = Number(record.hadith.h1);
		const h2 = record.hadith.h2 === null ? null : Number(record.hadith.h2);
		const h1Key = `1|${h1}`;
		if (!nodeByKey.has(h1Key)) {
			const node = { key: h1Key, level: 1, h1, h2: null, h3: null, title: record.path[0].title, records: [] };
			nodeByKey.set(h1Key, node); nodes.push(node);
		}
		nodeByKey.get(h1Key).records.push(record);
		record.node = nodeByKey.get(h1Key);
		if (h2 !== null) {
			const h2Key = `2|${h1}|${h2}`;
			if (!nodeByKey.has(h2Key)) {
				const node = { key: h2Key, level: 2, h1, h2, h3: null, title: record.path[Math.min(1, record.path.length - 1)].title, records: [] };
				nodeByKey.set(h2Key, node); nodes.push(node);
			}
			nodeByKey.get(h2Key).records.push(record);
			record.node = nodeByKey.get(h2Key);
		}
		if (record.path.length === 3 && promotedSourceIds.get(`${h1}|${h2}`) !== record.path[2].id) {
			const parentKey = `${h1}|${h2}`;
			const sourceId = record.path[2].id;
			const h3Key = `3|${parentKey}|${sourceId}`;
			if (!nodeByKey.has(h3Key)) {
				const node = { key: h3Key, parentKey, level: 3, h1, h2, h3: null, sourceId, title: record.path[2].title, records: [] };
				nodeByKey.set(h3Key, node); nodes.push(node);
			}
			nodeByKey.get(h3Key).records.push(record);
			record.node = nodeByKey.get(h3Key);
		}
	}

	const h3Groups = new Map();
	for (const node of nodes.filter(node => node.level === 3)) {
		if (!h3Groups.has(node.parentKey)) h3Groups.set(node.parentKey, []);
		h3Groups.get(node.parentKey).push(node);
		const existingH3s = new Set(node.records.map(record => record.hadith.h3).filter(value => value !== null).map(Number));
		if (existingH3s.size > 1) throw new Error(`Source heading ${node.key} has conflicting existing subsection numbers.`);
		if (existingH3s.size === 1) node.h3 = [...existingH3s][0];
	}
	for (const group of h3Groups.values()) {
		for (let index = 0; index < group.length;) {
			if (group[index].h3 !== null) { index++; continue; }
			const start = index;
			while (index < group.length && group[index].h3 === null) index++;
			const previous = start > 0 ? Number(group[start - 1].h3) : 0;
			const next = index < group.length ? Number(group[index].h3) : null;
			const needed = index - start;
			if (next !== null && next - previous <= needed)
				throw new Error(`Existing Ibn Hibban subsection anchors leave no room for ${needed} cached headings.`);
			for (let offset = 0; offset < needed; offset++) group[start + offset].h3 = previous + offset + 1;
		}
	}

	return { records, nodes, metadataMismatches, uncoveredHadiths, unmatchedPayloads };
}

function logicalKey(row) {
	return [Number(row.level), Number(row.h1), row.h2 === null ? '' : Number(row.h2), row.h3 === null ? '' : Number(row.h3)].join('|');
}

async function applyIbnHibbanPlan(query, plan, existingToc) {
	const tocByKey = new Map();
	for (const row of existingToc) {
		const key = logicalKey(row);
		if (tocByKey.has(key)) throw new Error(`Duplicate Ibn Hibban TOC path ${key}.`);
		tocByKey.set(key, row);
	}
	const missingNodes = plan.nodes.filter(node => !tocByKey.has(logicalKey(node)));
	for (let offset = 0; offset < missingNodes.length; offset += 250) {
		const batch = missingNodes.slice(offset, offset + 250);
		await query(`INSERT INTO toc
			(ordinal,bookId,level,h1,h2,h3,title,start,end,start0,end0,count,lastmod) VALUES ?`, [batch.map(node => {
			const first = node.records[0].hadith;
			const last = node.records[node.records.length - 1].hadith;
			return [0, IBN_HIBBAN_BOOK_ID, node.level, node.h1, node.h2, node.h3, node.title,
				first.num, last.num, first.num0, last.num0, node.records.length, new Date()];
		})]);
	}
	if (missingNodes.length) {
		const refreshed = await query('SELECT id,ordinal,level,h1,h2,h3 FROM toc WHERE bookId=?', [IBN_HIBBAN_BOOK_ID]);
		for (const row of refreshed) tocByKey.set(logicalKey(row), row);
	}
	for (const node of plan.nodes) {
		const key = logicalKey(node);
		const toc = tocByKey.get(key);
		if (!toc) throw new Error(`Inserted Ibn Hibban TOC path ${key} could not be resolved.`);
		node.tocId = Number(toc.id);
	}

	await query('CREATE TEMPORARY TABLE toc_integrity_hadith_map (hadith_id INT PRIMARY KEY,toc_id INT NOT NULL,h3 DECIMAL(10,2) NULL)');
	for (let offset = 0; offset < plan.records.length; offset += 250) {
		const batch = plan.records.slice(offset, offset + 250);
		await query('INSERT INTO toc_integrity_hadith_map (hadith_id,toc_id,h3) VALUES ?', [batch.map(record => [
			Number(record.hadith.id), record.node.tocId, record.node.level === 3 ? record.node.h3 : null
		])]);
	}
	const remapResult = await query(`UPDATE hadiths h JOIN toc_integrity_hadith_map m ON m.hadith_id=h.id
		SET h.tocId=m.toc_id,h.h3=m.h3,h.lastmod=NOW()
		WHERE h.bookId=? AND (h.tocId<>m.toc_id OR NOT(h.h3<=>m.h3))`, [IBN_HIBBAN_BOOK_ID]);

	const orderedToc = await query(`SELECT id FROM toc WHERE bookId=?
		ORDER BY start0 IS NULL,start0,level,h1,COALESCE(h2,0),COALESCE(h3,0),id`, [IBN_HIBBAN_BOOK_ID]);
	const baseOrdinal = Math.min(...existingToc.map(row => Number(row.ordinal)));
	await query('CREATE TEMPORARY TABLE toc_integrity_ordinal_map (toc_id INT PRIMARY KEY,ordinal_value INT NOT NULL)');
	for (let offset = 0; offset < orderedToc.length; offset += 500) {
		const batch = orderedToc.slice(offset, offset + 500);
		await query('INSERT INTO toc_integrity_ordinal_map (toc_id,ordinal_value) VALUES ?', [batch.map((row, index) => [
			Number(row.id), baseOrdinal + offset + index
		])]);
	}
	await query(`UPDATE toc t JOIN toc_integrity_ordinal_map m ON m.toc_id=t.id SET t.ordinal=m.ordinal_value WHERE t.bookId=?`, [IBN_HIBBAN_BOOK_ID]);
	return { inserted: missingNodes.length, remapped: Number(remapResult.affectedRows), tocRows: orderedToc.length };
}

async function repairConfirmedLegacyRows(query) {
	const bukhari = await query('SELECT * FROM toc WHERE id=30574 AND bookId=1');
	if (bukhari.length !== 1 || Number(bukhari[0].level) !== 3 || ![null, 4].includes(bukhari[0].h3 === null ? null : Number(bukhari[0].h3)))
		throw new Error('The confirmed Bukhari TOC anomaly no longer matches the audited row.');
	if (bukhari[0].h3 === null) {
		await query('UPDATE toc SET ordinal=ordinal+1 WHERE bookId=1 AND ordinal>=4242');
		await query('UPDATE toc SET h3=4,ordinal=4242,lastmod=NOW() WHERE id=30574');
	}

	const malik = await query('SELECT * FROM toc WHERE id=115952 AND bookId=7');
	if (malik.length !== 1 || Number(malik[0].level) !== 2 || Number(malik[0].h1) !== 9 || ![3, 24].includes(Number(malik[0].h2)))
		throw new Error('The confirmed Malik TOC anomaly no longer matches the audited row.');
	if (Number(malik[0].h2) === 3) {
		await query('UPDATE toc SET ordinal=ordinal+1 WHERE bookId=7 AND ordinal>=15619');
		await query('UPDATE toc SET h2=24,ordinal=15619,lastmod=NOW() WHERE id=115952');
	}

	const malformedTabarani = await query('SELECT id,h1 FROM toc WHERE bookId=12 AND level=2 AND h2 IS NULL ORDER BY ordinal,id');
	for (const row of malformedTabarani) {
		const [maximum] = await query('SELECT COALESCE(MAX(h2),0) maximum FROM toc WHERE bookId=12 AND level=2 AND h1=?', [row.h1]);
		const h2 = Number(maximum.maximum) + 1;
		await query('UPDATE toc SET h2=?,lastmod=NOW() WHERE id=?', [h2, Number(row.id)]);
	}

	const synchronized = await query(`UPDATE hadiths h JOIN toc t ON t.id=h.tocId AND t.bookId=h.bookId
		SET h.h1=t.h1,h.h2=IF(t.level>=2,t.h2,NULL),h.h3=IF(t.level=3,t.h3,NULL),h.lastmod=NOW()
		WHERE NOT(h.h1<=>t.h1) OR NOT(h.h2<=>(IF(t.level>=2,t.h2,NULL))) OR NOT(h.h3<=>(IF(t.level=3,t.h3,NULL)))`);
	return { tabaraniFallbacks: malformedTabarani.length, synchronizedHadiths: Number(synchronized.affectedRows) };
}

async function verify(query, plan) {
	const [book] = await query('SELECT COUNT(*) hadiths FROM hadiths WHERE bookId=?', [IBN_HIBBAN_BOOK_ID]);
	if (Number(book.hadiths) !== 7539) throw new Error(`Ibn Hibban hadith count changed to ${book.hadiths}.`);
	const [badReferences] = await query(`SELECT COUNT(*) n FROM hadiths h LEFT JOIN toc t ON t.id=h.tocId AND t.bookId=h.bookId
		WHERE h.bookId=? AND t.id IS NULL`, [IBN_HIBBAN_BOOK_ID]);
	const [pathMismatches] = await query(`SELECT COUNT(*) n FROM hadiths h JOIN toc t ON t.id=h.tocId
		WHERE h.bookId=? AND (NOT(h.h1<=>t.h1) OR (t.level>=2 AND NOT(h.h2<=>t.h2)) OR (t.level=3 AND NOT(h.h3<=>t.h3)))`, [IBN_HIBBAN_BOOK_ID]);
	const [duplicates] = await query(`SELECT COUNT(*) n FROM (SELECT level,h1,h2,h3 FROM toc WHERE bookId=?
		GROUP BY level,h1,h2,h3 HAVING COUNT(*)>1) duplicates`, [IBN_HIBBAN_BOOK_ID]);
	const [missingParents] = await query(`SELECT COUNT(*) n FROM toc t
		LEFT JOIN toc p1 ON p1.bookId=t.bookId AND p1.level=1 AND p1.h1=t.h1 AND p1.h2 IS NULL
		LEFT JOIN toc p2 ON p2.bookId=t.bookId AND p2.level=2 AND p2.h1=t.h1 AND p2.h2=t.h2 AND p2.h3 IS NULL
		WHERE t.bookId=? AND ((t.level>=2 AND p1.id IS NULL) OR (t.level=3 AND p2.id IS NULL))`, [IBN_HIBBAN_BOOK_ID]);
	if (Number(badReferences.n) || Number(pathMismatches.n) || Number(duplicates.n) || Number(missingParents.n))
		throw new Error(`Post-repair integrity failed: badRefs=${badReferences.n}, pathMismatches=${pathMismatches.n}, duplicates=${duplicates.n}, missingParents=${missingParents.n}.`);
	const [sourceCoverage] = await query('SELECT COUNT(DISTINCT tocId) headings FROM hadiths WHERE bookId=? AND id IN (?)',
		[IBN_HIBBAN_BOOK_ID, plan.records.map(record => Number(record.hadith.id))]);
	return { badReferences: 0, pathMismatches: 0, duplicates: 0, missingParents: 0, sourceHeadings: plan.nodes.length,
		attachedSourceHeadings: Number(sourceCoverage.headings) };
}

async function main() {
	const apply = process.argv.includes('--apply');
	const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb', 'settings.json'), 'utf8')).mysql.connection;
	const connection = mysql.createConnection(settings);
	const query = util.promisify(connection.query).bind(connection);
	try {
		const payloads = readCachedPayloads();
		const [hadiths, metadata, toc] = await Promise.all([
			query('SELECT id,ordinal,tocId,h1,h2,h3,num,num0,body FROM hadiths WHERE bookId=? ORDER BY ordinal,id', [IBN_HIBBAN_BOOK_ID]),
			query("SELECT source_entry_id,source_edition_reference,hadith_id FROM hdith_hadith_metadata WHERE source_book_slug='b-10'"),
			query('SELECT id,ordinal,level,h1,h2,h3 FROM toc WHERE bookId=? ORDER BY ordinal,id', [IBN_HIBBAN_BOOK_ID])
		]);
		const plan = buildIbnHibbanPlan(payloads, hadiths, metadata);
		const logical = new Set(toc.map(logicalKey));
		const missing = plan.nodes.filter(node => !logical.has(logicalKey(node)));
		console.log(`Ibn Hibban cache: ${payloads.length} exact records covering ${plan.records.length} local hadiths, ${plan.nodes.length} source headings, ${missing.length} missing headings, ${plan.metadataMismatches} stale metadata mappings ignored.`);
		console.log(`Preserving ${plan.uncoveredHadiths.length} local supplementary hadiths that have no canonical cached source entry.`);
		console.log(`Skipping ${plan.unmatchedPayloads.length} canonical cached entries absent from the local edition: ${plan.unmatchedPayloads.map(row => row.reference).join(', ') || 'none'}.`);
		if (!apply) return console.log('Dry run complete; no database rows were changed.');
		await query('START TRANSACTION');
		const legacy = await repairConfirmedLegacyRows(query);
		const repaired = await applyIbnHibbanPlan(query, plan, toc);
		const verification = await verify(query, plan);
		await query('COMMIT');
		console.log(`Applied: ${repaired.inserted} Ibn Hibban headings inserted, ${repaired.remapped} hadiths remapped, ${repaired.tocRows} TOC rows total.`);
		console.log(`Verified: ${JSON.stringify(verification)}. Legacy repair: ${JSON.stringify(legacy)}.`);
	} catch (error) {
		if (apply) await query('ROLLBACK').catch(() => {});
		throw error;
	} finally { connection.end(); }
}

if (require.main === module) main().catch(error => { console.error(`ERROR: ${error.stack || error.message}`); process.exitCode = 1; });

module.exports = { buildIbnHibbanPlan, logicalKey, payloadReference, sourcePath };
