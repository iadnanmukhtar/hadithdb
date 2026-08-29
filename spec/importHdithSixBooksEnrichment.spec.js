'use strict';

const fs = require('fs');
const path = require('path');
const {
	CACHE_DIR,
	SIX_BOOKS,
	compressCachedRecord,
	firstHadithId,
	hadithTextSimilarity,
	ignoresExternalGrades,
	loadRecord,
	normalizeArabicForMatch,
	normalizeHadithForComparison,
	parseGraderOpinions,
	parseHadithPayload,
	parseLinks,
	parseNarrators,
	referencesEquivalent,
	schemaStatements,
	sharhToMarkdown
} = require('../bin/utils/import-hdith-six-books-enrichment');

describe('hdith.com six-book enrichment importer', () => {
	test('stores downloaded payloads under /tmp', () => {
		expect(CACHE_DIR).toBe('/tmp/hadithdb-hdith-six-books-enrichment');
	});

	test('compresses completed payloads and reads them back from gzip', async () => {
		const sourceSlug = `jest-gzip-${process.pid}`;
		const cacheDirectory = path.join(CACHE_DIR, sourceSlug);
		const cacheFile = path.join(cacheDirectory, '123.json');
		fs.mkdirSync(cacheDirectory, { recursive: true });
		fs.writeFileSync(cacheFile, JSON.stringify({
			id: 123, numbering_harf: '1', chapter_path: [{ id: 2 }], next_id: 124,
			_verification_url: null
		}));
		try {
			compressCachedRecord({ sourceSlug }, 123);
			expect(fs.existsSync(cacheFile)).toBe(false);
			expect(fs.existsSync(`${cacheFile}.gz`)).toBe(true);
			expect(await loadRecord(null, { sourceSlug }, 123)).toEqual(expect.objectContaining({ sourceId: 123, num: '1' }));
		} finally {
			fs.rmSync(cacheDirectory, { recursive: true, force: true });
		}
	});

	test('keeps the canonical six-book order', () => {
		expect(SIX_BOOKS.map(book => book.alias)).toEqual(['bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah']);
	});

	test('parses stable narrator identities and chain metadata', () => {
		const narrators = parseNarrators({ isnad: [{ slug: 'p-1', name: 'راو', fullname: 'الراوي الكامل', flags: ['التدليس'], formula: 'حدثنا' }] });
		expect(narrators).toEqual([expect.objectContaining({ ordinal: 1, sourceSlug: 'p-1', name: 'راو', formula: 'حدثنا', flags: ['التدليس'] })]);
	});

	test('parses takhrij and shawahid as internally resolvable link records', () => {
		const links = parseLinks({
			takhrij: { sources: [{ book_id: 2, occurrences: [{ entry_id: 22, hadith_num: '10', similarity: 'بمثله' }] }] },
			shawahid: { groups: [{ narrator: 'صحابي', books: [{ entries: [{ book_id: 3, entry_id: 33, number: '20 ' }] }] }] }
		});
		expect(links).toEqual([
			expect.objectContaining({ type: 'takhrij', sourceEntryId: 22, internalRef: 'muslim:10' }),
			expect.objectContaining({ type: 'shahid', sourceEntryId: 33, internalRef: 'abudawud:20' })
		]);
	});

	test('parses attribution, subjects, and sharh availability', () => {
		const record = parseHadithPayload({
			id: 5, numbering_harf: '1', chapter_path: [{ id: 2 }], next_id: 6, attribution: 'مرفوع',
			subjects: [{ slug: 's-1', title: 'النية' }], services: [{ type_id: 6, items: [{ entry_id: 7 }] }]
		});
		expect(record).toEqual(expect.objectContaining({ sourceId: 5, num: '1', chapterId: 2, attribution: 'مرفوع' }));
		expect(record.subjects).toEqual([{ slug: 's-1', title: 'النية' }]);
		expect(record.sharhPreview).toHaveLength(1);
	});

	test('finds the first detail id and defines searchable sharh storage', () => {
		expect(firstHadithId({ hadiths: [{ id: 12 }] }, 'b-1')).toBe(12);
		expect(schemaStatements().join('\n')).toContain('FULLTEXT KEY hdith_sharh_text');
		expect(schemaStatements().join('\n')).toContain("format VARCHAR(8) NOT NULL DEFAULT 'md'");
		expect(schemaStatements().join('\n')).toContain('source_reference VARCHAR(45) NULL');
	});

	test('converts sharh HTML to normalized Markdown', () => {
		expect(sharhToMarkdown('<h2>عنوان</h2><p>شرح <strong>مهم</strong>.</p><ul><li>فائدة</li></ul>'))
			.toBe('## عنوان\n\nشرح **مهم**.\n\n- فائدة');
		expect(sharhToMarkdown('فقرة أولى\n\nفقرة ثانية')).toBe('فقرة أولى\n\nفقرة ثانية');
	});

	test('matches verification grades only by the six-book source and reference number', () => {
		const opinions = parseGraderOpinions([
			{ slug: 'one', hadith: 'نص مختلف لا يستخدم للمطابقة', muhaddith: 'الألباني', degree: 'حسن صحيح', source: 'صحيح سنن الترمذي', book_page: '3632' },
			{ slug: 'two', hadith: 'النص نفسه', muhaddith: 'محدث آخر', degree: 'صحيح', source: 'جامع الترمذي', book_page: '٣٦٣٢' },
			{ slug: 'wrong-ref', hadith: 'النص نفسه', muhaddith: 'الحاكم', degree: 'ضعيف', source: 'جامع الترمذي', book_page: '3633' },
			{ slug: 'wrong-book', hadith: 'النص نفسه', muhaddith: 'مسلم', degree: 'صحيح', source: 'صحيح مسلم', book_page: '3632' }
		], 'b-4', '3632');
		expect(opinions.map(opinion => opinion.grader)).toEqual(['الألباني', 'محدث آخر']);
		expect(opinions[0]).toEqual(expect.objectContaining({ grade: 'حسن صحيح', sourceUrl: 'https://hdith.com/h/one' }));
		expect(normalizeArabicForMatch('<mark>أوَّلُ</mark>')).toBe('اول');
	});

	test('renders all indexed grader opinions on a hadith item', () => {
		const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_item.ejs'), 'utf8');
		expect(template).toContain('hadith-grader-opinions');
		expect(template).toContain('graderOpinions.forEach');
		expect(template).toContain('opinion.source_url');
	});

	test('allows Muslim suffix differences but preserves suffixes for other books', () => {
		expect(referencesEquivalent('b-2', '8a', '8')).toBe(true);
		expect(referencesEquivalent('b-2', '8a', '8c')).toBe(true);
		expect(referencesEquivalent('b-2', '8a', '9')).toBe(false);
		expect(referencesEquivalent('b-1', '8a', '8')).toBe(false);
		expect(referencesEquivalent('b-1', '8a', '8a')).toBe(true);
	});

	test('normalizes punctuation and honorifics before confirming ordered Muslim matches', () => {
		const source = normalizeHadithForComparison('قال رسولُ اللهِ صلَّى اللهُ عليه وسلَّم: «إنَّما الأعمالُ بالنِّيَّاتِ!»');
		const local = normalizeHadithForComparison('قال رسول الله ﷺ إنما الأعمال بالنيات');
		expect(source).toBe(local);
		expect(hadithTextSimilarity(source, local)).toBe(1);
		expect(hadithTextSimilarity(source, normalizeHadithForComparison('حديث مختلف تمامًا'))).toBeLessThan(0.70);
	});

	test('ignores external grader opinions for the two Sahih collections', () => {
		expect(ignoresExternalGrades({ sourceSlug: 'b-1' })).toBe(true);
		expect(ignoresExternalGrades({ sourceSlug: 'b-2' })).toBe(true);
		expect(ignoresExternalGrades({ sourceSlug: 'b-3' })).toBe(false);
	});
});
