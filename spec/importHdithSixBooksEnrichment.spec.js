'use strict';

const fs = require('fs');
const path = require('path');
const {
	CACHE_DIR,
	HDITH_GRADE_COLORS,
	dedupeSharhItems,
	HDITH_LOCAL_BOOKS,
	MIN_REQUEST_DELAY_MS,
	SIX_BOOKS,
	compressCachedRecord,
	createOrderedTextMatcher,
	fetchProps,
	firstHadithId,
	hadithPrefixSimilarity,
	hadithTextSimilarity,
	ignoresExternalGrades,
	isSourceNotFoundError,
	localHadithOrderClause,
	loadRecord,
	normalizeArabicForMatch,
	normalizeHadithForComparison,
	parseCollectionGrades,
	parseEditionReference,
	parseGharib,
	parseGraderOpinions,
	parseHadithPayload,
	parseLinks,
	parseNarrators,
	parsePageNarrator,
	parsePrimaryNarrator,
	parseSourceIsnadHtml,
	preferredColoredGradeOpinion,
	legacyGradeForOpinion,
	preferredLegacyOpinion,
	proposedBodyFootnoteSplit,
	proposedChainBodySplit,
	readOptions,
	referenceBase,
	referencesEquivalent,
	resolveLinkTarget,
	schemaStatements,
	sharhToMarkdown
} = require('../bin/utils/import-hdith-six-books-enrichment');

