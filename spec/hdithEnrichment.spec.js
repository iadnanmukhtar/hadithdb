'use strict';

const {
	MIN_AUTO_MATCH_SIMILARITY,
	enrichHadithById,
	parseHdithDetailUrl
} = require('../lib/HdithEnrichment');

describe('on-demand hdith.com enrichment', () => {
	const originalQuery = global.query;
	const originalPool = global.dbPool;

	afterAll(() => {
		global.query = originalQuery;
		global.dbPool = originalPool;
	});

	test('accepts only canonical hdith.com detail URLs', () => {
		expect(parseHdithDetailUrl('https://hdith.com/encyclopedia/book/b-1/h/187?x=1')).toEqual({
			sourceBookId: 1, sourceEntryId: 187,
			sourceUrl: 'https://hdith.com/encyclopedia/book/b-1/h/187'
		});
		expect(() => parseHdithDetailUrl('https://example.com/encyclopedia/book/b-1/h/187')).toThrow(/full hdith.com hadith detail URL/);
		expect(() => parseHdithDetailUrl('https://hdith.com/h/ZxVZrwHORb')).toThrow(/full hdith.com hadith detail URL/);
	});

	test('uses a high-confidence crosswalk without asking for a URL', async () => {
		const importer = jest.fn().mockResolvedValue({ sourceUrl: 'https://hdith.com/encyclopedia/book/b-1/h/187' });
		global.query = jest.fn(async sql => {
			if (sql.includes("SHOW COLUMNS")) return [{ Field: 'hdith_book_id' }];
			if (sql.includes("SHOW INDEX")) return [{ Key_name: 'books_hdith_book_id' }];
			if (sql.includes("SHOW TABLES")) return [{ table: 'hdith_book_mappings' }];
			if (sql.includes('SELECT h.id')) return [{ id: 100, num: '100', bookId: 1, alias: 'bukhari', hdith_book_id: 1, source_book_title: 'صحيح البخاري' }];
			if (sql.includes('FROM hdith_hadith_metadata')) return [];
			if (sql.includes('FROM hdith_book_reference_crosswalk')) return [{ source_entry_id: 187, similarity: MIN_AUTO_MATCH_SIMILARITY }];
			return [];
		});
		const result = await enrichHadithById(100, { importer });
		expect(result.matchMethod).toBe('high-confidence-crosswalk');
		expect(importer).toHaveBeenCalledWith(expect.objectContaining({ sourceBookId: 1, sourceEntryId: 187, localHadithId: 100 }));
	});

	test('asks for the detail URL when crosswalk confidence is low', async () => {
		global.query = jest.fn(async sql => {
			if (sql.includes('SELECT h.id')) return [{ id: 100, num: '100', bookId: 1, alias: 'bukhari', hdith_book_id: 1, source_book_title: 'صحيح البخاري' }];
			if (sql.includes('FROM hdith_hadith_metadata')) return [];
			if (sql.includes('FROM hdith_book_reference_crosswalk')) return [{ source_entry_id: 187, similarity: MIN_AUTO_MATCH_SIMILARITY - 0.01 }];
			return [];
		});
		await expect(enrichHadithById(100, { importer: jest.fn() })).rejects.toMatchObject({
			statusCode: 409, needsHdithUrl: true, expectedHdithBookId: 1
		});
	});

	test('treats an admin-supplied same-book URL as authoritative', async () => {
		const importer = jest.fn().mockResolvedValue({ sourceUrl: 'https://hdith.com/encyclopedia/book/b-1/h/999' });
		global.query = jest.fn(async sql => sql.includes('SELECT h.id')
			? [{ id: 100, num: '100', bookId: 1, alias: 'bukhari', hdith_book_id: 1 }]
			: []);
		const result = await enrichHadithById(100, {
			hdithUrl: 'https://hdith.com/encyclopedia/book/b-1/h/999', importer
		});
		expect(result.matchMethod).toBe('provided-url');
		expect(importer).toHaveBeenCalledWith(expect.objectContaining({ sourceEntryId: 999 }));
		await expect(enrichHadithById(100, {
			hdithUrl: 'https://hdith.com/encyclopedia/book/b-2/h/999', importer
		})).rejects.toThrow(/belongs to hdith.com book b-2/);
	});

	test('the Revise UI prompts and resubmits with the supplied URL', () => {
		const template = require('fs').readFileSync(require('path').join(__dirname, '..', 'views', 'sub-views', 'scripts.ejs'), 'utf8');
		expect(template).toContain("resBody.needsHdithUrl");
		expect(template).toContain('window.prompt');
		expect(template).toContain('reqBody.hdithUrl = hdithUrl.trim()');
		expect(template).toContain('hdithUrl: reqBody.hdithUrl');
		expect(template).toContain("suppressHdithUrlPromptError: propStr === 'hadith.revise'");
		expect(template).toContain('options.suppressHdithUrlPromptError && resBody.needsHdithUrl');
	});
});
