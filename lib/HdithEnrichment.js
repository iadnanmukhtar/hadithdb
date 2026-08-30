/* jslint node:true, esversion:11 */
'use strict';

const Books = require('./Books');
const HdithImporter = require('../bin/utils/import-hdith-six-books-enrichment');

const MIN_AUTO_MATCH_SIMILARITY = 0.9;

class HdithUrlRequiredError extends Error {
	constructor(message, details = {}) {
		super(message);
		this.name = 'HdithUrlRequiredError';
		this.statusCode = 409;
		this.needsHdithUrl = true;
		this.expectedHdithBookId = details.expectedHdithBookId || null;
		this.expectedHdithBookTitle = details.expectedHdithBookTitle || null;
	}
}

function parseHdithDetailUrl(value) {
	let url;
	try {
		url = new URL(String(value || '').trim());
	} catch (_err) {
		throw invalidUrlError();
	}
	if (url.protocol !== 'https:' || url.hostname !== 'hdith.com')
		throw invalidUrlError();
	const match = url.pathname.match(/^\/encyclopedia\/book\/b-(\d+)\/h\/(\d+)\/?$/);
	if (!match)
		throw invalidUrlError();
	return {
		sourceBookId: Number(match[1]),
		sourceEntryId: Number(match[2]),
		sourceUrl: `https://hdith.com/encyclopedia/book/b-${Number(match[1])}/h/${Number(match[2])}`
	};
}

function invalidUrlError() {
	const err = new Error('Enter a full hdith.com hadith detail URL, such as https://hdith.com/encyclopedia/book/b-1/h/187.');
	err.statusCode = 400;
	return err;
}

async function enrichHadithById(hadithId, options = {}) {
	const id = Number(hadithId);
	if (!Number.isInteger(id) || id < 1) {
		const err = new Error('Invalid hadith id.');
		err.statusCode = 400;
		throw err;
	}
	await Books.ensureHdithBookIdColumn();
	const rows = await global.query(`SELECT h.id, h.num, h.bookId,
		b.alias, b.hdith_book_id, m.source_book_title, m.reference_mode
		FROM hadiths h
		JOIN books b ON b.id=h.bookId
		LEFT JOIN hdith_book_mappings m ON m.source_book_id=b.hdith_book_id
		WHERE h.id=${id} LIMIT 1`);
	const hadith = rows[0];
	if (!hadith) {
		const err = new Error('Hadith not found.');
		err.statusCode = 404;
		throw err;
	}
	if (!Number(hadith.hdith_book_id)) {
		const err = new Error('This book does not yet have an hdith.com collection mapping. Add its hdith.com book number before revising this hadith.');
		err.statusCode = 422;
		throw err;
	}

	let source;
	let similarity = 1;
	let matchMethod = 'provided-url';
	if (options.hdithUrl) {
		source = parseHdithDetailUrl(options.hdithUrl);
		if (source.sourceBookId !== Number(hadith.hdith_book_id)) {
			const err = new Error(`That URL belongs to hdith.com book b-${source.sourceBookId}; this hadith is mapped to b-${hadith.hdith_book_id}.`);
			err.statusCode = 400;
			throw err;
		}
	} else {
		const metadata = await global.query(`SELECT source_entry_id
			FROM hdith_hadith_metadata
			WHERE hadith_id=${id} AND source_book_slug='b-${Number(hadith.hdith_book_id)}'
			LIMIT 1`);
		if (metadata[0]) {
			source = { sourceBookId: Number(hadith.hdith_book_id), sourceEntryId: Number(metadata[0].source_entry_id) };
			matchMethod = 'existing-metadata';
		} else {
			const crosswalk = await global.query(`SELECT source_entry_id, similarity
				FROM hdith_book_reference_crosswalk
				WHERE source_book_id=${Number(hadith.hdith_book_id)} AND local_hadith_id=${id}
				ORDER BY similarity DESC, source_entry_id LIMIT 1`);
			if (crosswalk[0]) {
				similarity = Number(crosswalk[0].similarity);
				if (Number.isFinite(similarity) && similarity >= MIN_AUTO_MATCH_SIMILARITY) {
					source = { sourceBookId: Number(hadith.hdith_book_id), sourceEntryId: Number(crosswalk[0].source_entry_id) };
					matchMethod = 'high-confidence-crosswalk';
				}
			}
		}
	}

	if (!source)
		throw new HdithUrlRequiredError(
			`The hdith.com match for ${hadith.alias}:${hadith.num} is not confident enough. Provide its hdith.com detail URL.`,
			{ expectedHdithBookId: Number(hadith.hdith_book_id), expectedHdithBookTitle: hadith.source_book_title }
		);

	const enriched = await (options.importer || HdithImporter.enrichSingleHadith)({
		sourceBookId: source.sourceBookId,
		sourceEntryId: source.sourceEntryId,
		localHadithId: id,
		localReference: hadith.num,
		similarity: Number.isFinite(similarity) ? similarity : 1
	});
	return { ...enriched, matchMethod };
}

module.exports = {
	HdithUrlRequiredError,
	MIN_AUTO_MATCH_SIMILARITY,
	enrichHadithById,
	parseHdithDetailUrl
};