describe('hdith.com six-book enrichment importer', () => {
	test('stores downloaded payloads under /tmp', () => {
		expect(CACHE_DIR).toBe('/tmp/hadithdb-hdith-six-books-enrichment');
	});

	test('allows the supervised importer to use a 100 ms request delay', () => {
		expect(MIN_REQUEST_DELAY_MS).toBe(100);
		expect(readOptions(['--apply', '--skip-schema', '--delay', '100', '--book', 'b-2'])).toEqual(expect.objectContaining({
			apply: true, skipSchema: true, delay: 100, books: ['b-2']
		}));
	});

	test('preserves hdith.com grading category colors', () => {
		const opinions = parseGraderOpinions([{ slug: 'grade-1', muhaddith: 'الألباني', degree: 'صحيح',
			degree_category_id: 1, source: 'صحيح الترمذي', book_page: '147' }], 'b-4', '147');
		expect(opinions[0]).toEqual(expect.objectContaining({ gradeCategoryId: 1, gradeColor: HDITH_GRADE_COLORS[1] }));
	});

	test('prefers Arnaut over Albani when filling a missing legacy grade', () => {
		const opinion = preferredLegacyOpinion([
			{ grader: 'الشيخ الألباني', grade: 'حسن' },
			{ grader: 'شعيب الأرنؤوط', grade: 'إسناده صحيح' }
		]);
		expect(opinion).toEqual(expect.objectContaining({ grader: 'شعيب الأرنؤوط', grade: 'إسناده صحيح' }));
		expect(legacyGradeForOpinion(opinion, [
			{ id: 100, grade: 'صحيح' }, { id: 101, grade: 'إسناده صحيح' }
		])).toEqual({ id: 101, grade: 'إسناده صحيح' });
	});

	test('selects the shortest ruling from the worst colored category', () => {
		const opinion = preferredColoredGradeOpinion([
			{ ordinal: 1, grader: 'الدارقطني', grade: 'لا يصح وقد روي موقوفا', grade_category_id: 3 },
			{ ordinal: 2, grader: 'يحيى بن معين', grade: 'منكر', grade_category_id: 3 },
			{ ordinal: 3, grader: 'البيهقي', grade: 'صحيح', grade_category_id: 1 },
			{ ordinal: 4, grader: 'محدث', grade: 'شبه موضوع', grade_category_id: 4 }
		]);
		expect(opinion).toEqual(expect.objectContaining({ grade: 'شبه موضوع', grade_category_id: 4 }));
		expect(preferredColoredGradeOpinion([
			{ grade: 'ضعيفة لا تصح', grade_category_id: 3 },
			{ grade: 'منكر', grade_category_id: 3 }
		])).toEqual(expect.objectContaining({ grade: 'منكر' }));
	});

	test('distinguishes hdith sequence numbers from canonical edition references', () => {
		expect(parseEditionReference([{ value: '99 (م)' }])).toEqual({ value: '99 (م)', repeated: true });
		expect(parseEditionReference([{ value: '100' }])).toEqual({ value: '100', repeated: false });
		expect(parseEditionReference([{ value: '١ / ١' }])).toEqual({ value: '١ / ١', repeated: false });
		expect(referenceBase('١ / ١')).toBe('1');
		expect(referenceBase('402b')).toBe('402');
	});

	test('uses the Muassasat al-Risalah numbering for Musnad Ahmad', () => {
		const numberings = [
			{ key: 'طبعة ١ — جمعية المكنز الإسلامي', value: '20598' },
			{ key: 'طبعة ٢ — مؤسسة الرسالة', value: '20274' }
		];
		expect(parseEditionReference(numberings, 'b-8')).toEqual({ value: '20274', repeated: false });
		expect(parseEditionReference(numberings, 'b-24')).toEqual({ value: '20598', repeated: false });
		expect(parseHadithPayload({
			id: 171670, book: { slug: 'b-8' }, chapter_path: [{ id: 171133 }], numberings
		}, { sourceSlug: 'b-8' })).toEqual(expect.objectContaining({ editionReference: '20274' }));
	});

	test('skips a repeated Bukhari source record and matches the canonical edition record by text', () => {
		const matcher = createOrderedTextMatcher([
			{ id: 99, num: '99', body: 'من أسعد الناس بشفاعتك يوم القيامة' },
			{ id: 100, num: '100', body: 'إن الله لا يقبض العلم انتزاعا ولكن يقبض العلم بقبض العلماء' },
			{ id: 101, num: '101', body: 'قالت النساء للنبي غلبنا عليك الرجال فاجعل لنا يوما' }
		]);
		expect(matcher.match({ editionReference: '99 (م)', editionReferenceRepeated: true,
			comparisonText: 'حدثنا عبد العزيز بن مسلم عن عبد الله بن دينار بذلك' })).toBeNull();
		expect(matcher.match({ editionReference: '100', editionReferenceRepeated: false,
			comparisonText: 'إن الله لا يقبض العلم انتزاعا ولكن يقبض العلم بقبض العلماء' }))
			.toEqual(expect.objectContaining({ id: 100, num: '100', score: 1 }));
		expect(matcher.lastMatch()).toEqual(expect.objectContaining({ id: 100, num: '100' }));
		expect(matcher.match({ editionReference: '101', editionReferenceRepeated: false,
			comparisonText: 'قالت النساء للنبي غلبنا عليك الرجال فاجعل لنا يوما' }))
			.toEqual(expect.objectContaining({ id: 101, num: '101', score: 1 }));
	});

	test('uses matn confirmation only for an exact edition-reference candidate', () => {
		const sharedMatn = 'إنما الأعمال بالنيات وإنما لكل امرئ ما نوى';
		const differingSourceChain = 'حدثنا طريق طويل إضافي لا يوجد في النسخة المحلية';
		const matcher = createOrderedTextMatcher([
			{ id: 1, num: '1', chain: 'حدثنا مالك عن نافع', body: sharedMatn },
			{ id: 2, num: '2', chain: 'حدثنا شعبة عن قتادة', body: sharedMatn }
		]);
		const exactReference = matcher.match({
			editionReference: '1', editionReferenceRepeated: false,
			comparisonText: `${differingSourceChain} ${sharedMatn}`,
			bodyStart: normalizeHadithForComparison(sharedMatn)
		});
		expect(exactReference).toEqual(expect.objectContaining({ id: 1, score: 1 }));

		const broadWindowMatcher = createOrderedTextMatcher([
			{ id: 2, num: '2', chain: 'حدثنا شعبة عن قتادة', body: sharedMatn }
		]);
		expect(broadWindowMatcher.match({
			editionReference: '1', editionReferenceRepeated: false,
			comparisonText: `${differingSourceChain} ${sharedMatn}`,
			bodyStart: normalizeHadithForComparison(sharedMatn)
		})).toBeNull();
	});

	test('can prefer the earliest strict ordered match over a later duplicate reference', () => {
		const text = 'حدثنا محمد بن يحيى حدثنا عبد الصمد عن شعبة أن ابن عمر كان يصلي ركعتين';
		const matcher = createOrderedTextMatcher([
			{ id: 721, num: '721', body: text },
			{ id: 816, num: '816', body: text },
			{ id: 817, num: '817', body: 'حدثنا أحمد عن مالك أن رسول الله صلى الله عليه وسلم قال الدين النصيحة' }
		], 0, { preferEarliestOrderedMatch: true, windowSize: 180 });
		expect(matcher.match({
			editionReference: '816', editionReferenceRepeated: false, comparisonText: text
		})).toEqual(expect.objectContaining({ id: 721, score: 1 }));
	});

	test('allows a collection-specific ordered similarity threshold for edition wording differences', () => {
		const rows = [{ id: 8703, num: '8703', body: 'حدثنا محمد عن الزهري قال تمد الأرض يوم القيامة حقا' }];
		const source = {
			editionReference: '8801', editionReferenceRepeated: false,
			comparisonText: 'حدثنا أحمد عن الزهري قال تبسط الأرض يوم القيامة حقا'
		};
		expect(createOrderedTextMatcher(rows).match(source)).toBeNull();
		expect(createOrderedTextMatcher(rows, 0, { minimumScore: 0.80, windowSize: 180 }).match(source))
			.toEqual(expect.objectContaining({ id: 8703, num: '8703' }));
	});

	test('keeps an existing source mapping fixed while replaying an enrichment book', () => {
		const rows = [
			{ id: 10, num: '10', body: 'الحديث الأول' },
			{ id: 11, num: '11', body: 'الحديث الثاني' }
		];
		const matcher = createOrderedTextMatcher(rows, 0, {
			existingMatches: new Map([[51001, 1]]), minimumScore: 0.80
		});
		expect(matcher.match({
			sourceId: 51001, editionReference: '10', editionReferenceRepeated: false,
			comparisonText: 'نص مختلف كان يمكن أن يختار صفا آخر'
		})).toEqual(expect.objectContaining({ id: 11, num: '11', index: 1 }));
		expect(matcher.lastMatch()).toEqual(expect.objectContaining({ id: 11 }));
		const passedMapping = createOrderedTextMatcher(rows, 1, {
			existingMatches: new Map([[51000, 0]]), minimumScore: 0.80
		});
		expect(passedMapping.match({
			sourceId: 51000, editionReference: '11', editionReferenceRepeated: false,
			comparisonText: 'الحديث الثاني'
		})).toBeNull();
	});

	test('orders Ibn Khuzaymah by numeric reference because its local ordinals interleave numbering blocks', () => {
		expect(localHadithOrderClause({ sourceSlug: 'b-11' })).toBe('CAST(num AS UNSIGNED), num, id');
		expect(localHadithOrderClause({ sourceSlug: 'b-19' })).toBe('CAST(num AS UNSIGNED), num, id');
		expect(localHadithOrderClause({ sourceSlug: 'b-18' })).toBe('ordinal, id');
	});

	test('recognizes a missing hdith source entry so the importer can continue with the next chapter', () => {
		expect(isSourceNotFoundError(new Error('https://hdith.com/h/20614: HTTP 404'))).toBe(true);
		expect(isSourceNotFoundError(new Error('https://hdith.com/h/20614: HTTP 500'))).toBe(false);
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

	test('reads cached page props without navigating or applying a request delay', async () => {
		const cacheFile = path.join(CACHE_DIR, `jest-props-${process.pid}.json.gz`);
		fs.writeFileSync(cacheFile, require('zlib').gzipSync(JSON.stringify({ cached: true })));
		const page = { url: jest.fn(() => { throw new Error('cache hit must not access the browser'); }) };
		await expect(fetchProps(page, '/never-requested', cacheFile)).resolves.toEqual({ cached: true });
		expect(page.url).not.toHaveBeenCalled();
		fs.unlinkSync(cacheFile);
	});

	test('keeps the canonical six-book order', () => {
		expect(SIX_BOOKS.map(book => book.alias)).toEqual(['bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah']);
	});

	test('maps hdith.com collections to local database books', () => {
		expect(HDITH_LOCAL_BOOKS[8]).toEqual(expect.objectContaining({ bookId: 8, alias: 'ahmad', referenceMode: 'exact' }));
		expect(HDITH_LOCAL_BOOKS[10]).toEqual(expect.objectContaining({ bookId: 11, alias: 'ibnhibban', referenceMode: 'exact' }));
		expect(HDITH_LOCAL_BOOKS[15]).toEqual(expect.objectContaining({ bookId: 31, alias: 'ibnabishaybah', referenceMode: 'exact' }));
		expect(HDITH_LOCAL_BOOKS[7]).toEqual(expect.objectContaining({ bookId: 7, alias: 'malik', referenceMode: 'crosswalk' }));
	});

	test('parses stable narrator identities and chain metadata', () => {
		const narrators = parseNarrators({ isnad: [{ slug: 'p-1', name: 'راو', fullname: 'الراوي الكامل', flags: ['التدليس'], formula: 'حدثنا' }] });
		expect(narrators).toEqual([expect.objectContaining({ ordinal: 1, sourceSlug: 'p-1', name: 'راو', formula: 'حدثنا', flags: ['التدليس'] })]);
	});

	test('imports the primary narrator and borrows tashkil only from an exact source-isnad match', () => {
		const hadith = {
			narrator: 'عثمان بن عفان',
			isnad: [{ slug: 'p-4307', name: 'عثمان بن عفان' }],
			isnad_html: '<span class="hp-rawi" data-rawi-slug="p-1">أَحْمَدُ</span><span class="hp-rawi" data-rawi-slug="p-4307">عُثْمَانُ بْنُ عَفَّانَ :</span>'
		};
		expect(parsePrimaryNarrator(hadith)).toBe('عُثْمَانُ بْنُ عَفَّانَ');
		expect(parseHadithPayload({ id: 5, isnad: hadith.isnad, isnad_html: hadith.isnad_html }))
			.toEqual(expect.objectContaining({ narrator: 'عُثْمَانُ بْنُ عَفَّانَ', narratorEn: 'ʿUthmān b. ʿAffān' }));
		expect(parsePrimaryNarrator({ isnad: [{ slug: 'p-4307', name: 'عثمان بن عفان' }],
			isnad_html: '<span class="hp-rawi" data-rawi-slug="p-4307">عُثْمَانَ</span>' }))
			.toBe('عثمان بن عفان');
	});

	test('captures the page narrator badge separately from the isnad payload', () => {
		const $ = require('cheerio').load('<article><span>مرفوع</span><span>· رواه عثمان بن عفان</span></article>');
		expect(parsePageNarrator($)).toBe('عثمان بن عفان');
		expect(parsePrimaryNarrator({ narrator: 'رواه عثمان بن عفان', isnad: [{ name: 'راو آخر' }] }))
			.toBe('عثمان بن عفان');
	});

	test('sanitizes and links the authoritative source isnad without name matching', () => {
		const html = parseSourceIsnadHtml('<span class="hp-sigha">حَدَّثَنَا </span><span class="hp-rawi" data-rawi-slug="p-3919" data-name="عبد الله بن مسلمة">عَبْدُ اللَّهِ بْنُ مَسْلَمَةَ </span>، <span hidden>ignored</span><script>ignored()</script>');
		expect(html).toBe('حَدَّثَنَا <a href="https://hdith.com/encyclopedia/rawi/p-3919" target="_blank" rel="noopener noreferrer" title="عبد الله بن مسلمة">عَبْدُ اللَّهِ بْنُ مَسْلَمَةَ </a>،');
		expect(parseSourceIsnadHtml('', 'عَنْ رَاوٍ')).toBe('عَنْ رَاوٍ');
	});

	test('parses takhrij and shawahid as internally resolvable link records', () => {
		const links = parseLinks({
			takhrij: { sources: [{ book_id: 2, author: 'مسلم', book_quoted: 'صحيحه', occurrences: [{ entry_id: 22, hadith_num: '10', similarity: 'بمثله' }] }] },
			shawahid: { groups: [{ narrator: 'صحابي', books: [{ title: 'سنن أبي داود', entries: [{ book_id: 3, entry_id: 33, number: '20 ' }] }] }] },
			similars: [{ book_id: 8, book: 'مسند أحمد', entry_id: 44, numbering: '30', tarf: 'بداية متن الحديث المشابه' }]
		});
		expect(links).toEqual([
			expect.objectContaining({ type: 'takhrij', sourceBookTitle: 'مسلم، صحيحه', sourceEntryId: 22, internalRef: 'muslim:10' }),
			expect.objectContaining({ type: 'shahid', sourceBookTitle: 'سنن أبي داود', sourceEntryId: 33, internalRef: 'abudawud:20' }),
			expect.objectContaining({ type: 'similar', sourceBookTitle: 'مسند أحمد', sourceEntryId: 44, num: '30', label: null, bodyStart: 'بداية متن الحديث المشابه' })
		]);
	});

	test('resolves links only through the imported hdith source-entry crosswalk', () => {
		const link = { sourceBookId: 2, sourceEntryId: 13000, num: '999', internalRef: 'muslim:999' };
		expect(resolveLinkTarget(link, { id: 42, num: '1234a' })).toEqual({
			sourceNum: '999', internalHadithId: 42, internalRef: 'muslim:1234a'
		});
		expect(resolveLinkTarget(link, null)).toEqual({
			sourceNum: '999', internalHadithId: null, internalRef: null
		});
	});

	test('does not infer internal references from matching number strings', () => {
		const ahmad = { sourceBookId: 8, sourceEntryId: 88, num: '123', internalRef: null };
		expect(resolveLinkTarget(ahmad, { id: 456, num: '900' })).toEqual({
			sourceNum: '123', internalHadithId: 456, internalRef: 'ahmad:900'
		});
		expect(resolveLinkTarget(ahmad, null)).toEqual({ sourceNum: '123', internalHadithId: null, internalRef: null });
		const malik = { sourceBookId: 7, sourceEntryId: 77, num: '123', internalRef: null };
		expect(resolveLinkTarget(malik, null)).toEqual({ sourceNum: '123', internalHadithId: null, internalRef: null });
		expect(resolveLinkTarget(malik, { id: 789, num: '2-4' })).toEqual({
			sourceNum: '123', internalHadithId: 789, internalRef: 'malik:2-4'
		});
	});

	test('parses attribution, subjects, and sharh availability', () => {
		const record = parseHadithPayload({
			id: 5, numbering_harf: '1', chapter_path: [{ id: 2 }], next_id: 6, attribution: 'مرفوع',
			matn: 'بِدَايَةُ مَتْنِ الْحَدِيثِ',
			isnad_html: '<span class="hp-rawi" data-rawi-slug="p-1">رَاوٍ</span>',
			subjects: [{ slug: 's-1', title: 'النية' }], services: [{ type_id: 6, items: [{ entry_id: 7 }] }]
		});
		expect(record).toEqual(expect.objectContaining({ sourceId: 5, num: '1', chapterId: 2, attribution: 'مرفوع', chainType: null, bodyStart: 'بِدَايَةُ مَتْنِ الْحَدِيثِ',
			sourceIsnadHtml: expect.stringContaining('https://hdith.com/encyclopedia/rawi/p-1') }));
		expect(record.subjects).toEqual([{ slug: 's-1', title: 'النية' }]);
		expect(record.sharhPreview).toHaveLength(1);
		expect(parseHadithPayload({ id: 6, chain_type: 'معلق' })).toEqual(expect.objectContaining({ attribution: null, chainType: 'معلق' }));
	});

	test('parses Gharib al-Hadith terms and their source definitions', () => {
		expect(parseGharib([{ id: 12, term: 'أبعد', matched_text: 'أَبْعَدَ', lexicon: 'غريب الحديث', definitions: [
			{ book: 'النهاية في غريب الحديث', content: 'أي ذهب إلى مكان بعيد.' }
		] }])).toEqual([{ sourceId: 12, term: 'أبعد', matchedText: 'أَبْعَدَ', lexicon: 'غريب الحديث', definitions: [
			{ book: 'النهاية في غريب الحديث', content: 'أي ذهب إلى مكان بعيد.' }
		] }]);
	});

	test('finds the first detail id and defines searchable sharh storage', () => {
		expect(firstHadithId({ hadiths: [{ id: 12 }] }, 'b-1')).toBe(12);
		expect(schemaStatements().join('\n')).toContain('FULLTEXT KEY hdith_sharh_text');
		expect(schemaStatements().join('\n')).toContain("format VARCHAR(8) NOT NULL DEFAULT 'md'");
		expect(schemaStatements().join('\n')).toContain('source_reference VARCHAR(45) NULL');
		expect(schemaStatements().join('\n')).toContain('source_edition_reference VARCHAR(45) NULL');
		expect(schemaStatements().join('\n')).toContain('source_edition_num VARCHAR(45) NULL');
		expect(schemaStatements().join('\n')).toContain('is_supplementary TINYINT(1) NOT NULL DEFAULT 0');
		expect(schemaStatements().join('\n')).toContain("link_type ENUM('takhrij','shahid','similar')");
		expect(schemaStatements().join('\n')).toContain('source_body_start MEDIUMTEXT NULL');
		expect(schemaStatements().join('\n')).toContain('chain_type VARCHAR(128) NULL');
		expect(schemaStatements().join('\n')).toContain('source_isnad_html MEDIUMTEXT NULL');
		expect(schemaStatements().join('\n')).toContain('narrator TEXT NULL');
		expect(schemaStatements().join('\n')).toContain('narrator_en TEXT NULL');
		expect(schemaStatements().join('\n')).toContain('name_tashkil TEXT NULL');
		expect(schemaStatements().join('\n')).toContain('name_ala_lc TEXT NULL');
		expect(schemaStatements().join('\n')).toContain('gharib_json JSON NULL');
		expect(schemaStatements().join('\n')).toContain('source_book_title VARCHAR(255) NULL');
		expect(schemaStatements().join('\n')).toContain('KEY hdith_link_source_book (source_book_id)');
		expect(schemaStatements().join('\n')).toContain('CREATE TABLE IF NOT EXISTS hdith_book_mappings');
		expect(schemaStatements().join('\n')).toContain('CREATE TABLE IF NOT EXISTS hdith_book_reference_crosswalk');
		expect(fs.readFileSync(path.join(__dirname, '..', 'bin', 'utils', 'import-hdith-six-books-enrichment.js'), 'utf8'))
			.toContain('HadithAttributions.ensureSchema');
	});

	test('preserves indexed hadith navigation while applying enrichment updates', () => {
		const indexer = fs.readFileSync(path.join(__dirname, '..', 'bin', 'indexEnrichedHadithBatch.js'), 'utf8');
		expect(indexer).toContain('await attachNavigation(rows)');
		expect(indexer).toContain('ORDER BY bookId, ordinal, id');
		expect(indexer).toContain('row.prev_ref =');
		expect(indexer).toContain('row.next_ref =');
		expect(indexer).toContain('h.body_start');
		expect(indexer).toContain("ctx._source.remove('tarf')");
		expect(indexer).not.toContain('doc_as_upsert: true');
	});

	test('keeps chain boundary and transliteration fixes in future hdith imports', () => {
		const sixBookImporter = fs.readFileSync(path.join(__dirname, '..', 'bin', 'utils', 'import-hdith-six-books-enrichment.js'), 'utf8');
		const genericImporter = fs.readFileSync(path.join(__dirname, '..', 'bin', 'utils', 'import-hdith-book.js'), 'utf8');
		expect(sixBookImporter).toContain("await correctLocalChainBodySplit(connection, hadithId, record.bodyStart, { replaceBodyFromSource: config.sourceSlug === 'b-8' })");
		expect(sixBookImporter).toContain("Hadith.transliteratedNarratorChain(chain).chain_en");
		expect(sixBookImporter).toContain('UPDATE hadiths SET chain=?, body=?, footnote=?, chain_en=?, text=? WHERE id=?');
		expect(genericImporter).toContain("chain_en: Hadith.transliteratedNarratorChain(chain || '').chain_en || null");
		expect(genericImporter).toContain('gradeText, chain, chain_en, body, text)');
		expect(fs.readFileSync(path.join(__dirname, '..', 'bin', 'indexEnrichedHadithBatch.js'), 'utf8'))
			.toContain('h.chain, h.chain_en, h.body');
	});

	test('converts sharh HTML to normalized Markdown', () => {
		expect(sharhToMarkdown('<h2>عنوان</h2><p>شرح <strong>مهم</strong>.</p><ul><li>فائدة</li></ul>'))
			.toBe('## عنوان\n\nشرح **مهم**.\n\n- فائدة');
		expect(sharhToMarkdown('فقرة أولى\n\nفقرة ثانية')).toBe('فقرة أولى\n\nفقرة ثانية');
	});

	test('deduplicates repeated sharh entries while retaining the fullest Markdown body', () => {
		expect(dedupeSharhItems([
			{ sourceEntryId: 357836, text: 'short', chapter: null },
			{ sourceEntryId: 357836, text: 'the complete sharh body', chapter: 'chapter' },
			{ sourceEntryId: 357837, text: 'another sharh' }
		])).toEqual([
			{ sourceEntryId: 357836, text: 'the complete sharh body', chapter: 'chapter' },
			{ sourceEntryId: 357837, text: 'another sharh' }
		]);
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

	test('does not treat Abu Dawud collection-author search rows as supplemental graders', () => {
		const opinions = parseGraderOpinions([
			{ slug: 'collection-author', muhaddith: 'أبو داود', degree: 'حسن صحيح', source: 'سنن أبي داود', book_page: '1' },
			{ slug: 'albani', muhaddith: 'الألباني', degree: 'حسن صحيح', source: 'صحيح سنن أبي داود', book_page: '1' }
		], 'b-3', '1');
		expect(opinions.map(opinion => opinion.grader)).toEqual(['الألباني']);
	});

	test('stores collection-native hukm with its grader separately from external opinions', () => {
		const opinions = parseCollectionGrades({
			id: 96224, book: { slug: 'b-4', title: 'جامع الترمذي' }, numbering_harf: '2',
			grading: [{ scholar: 'الترمذي', opinion: 'هذا حديث حسن صحيح', degree: 1, branch: 'A' }]
		});
		expect(opinions).toEqual([expect.objectContaining({
			sourceSlug: 'collection-b-4-1', grader: 'الترمذي', grade: 'هذا حديث حسن صحيح',
			gradeCategoryId: 1, source: 'جامع الترمذي', bookPage: '2', driver: 'A'
		})]);
	});

	test('renders all grader opinions in the scholarly grades detail section', () => {
		const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_metadata.ejs'), 'utf8');
		expect(template).toContain('metadata.grades.forEach');
		expect(template).toContain('grade.source_url');
		expect(template).toContain('hadith-grade-opinion');
		expect(template).not.toContain('hadith-grader-opinions');
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

	test('confirms the nearly exact beginning of the combined chain and body', () => {
		expect(hadithPrefixSimilarity(
			normalizeHadithForComparison('حدثنا أنس عن مالك قال سمعت النبي يقول إنما الأعمال بالنيات'),
			normalizeHadithForComparison('حدثنا أنس عن مالك قال سمعت النبي ﷺ يقول إنما الأعمال بالنيات حاشية محلية طويلة')
		)).toBe(1);
		expect(hadithPrefixSimilarity(
			normalizeHadithForComparison('حدثنا أنس عن مالك قال سمعت النبي يقول إنما الأعمال بالنيات'),
			normalizeHadithForComparison('حدثنا زيد عن شعبة قال سمعت ابن عمر يقول نص مختلف')
		)).toBeLessThan(0.5);
	});

	test('ignores the fixed Ibn Khuzaymah riwayah wrapper before strict chain comparison', () => {
		const local = 'حدثنا محمد بن يحيى حدثنا عبد الصمد حدثنا شعبة عن عاصم عن الشعبي أن ابن عمر كان يصلي ركعتين';
		const source = 'أخبرنا أبو طاهر قال حدثنا أبو بكر قال حدثنا محمد بن يحيى حدثنا عبد الصمد حدثنا شعبة عن عاصم عن الشعبي أن ابن عمر كان يصلي ركعتين';
		expect(normalizeHadithForComparison(source)).toBe(normalizeHadithForComparison(local));
		expect(hadithPrefixSimilarity(source, local)).toBe(1);
	});

	test('moves only the local chain/body boundary to the cached matn start', () => {
		const split = proposedChainBodySplit(
			'حَدَّثَنَا أَنَسٌ عَنْ مَالِكٍ قَالَ سَمِعْتُ النَّبِيَّ',
			'يَقُولُ إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى',
			'إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ، وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى.'
		);
		expect(split).toEqual(expect.objectContaining({
			chain: 'حَدَّثَنَا أَنَسٌ عَنْ مَالِكٍ قَالَ سَمِعْتُ النَّبِيَّ يَقُولُ',
			body: 'إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى'
		}));
		expect(proposedChainBodySplit('حدثنا راو', 'متن مختلف', 'كلام لا يطابق النص المحلي')).toBeNull();
	});

	test('moves local text after the cached matn ending into the footnote', () => {
		const split = proposedBodyFootnoteSplit(
			'*«إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى».* تَنْبِيهٌ مُلْحَقٌ',
			'حَاشِيَةٌ قَدِيمَةٌ',
			'إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ، وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى.'
		);
		expect(split).toEqual({
			body: '*«إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى».*',
			footnote: 'تَنْبِيهٌ مُلْحَقٌ حَاشِيَةٌ قَدِيمَةٌ'
		});
		expect(proposedBodyFootnoteSplit('متن مختلف تماما هنا', null, 'نص لا يطابق هذا المتن')).toBeNull();
	});

	test('ignores external grader opinions for the two Sahih collections', () => {
		expect(ignoresExternalGrades({ sourceSlug: 'b-1' })).toBe(true);
		expect(ignoresExternalGrades({ sourceSlug: 'b-2' })).toBe(true);
		expect(ignoresExternalGrades({ sourceSlug: 'b-3' })).toBe(false);
	});
});
