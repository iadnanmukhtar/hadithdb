'use strict';

const fs = require('fs');
const path = require('path');
const { classificationFromRow, legacyGradeCategoryForId, legacyGradeColorForId, narratorDisplayFullname, preferredColoredGradeOpinion, resolvedSimilarLinks, sourceNarratorNames, translatedSourceGrade, translatedSourceGrader, uniqueGradeGraderPairs, vocalizedNarratorName, withPrimaryGrade } = require('../lib/HdithMetadata');

describe('hdith.com metadata display', () => {
	test('loads enrichment only for the single hadith detail route', () => {
		const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'search.js'), 'utf8');
		expect(route).toContain('HdithMetadata.forHadith');
		expect(route).toContain('HdithMetadata.withPrimaryGrade');
		expect(route).not.toContain('addHdithShawahid');
		expect(route).not.toContain('shawahidHadiths');
		expect(route.indexOf('results[0].single = true')).toBeLessThan(route.indexOf('HdithMetadata.forHadith'));
		expect((route.match(/HdithMetadata\.attachClassifications\(results\)/g) || [])).toHaveLength(2);
		expect(route).toContain('HdithMetadata.attachClassifications(results.flatMap');
	});

	test('builds lightweight attribution and chain classifications for list pages', () => {
		expect(classificationFromRow({
			attribution_id: 200,
			attribution_en: 'Prophetic',
			attribution: 'مرفوع',
			chain_type: 'معلق ، مرسل'
		})).toEqual({
			attribution: { id: 200, title_en: 'Prophetic', title: 'مرفوع' },
			chainCategories: [
				{ key: 'muallaq', title_en: 'Muʿallaq', title: 'معلق' },
				{ key: 'mursal', title_en: 'Mursal', title: 'مرسل' }
			]
		});
	});

	test('includes the primary hadith grader before supplemental source opinions', () => {
		const item = {
			grade: { id: 250 },
			ar: { grader_shortName: 'الألباني', grader_name: 'محمد ناصر الدين الألباني', grade_grade: 'حسن صحيح' },
			en: { grader_shortName: 'Albānī', grader_name: 'M. Nāṣir al-Dīn al-Albānī', grade_grade: 'Good-Sound' }
		};
		const opinions = withPrimaryGrade([
			{ grader: 'محدث آخر', grade: 'حسن صحيح' }
		], item);
		expect(opinions).toHaveLength(2);
		expect(opinions[0]).toMatchObject({
			grader: 'الألباني', grader_en: 'Albānī', grade: 'حسن صحيح', grade_en: 'Good-Sound', primary: true
		});
		expect(item.legacyGradeColor).toBe('oklch(68% .105 155)');
	});

	test('does not duplicate a primary grading already present in metadata', () => {
		const opinions = withPrimaryGrade([{ grader: 'الألباني', grade: 'صحيح' }], {
			ar: { grader_shortName: 'الألباني', grade_grade: 'صحيح' }
		});
		expect(opinions).toHaveLength(1);
		expect(opinions[0]).toMatchObject({ grader: 'الألباني', grade: 'صحيح', primary: true });
	});

	test('exposes legacy grade controls in the scholarly grades section for admins', () => {
		const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'search.js'), 'utf8');
		const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_metadata.ejs'), 'utf8');
		const scripts = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'scripts.ejs'), 'utf8');
		const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'css', 'style.css'), 'utf8');
		expect(route).toContain('HdithMetadata.forHadith(results[0].actual ? results[0].actual.id : results[0].id) || {}');
		expect(template).toContain('grade.primary && site.editMode');
		expect(template).toContain('data-prop="hadith.gradeId"');
		expect(template).toContain('data-prop="hadith.graderId"');
		expect(template).toContain("bilingualLabel(legacyGrade.grade_en, legacyGrade.grade)");
		expect(template).toContain("bilingualLabel(legacyGrader.shortName_en, legacyGrader.shortName)");
		expect(template).toContain('if (!site.editMode)');
		expect(scripts).toContain("$el.on('change'");
		expect(scripts).toContain('select[data-prop="hadith.gradeId"], select[data-prop="hadith.graderId"]');
		expect(scripts).not.toContain("propStr === 'hadith.gradeId' || propStr === 'hadith.graderId'");
		expect(css).toContain('.hadith-legacy-grade-editor { align-items: center; display: grid;');
	});

	test('does not manufacture an English rendering for an untranslated primary grade', () => {
		const opinions = withPrimaryGrade([], {
			ar: { grader_shortName: 'محدث', grade_grade: 'لفظ غير مترجم' }
		});
		expect(opinions).toHaveLength(1);
		expect(opinions[0]).toMatchObject({ grader_en: null, grader_name_en: null, grade_en: null });
	});

	test('maps legacy grade ID ranges to the four grade colors', () => {
		expect([[0, 1], [199, 1], [200, 2], [499, 2], [500, 3], [599, 3], [600, 4], [1999, 4]]
			.map(([id]) => legacyGradeCategoryForId(id))).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
		expect(legacyGradeCategoryForId(-1)).toBe(0);
		expect(legacyGradeCategoryForId(2000)).toBe(0);
		expect(legacyGradeCategoryForId('not-an-id')).toBe(0);
		expect(legacyGradeCategoryForId(null)).toBe(0);
		expect(legacyGradeColorForId(2000)).toBe('oklch(58% .02 250)');
		expect(legacyGradeColorForId(100)).toBe('oklch(58% .135 155)');
		expect(legacyGradeColorForId(250)).toBe('oklch(68% .105 155)');
		expect(legacyGradeColorForId(550)).toBe('oklch(57% .165 22)');
		expect(legacyGradeColorForId(700)).toBe('oklch(68% .115 22)');
		const opinions = withPrimaryGrade([], {
			grade: { id: 550 }, ar: { grader_shortName: 'المصنف', grade_grade: 'ضعيف' }
		});
		expect(opinions[0]).toMatchObject({ grade_color: 'oklch(57% .165 22)', legacy_grade_id: 550 });
	});

	test('shows the worst shortest colored ruling instead of a missing legacy ruling', () => {
		const item = { grade: { id: -1 }, ar: { grader_shortName: 'لا يعرف', grade_grade: 'لا نعرف حكم له' } };
		const grades = [
			{ id: 1, grader: 'الدارقطني', grade: 'لا يصح وقد روي موقوفا', grade_category_id: 3, grade_color: 'red' },
			{ id: 2, grader: 'يحيى بن معين', grade: 'منكر', grade_category_id: 3, grade_color: 'red' },
			{ id: 3, grader: 'البيهقي', grade: 'صحيح', grade_category_id: 1, grade_color: 'green' }
		];
		const ordered = withPrimaryGrade(grades, item);
		expect(preferredColoredGradeOpinion(grades).grade).toBe('منكر');
		expect(ordered[0]).toMatchObject({ id: 2, grade: 'منكر' });
		expect(item.legacyGradeOverride).toMatchObject({ grader: 'يحيى بن معين', grade: 'منكر' });
		expect(item.legacyGradeColor).toBe('red');
		expect(item.grade.id).toBe(-1);
	});

	test('does not fall back to Arabic for an untranslated English inline grade', () => {
		const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_item.ejs'), 'utf8');
		expect(template).toContain("!!(legacyGradeOverride.grade_en && legacyGradeOverride.grader_en)");
		expect(template).toContain('showLegacyInlineGrade && showTranslatedLegacyGradeOverride');
		expect(template).toContain("lang === 'en' ? legacyGradeOverride.grade_en : legacyGradeOverride.grade");
		expect(template).not.toContain("legacyGradeOverride.grade_en || legacyGradeOverride.grade");
	});

	test('deduplicates repeated grade-grader pairs while retaining distinct opinions', () => {
		const opinions = uniqueGradeGraderPairs([
			{ grader: 'الألباني', grade: 'صحيح', source_url: 'https://hdith.com/one' },
			{ grader: 'الأَلْبَانِيّ', grade: 'صَحِيح', source_url: 'https://hdith.com/two' },
			{ grader: 'الألباني', grade: 'حسن', source_url: 'https://hdith.com/three' }
		]);
		expect(opinions).toHaveLength(2);
		expect(opinions.map(opinion => opinion.source_url)).toEqual(['https://hdith.com/one', 'https://hdith.com/three']);
	});

	test('hides external similar links until they resolve to internal references', () => {
		expect(resolvedSimilarLinks([
			{ link_type: 'similar', source_url: 'https://hdith.com/one', internal_ref: null },
			{ link_type: 'similar', source_url: 'https://hdith.com/two', internal_ref: 'bukhari:1' },
			{ link_type: 'shahid', internal_ref: 'muslim:2' }
		])).toEqual([{ link_type: 'similar', source_url: 'https://hdith.com/two', internal_ref: 'bukhari:1' }]);
		const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_metadata.ejs'), 'utf8');
		expect(template).toContain('metadata.similar.filter(reference => reference.internal_ref)');
		expect(template).not.toContain('reference.internal_ref ?');
	});

	test('translates source-specific scholarly grades and collection graders', () => {
		expect(translatedSourceGrade('أصح شيء في هذا الباب وأحسن')).toBe('The soundest and best report in this chapter');
		expect(translatedSourceGrader('الترمذي')).toBe('al-Tirmidhī');
	});

	test('uses vocalized source-isnad names for matching timeline narrators', () => {
		const names = sourceNarratorNames('حَدَّثَنَا <a href="https://hdith.com/encyclopedia/rawi/p-6305">الْمُغِيرَةِ بْنِ شُعْبَةَ : </a>');
		expect(names.get('https://hdith.com/encyclopedia/rawi/p-6305')).toBe('الْمُغِيرَةِ بْنِ شُعْبَةَ');
		expect(vocalizedNarratorName({ source_url: 'https://hdith.com/encyclopedia/rawi/p-2577', source_slug: 'p-2577', name: 'أبو داود السجستاني' }, names)).toBe('أَبُو دَاوُدَ السِّجِسْتَانِيُّ');
	});

	test('shows the known full narrator name without appended biographical variants', () => {
		expect(narratorDisplayFullname({ name: 'المغيرة بن شعبة', fullname: 'المغيرة بن شعبة بن أبي عامر : ثقيف بن منبه، ويقال غير ذلك' }))
			.toBe('المغيرة بن شعبة بن أبي عامر');
		expect(narratorDisplayFullname({ name: 'المغيرة بن شعبة', fullname: 'المغيرة بن شعبة' })).toBeNull();
	});

	test('keeps the regular chain in the main hadith and moves the enriched chain above the timeline', () => {
		const itemTemplate = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_item.ejs'), 'utf8');
		const metadataTemplate = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_metadata.ejs'), 'utf8');
		expect(itemTemplate).toContain('if (langData.chain || site.editMode)');
		expect(itemTemplate).not.toContain('linkedIsnadHtml');
		expect(itemTemplate).not.toContain('enrichedNarrators');
		expect(metadataTemplate).toContain('metadata.sourceIsnadHtml');
		expect(metadataTemplate).toContain('hadith-enriched-isnad enriched-isnad');
		expect(metadataTemplate).toContain('narrator.vocalized_name || narrator.name');
		expect(metadataTemplate.indexOf('metadata.sourceIsnadHtml')).toBeLessThan(metadataTemplate.indexOf('hadith-narrator-list'));
		expect(metadataTemplate).not.toContain('enriched-isnad-separator');
		expect(metadataTemplate).not.toContain('←');
		const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'search.js'), 'utf8');
		expect(route).not.toContain('linkedIsnadHtml');
	});

	test('does not display the imported body start above the main hadith', () => {
		const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith.ejs'), 'utf8');
		expect(template).not.toContain('i.body_start');
		expect(template).not.toContain('hadith-tarf');
		const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'css', 'style.css'), 'utf8');
		expect(css).not.toContain('.hadith-tarf');
		const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');
		expect(script).not.toContain('HadithTarf');
	});

	test('loads the authoritative imported source isnad without local-chain matching', () => {
		const metadata = fs.readFileSync(path.join(__dirname, '..', 'lib', 'HdithMetadata.js'), 'utf8');
		expect(metadata).toContain('m.source_isnad_html');
		expect(metadata).toContain('sourceIsnadHtml: metadata.source_isnad_html || null');
		expect(metadata).not.toContain('normalizedArabicWithMap');
		expect(metadata).not.toContain('narratorMatch');
		expect(metadata).not.toContain('linkedIsnadHtml');
	});

	test('renders all metadata as full-page anchor sections', () => {
		const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_metadata.ejs'), 'utf8');
		const itemTemplate = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_item.ejs'), 'utf8');
		['Scholarly Grades', 'أحكام المحدّثين', 'Chain of Narrators', 'الإسناد', 'Explanations', 'الشرح', 'Definitions', 'غريب الحديث', 'Similar Hadiths', 'أحاديث مشابهة'].forEach(label => expect(template).toContain(label));
		expect(template).not.toContain('Additional References');
		expect(template).not.toContain('التخريج');
		expect(template).not.toContain('Supporting References');
		expect(template).not.toContain('الشواهد');
		['Scholarly gradings', '>Isnād<', '>Sharḥ<', 'Gharīb al-Ḥadīth', 'Takhrīj and shawāhid', 'التخريج والشواهد', '>Mushābihah<'].forEach(label => expect(template).not.toContain(label));
		expect(template).toContain('<%= grade.grader %>');
		expect(template).toContain('class="hadith-grade-list"');
		expect(template).toContain('class="row hadith-grade-opinion<%= grade.primary');
		expect(template).toContain('hadith-grade-opinion-en');
		expect(template).toContain('hadith-grade-opinion-ar');
		expect(template).toContain('const hasEnglishGrade = !!(grade.grade_en && grade.grader_en)');
		expect(template).toContain('if (hasEnglishGrade)');
		expect(template).toContain('<%= grade.grade_en %>');
		expect(template).toContain('<%= grade.grader_en %>');
		expect(template).not.toContain('grade.grade_en || grade.grade');
		expect(template).not.toContain('grade.grader_en || grade.grader');
		expect(template).not.toContain('<ul class="mb-0">');
		expect(template).not.toContain('grade.source_name');
		expect(template).not.toContain('grade.book_page');
		expect(template).not.toContain('entry.author');
		expect(template).not.toContain('entry.chapter');
		expect(template).not.toContain('entry.page_num');
		expect(template).toContain('class="hadith-sharh-body intro"');
		expect(template).toContain('data-hadith-sharh-collapsible');
		expect(template).toContain('data-hadith-sharh-expand');
		expect(template).toContain('aria-expanded="false"');
		expect(template).toContain('hadith-sharh-collapse-wrap');
		expect(template).toContain('site.editMode || entry.text || entry.text_en');
		expect(template).toContain("entry.text ? 'col-md-6' : 'col-12'");
		expect(template).toContain('مزيد...');
		expect(template).toContain('<details class="hadith-gharib-entry"><summary class="small">');
		expect(template).not.toContain('<details class="hadith-gharib-entry" open>');
		expect(template).not.toContain("entry.term !== entry.matchedText");
		expect(template).not.toContain('<summary class="small"><strong>');
		expect(template).toContain('class="hadith-gharib-definition small"');
		expect(template).toContain('class="hadith-source-similar-reference small"');
		expect(template).not.toContain('>المزيد<');
		['Grader:', 'Grade:', 'Narrator grading:', 'Generation:', 'Died:', 'Transmission formula:', 'Reference ', 'Page ', 'Collected by', 'Source record'].forEach(label => expect(template).not.toContain(label));
		expect(template).not.toContain('Matn attribution:');
		expect(template).not.toContain('data-toc-heading-key="subjects"');
		expect(template).toContain('hadith-narrator-marker');
		expect(template).toContain('hadith-narrator-ordinal');
		expect(template).toContain('hadith-narrator-connector-label');
		expect(template).toContain('narratorIndex < metadata.narrators.length - 1');
		expect(template).toContain('const narratorAccentDetails = [narrator.reliability]');
		expect(template).toContain('hadith-narrator-accent-detail');
		expect(template).toContain('hadith-narrator-fullname');
		expect(template).toContain('<span class="hadith-narrator-fullname"><%= narrator.display_fullname %></span>');
		expect(template).not.toContain('(<%= narrator.display_fullname %>)');
		expect(itemTemplate).toContain('i.single === true');
		expect(itemTemplate).toContain('hasHadithClassification');
		expect(itemTemplate).toContain('showLegacyInlineGrade');
		expect(template).toContain('narrator.display_fullname');
		expect(template).not.toContain('text-bg-warning');
		expect(template).not.toContain('text-bg-light');
		expect(template).not.toContain('تقييم الراوي');
		expect(template).not.toContain('في هذا السند');
		expect(template.indexOf('data-toc-heading-key="grades"')).toBeLessThan(template.indexOf('data-toc-heading-key="isnad"'));
		expect(template).toContain('data-toc-heading-target');
		expect((template.match(/class="row heading hadith-metadata-heading py-2"/g) || []).length).toBe(5);
		expect(template).toContain('class="col-md-6 col-sm-12 fs-5 title" lang="en"');
		expect(template).toContain('class="col-md-6 col-sm-12 title" lang="ar" dir="rtl"');
		expect(template).not.toContain('class="col-md-6 col-sm-12 fs-5 title" lang="ar"');
		expect((template.match(/hadith-metadata-section(?: hadith-mushabihah-section)? mt-4/g) || []).length).toBe(5);
		expect(template).not.toContain('tab-pane');
		expect(template.indexOf('data-toc-heading-key="gharib"')).toBeLessThan(template.indexOf('data-toc-heading-key="mushabihah"'));
		expect(template).not.toContain('data-toc-heading-key="takhrij"');
		expect(template).not.toContain('data-toc-heading-key="shawahid"');
		expect(template).not.toContain('shawahidHadiths');
		expect(template).not.toContain('data-toc-heading-key="references"');
	});

	test('places every single Hadith in the page-level sticky rail layout', () => {
		const page = fs.readFileSync(path.join(__dirname, '..', 'views', 'search.ejs'), 'utf8');
		const rail = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_metadata_rail.ejs'), 'utf8');
		const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');
		const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'css', 'style.css'), 'utf8');
		const hadithTemplate = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith.ejs'), 'utf8');
		expect(page).toContain('hadith-heading-layout hadith-metadata-page-layout');
		expect(page).toContain("item.single && item.book_alias !== 'quran'");
		expect(page).toContain('detailHadithItem');
		expect(page).toContain("hadithDetailSectionItem: detailHadithItem");
		expect(page).toContain("include('sub-views/hadith_metadata_rail.ejs'");
		const header = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'header.ejs'), 'utf8');
		expect(header).toContain("include('hadith_metadata_rail.ejs', { i: hadithDetailSectionItem, topMenu: true })");
		expect(header.indexOf("typeof hadithDetailSectionItem !== 'undefined'")).toBeLessThan(header.indexOf("page.menu === 'Chapter' || page.menu === 'Section'"));
		expect(rail).toContain('i.hdithMetadata || {}');
		expect(rail).toContain('railEditMode || entry.text || entry.text_en');
		expect(rail).toContain('hadith-metadata-side-rail d-none d-lg-block');
		expect(rail).toContain('hadith-heading-toc-sticky');
		expect(rail).toContain('data-toc-heading-rail');
		expect(rail).toContain('data-toc-heading-key');
		expect(rail).toContain('hadith-detail-section-menu');
		expect(rail).toContain('<span class="chapter-toc-current">Hadith</span>');
		expect(rail).toContain('data-bs-toggle="collapse"');
		expect(rail).toContain("const railTopMenuId = railTopMenu ? 'toc2'");
		expect(rail).toContain('data-toc-heading-scroll="<%= group.key %>"');
		expect(rail).toContain('class="hadith-detail-section-control"');
		expect(styles).toMatch(/\.hadith-detail-section-control\s*\{[^}]*color:\s*var\(--c-accent\)/);
		expect(rail).not.toContain('const groupHref = `#${railBase}-${group.key}`');
		expect(rail).not.toContain('href="<%= groupHref %>"');
		expect(client).toContain("row.closest('.hadith-detail-section-menu')");
		expect(client).toContain('window.bootstrap.Collapse.getOrCreateInstance(hadithSectionPanel).hide()');
		expect(client).toContain("row.getAttribute('data-toc-heading-scroll')");
		expect(client).toContain("headingTarget.scrollIntoView({ behavior: 'smooth', block: 'start' })");
		expect(rail).toContain('const railTopMenu =');
		expect(rail).toContain('<button type="button" class="nav-link hadith-heading-toc-link');
		expect(rail).toContain("key: 'reflection'");
		expect(rail).toContain("key: 'hadith', label: 'Hadith'");
		expect(rail.indexOf("key: 'hadith'")).toBeLessThan(rail.indexOf("key: 'reflection'"));
		expect(rail.indexOf("key: 'reflection'")).toBeLessThan(rail.indexOf("key: 'grades'"));
		expect(rail).toContain('data-reflection-disclosure-trigger="comments-disclosure"');
		expect(rail).toContain('heading-toc-book-name');
		expect(rail).toContain('railChapterHref');
		expect(rail).toContain('railSectionHref');
		expect(rail).toContain('hadith-metadata-source-link small');
		expect(rail).toContain('hdith.com source');
		expect(rail).toContain("const railEditMode = typeof site !== 'undefined' ? !!site.editMode");
		expect(rail).toContain('railEditMode && !railNavigationOnly && railMetadata.sourceUrl');
		expect(rail).toContain("key: 'gharib'");
		expect(rail).toContain("label: 'Definitions'");
		expect(rail).not.toContain("key: 'takhrij'");
		expect(rail).not.toContain('Additional References');
		expect(rail).not.toContain("key: 'shawahid'");
		expect(rail).not.toContain('Supporting References');
		expect(rail).not.toContain('shawahidHadiths');
		const railScript = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');
		expect(railScript).toContain("var control = event.target.closest('[data-toc-heading-key]');");
		expect(railScript).toContain("target.scrollIntoView({ behavior: 'smooth', block: 'start' });");
		expect(rail).toContain("key: 'mushabihah', label: 'Similar Hadiths'");
		expect(rail).not.toContain('label_ar');
		expect(rail.indexOf('data-toc-heading-rail-nav')).toBeLessThan(rail.indexOf('hadith-metadata-source-link small'));
		expect(rail).not.toContain("key: 'subjects'");
		expect(rail.indexOf("key: 'grades'")).toBeLessThan(rail.indexOf("key: 'isnad'"));
		expect(rail.indexOf('railSectionHref')).toBeLessThan(rail.indexOf('railGroups.forEach'));
		expect(rail).not.toContain('In this hadith');
		expect(rail).not.toContain('if (railGroups.length)');
		expect(rail).not.toContain('data-bs-toggle="tab"');
		expect(hadithTemplate).toContain('data-toc-heading-key="hadith"');
		const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'css', 'style.css'), 'utf8');
		expect(css).toContain('.hadith-metadata-section { direction: rtl;');
		expect(css).toContain('.enriched-isnad a { color: var(--bs-body-color); text-decoration: underline dotted; text-underline-offset: .18em; }');
		expect(css).toContain('.enriched-isnad a:hover, .enriched-isnad a:focus-visible { color: var(--c-accent); }');
		expect(css).toContain('.hadith-enriched-isnad { color: var(--c-gray-mid); font-size: var(--f-size-ar); margin: 0 0 1.25rem; }');
		expect(css).toContain('.hadith-metadata-heading { margin-bottom: 1rem; }');
		expect(css).toContain('.hadith-metadata-rail button.hadith-heading-toc-link { text-align: left; width: 100%; }');
		expect(css).toContain('.hadith-grade-list { color: var(--bs-body-color); margin: 0 0 1.25rem; }');
		expect(css).not.toMatch(/\.hadith-enriched-isnad \{[^}]*text-indent/);
		expect(css).toContain('.hadith-narrator-name { font-size: calc(1.05rem * var(--content-font-scale)) !important;');
		expect(css).toContain('.hadith-narrator-name a { color: inherit; font-size: inherit !important; text-decoration: underline dotted; text-underline-offset: .18em; }');
		expect(css).toContain('.hadith-narrator-death * { font-size: inherit !important; }');
		expect(css).toContain('text-align: left; white-space: nowrap; }');
		expect(css).toContain('grid-template-columns: 3.75rem minmax(0, 1fr) 2rem;');
		expect(css).toContain('.hadith-narrator-death { grid-column: 1; grid-row: 1; text-align: left; }');
		expect(css).toContain('.hadith-narrator-details { color: var(--bs-secondary-color); font-size: calc(1.05rem * var(--content-font-scale)) !important;');
		expect(css).toContain('.hadith-narrator-details * { font-size: inherit !important; }');
		expect(css).toContain('.hadith-narrator-name a:hover, .hadith-narrator-name a:focus-visible { color: var(--c-accent); text-decoration: underline dotted; }');
		expect(css).toContain('.hadith-narrator-fullname { color: var(--bs-secondary-color); display: block; font-size: .8em !important; font-weight: 400; margin-top: .1rem; }');
		expect(css).toContain('details > summary::-webkit-details-marker');
		expect(css).toContain('details > summary::marker');
		expect(css).toContain('.hadith-gharib-entry summary::after');
		expect(css).toContain('.hadith-gharib-definition { font-size: calc(1.05rem * var(--content-font-scale)) !important; }');
		expect(css).toContain('.hadith-gharib-definition * { font-size: inherit !important; }');
		expect(css).toContain('.hadith-sharh-body { font-size: calc(1.05rem * var(--content-font-scale)) !important; line-height: var(--content-line-height); text-indent: 0; }');
		expect(css).toContain('.hadith-sharh-body * { font-size: inherit !important; }');
		expect(css).toContain('-webkit-line-clamp: 10; line-clamp: 10; overflow: hidden;');
		expect(css).toContain('.hadith-sharh-collapse-wrap { font-size: calc(1.05rem * var(--content-font-scale)) !important; line-height: var(--content-line-height) !important; position: relative; }');
		expect(css).toContain('font-family: inherit; font-size: calc(1.05rem * var(--content-font-scale)) !important; font-style: inherit; font-weight: inherit; left: 0; line-height: var(--content-line-height) !important;');
		const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');
		expect(script).toContain('initHadithSharhDisclosures(document)');
		expect(script).toContain("body.scrollHeight > body.clientHeight + 1");
		expect(script).toContain("button.setAttribute('aria-expanded', 'true')");
		expect(css).toContain('.hadith-mushabihah-section .similar-list .h:lang(ar) { text-align: start; }');
		expect(css).toContain('.hadith-mushabihah-section .similar-list article.hadith-language-item > header:lang(en)');
		expect(css).toContain('.hadith-mushabihah-section .similar-list article.hadith-language-item > header:lang(ar) { text-align: start; }');
		expect(css).toContain('.hadith-narrator-marker .hadith-narrator-ordinal { align-items: center;');
		expect(css).toMatch(/\.hadith-narrator-marker \.hadith-narrator-ordinal \{[^}]*font-size: calc\(var\(--f-size-ar\) \* \.85\);/);
		expect(css).toMatch(/\.hadith-narrator-marker \.hadith-narrator-connector-label \{[^}]*font-size: calc\(var\(--f-size-ar\) \* \.8\);/);
		expect(css).toContain('.hadith-metadata-heading h3:lang(ar) { text-align: right; }');
		expect(css).not.toMatch(/\.hadith-metadata-heading h3:lang\(ar\) \{[^}]*font-size/);
	});

	test('uses the Hadith rail on the home page without metadata links', () => {
		const home = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.ejs'), 'utf8');
		const searchRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'search.js'), 'utf8');
		const item = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_item.ejs'), 'utf8');
		const rail = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_metadata_rail.ejs'), 'utf8');
		expect(home).toContain("var homeHadithItem = random && random.remark != 2 ? random : null");
		expect(home).toContain("hadith-heading-layout hadith-metadata-page-layout");
		expect(home).toContain("include('sub-views/hadith_metadata_rail.ejs', { i: homeHadithItem, mobile: false, navigationOnly: true })");
		expect(rail).toContain("const railNavigationOnly = typeof navigationOnly !== 'undefined' && navigationOnly");
		expect(rail).toContain('railNavigationOnly ? [] : [');
		expect(rail).toContain('railEditMode && !railNavigationOnly && railMetadata.sourceUrl');
		expect(searchRoute).toContain('await HdithMetadata.attachClassifications([random])');
		expect(item).toContain('i.single === true');
		expect(item).toContain('hasHadithClassification');
		expect(item).toContain('i.legacyGradeColor');
	});

	test('shows classifications and the legacy grade on random Hadith TOC items', () => {
		const searchRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'search.js'), 'utf8');
		const item = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_item.ejs'), 'utf8');
		const randomFragment = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'random_toc_item.ejs'), 'utf8');
		expect(searchRoute).toContain('random.randomTocItem = true');
		expect(searchRoute).toContain('await HdithMetadata.attachClassifications([random])');
		expect(item).toContain('i.randomTocItem === true');
		expect(randomFragment).toContain("include('hadith.ejs'");
	});

	test('moves similar hadiths into the final Mushabihah section', () => {
		const search = fs.readFileSync(path.join(__dirname, '..', 'views', 'search.ejs'), 'utf8');
		const hadith = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith.ejs'), 'utf8');
		const hadithItem = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_item.ejs'), 'utf8');
		const metadata = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_metadata.ejs'), 'utf8');
		const rail = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_metadata_rail.ejs'), 'utf8');
		const scripts = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'scripts.ejs'), 'utf8');
		const referenceIndex = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_reference_index.ejs'), 'utf8');
		const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'css', 'style.css'), 'utf8');
		expect(search).not.toContain('!results[i].hdithMetadata');
		expect(search).not.toContain('data-toc-heading-key="mushabihah"');
		expect(hadith).toContain("if (i.single)");
		expect(hadith).toContain("include('hadith_metadata.ejs', { i: i })");
		expect(metadata).toContain('const metadata = i.hdithMetadata || {}');
		expect(metadata).toContain('hadith-mushabihah-section');
		expect(metadata).toContain('data-hadith-similar-search');
		expect(metadata).toContain('data-exclude-ids');
		expect(metadata).toContain('lang="ar" dir="rtl" data-hadith-similar-search');
		expect(metadata).toContain('placeholder="إضافة حديث مشابه"');
		expect(metadata).not.toContain('ابحث بالمرجع أو نص الحديث.');
		expect(css).toContain('.hadith-similar-admin-search { position: relative; text-align: right; width: 100%; }');
		expect(css).toContain('.hadith-similar-admin-search .input-group-text .bi { font-size: .875rem; }');
		expect(metadata).toContain('site.editMode || (i.similar && i.similar.length)');
		expect(rail).toContain("always: railEditMode");
		expect(scripts).toContain("editHadithApiPath('/autocomplete/similar-hadiths')");
		expect(scripts).toContain("prop: 'hadiths_sim.add'");
		expect(metadata).toContain("include('hadith.ejs'");
		expect((metadata.match(/include\('hadith_reference_index\.ejs'/g) || []).length).toBe(1);
		expect(metadata.indexOf("include('hadith_reference_index.ejs', { references: i.similar })")).toBeLessThan(metadata.indexOf('i.similar[similarIndex].rating'));
		expect(referenceIndex).toContain('const referenceGroups = new Map()');
		expect(referenceIndex).toContain('hadith-reference-group-separator"> · ');
		expect(referenceIndex).toContain('class="hadith-reference-index small mb-3"');
		expect(referenceIndex).not.toContain('class="hadith-reference-index fs-5');
		expect(css).toContain('.hadith-mushabihah-section .hadith-reference-index:lang(ar) { font-size: calc(1.05rem * var(--content-font-scale)) !important; }');
		expect(css).toContain('.hadith-mushabihah-section .hadith-reference-index:lang(ar) * { font-size: inherit !important; }');
		expect(referenceIndex).toContain('arabic.toArabicDigits(latinNumber)');
		expect(referenceIndex).toContain('<a href="<%= reference.href %>"><%= reference.number %></a>');
		expect(metadata).not.toContain('أخرجه');
		expect(metadata).not.toContain('i.similarBooks');
		expect(hadithItem).toContain('if (i.book_virtual != 1)');
		expect(hadithItem).toContain('i.similarDemotable');
		expect(hadithItem).toContain('i.similarRemovable');
		expect(hadithItem).toContain("hadith-inline-ruling<%= i.single === true ? ' hadith-inline-ruling-single' : '' %>");
		expect(hadithItem).toContain('class="hadith-inline-ruling-text"');
		expect(css).toContain('.hadith-inline-ruling-single .grade { cursor: text; display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }');
		expect(css).toMatch(/\.search-results \.h \.hadith-body-content,\s*\.search-results \.h \.grade,/);
		expect(css).not.toMatch(/\.search-results \.h \.admin,\s*\.search-results \.h \.grade,/);
		expect(search).not.toContain('أخرجه');
		expect(search).not.toContain('results[i].similarBooks');
	});
});
