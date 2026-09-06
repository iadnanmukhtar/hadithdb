'use strict';

const fs = require('fs');
const path = require('path');
const { gradeColorForCategory, HDITH_GRADE_COLOR_OPTIONS } = require('../lib/HdithMetadata');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

describe('Hadith metadata editing', () => {
	test('constrains scholarly-grade colors to the imported palette', () => {
		expect(HDITH_GRADE_COLOR_OPTIONS.map(option => option.id)).toEqual([0, 1, 2, 3, 4]);
		expect(HDITH_GRADE_COLOR_OPTIONS.map(option => option.color)).toEqual([0, 1, 2, 3, 4].map(gradeColorForCategory));
		expect(gradeColorForCategory(5)).toBeNull();
	});

	test('supports authenticated scholarly-grade CRUD and empty-field translation', () => {
		const route = read('routes/update.js');
		const template = read('views/sub-views/hadith_metadata.ejs');
		expect(route).toContain("type === 'hdith_grade'");
		expect(route).toContain("col === 'add'");
		expect(route).toContain("Utils.trimToEmpty(status.value) || 'شرح مخصص'");
		expect(route).toContain("col === 'delete'");
		expect(route).toContain("col === 'grade_en' && Utils.isFalsey(status.value)");
		expect(route).toContain("col === 'grader_en' && Utils.isFalsey(status.value)");
		expect(route).toContain("col === 'add' || col === 'reorder'");
		expect(route).toContain("col === 'grade_category_id'");
		expect(route).toContain("['grade', 'grader', 'grade_en', 'grader_en'].includes(col)");
		['hdith_grade.grade', 'hdith_grade.grader', 'hdith_grade.grade_en', 'hdith_grade.grader_en',
			'hdith_grade.delete', 'hdith_grade.add'].forEach(prop => expect(template).toContain(`data-prop="${prop}"`));
		expect(template).not.toContain('data-prop="hdith_grade.translate"');
		expect(template).toContain('data-prop="hdith_grade.grade_category_id"');
		expect(template).toContain('data-grade-color="<%= legacyGradeColor(legacyGrade.id) %>"');
		expect(template).toContain('hadith-legacy-grade-color');
		expect(template).toContain('data-hdith-grade-sort-list');
		expect(template).toContain('hadith-grade-drag-handle');
		expect(template).toContain('class="_e hadith-scholarly-grade-value"');
		expect(template).toContain('class="_e hadith-scholarly-grader-value hadith-bilingual-pair-input"');
		expect(template).not.toContain('hadith-scholarly-grade-value hadith-bilingual-pair-input');
		expect(template).not.toContain('data-prop="hdith_grade.grade_en" value=');
		expect(template).not.toContain('bi-box-arrow-up-right');
	});

	test('allows Arabic and English narrator metadata to be edited on list and detail pages', () => {
		const route = read('routes/update.js');
		const item = read('views/sub-views/hadith_item.ejs');
		expect(route).toContain("type === 'hdith_metadata'");
		expect(route).toContain("['narrator', 'narrator_en', 'attribution_id', 'chain_type'].includes(col)");
		expect(route).toContain('UPDATE hdith_hadith_metadata SET ${col}=');
		expect(route).toContain('await runHadithPostUpdateTasks(metadataHadithId)');
		expect(item).toContain("'hdith_metadata.narrator'");
		expect(item).toContain("'hdith_metadata.narrator_en'");
		expect(item).toContain('showPrimaryNarratorOnly');
		expect(item).toContain('i.single === true');
		expect(item).toContain('hadith-narrator-editor');
		expect(item).toContain('hadith-primary-narrator-input');
		expect(read('public/static/css/style.css')).toContain('.h .hadith-primary-narrator-input {');
		expect(read('public/static/css/style.css')).toContain('font-size: inherit !important;');
		expect(read('views/sub-views/scripts.ejs')).toContain("editHadithApiPath('/autocomplete/primary-narrators')");
	});

	test('allows attribution and chain classifications to be edited from controlled lists', () => {
		const route = read('routes/update.js');
		const item = read('views/sub-views/hadith_item.ejs');
		expect(route).toContain("'attribution_id', 'chain_type'");
		expect(route).toContain('HadithAttributions.ATTRIBUTIONS.find');
		expect(route).toContain('HadithChainCategories.CATEGORIES.find');
		expect(route).toContain('UPDATE hadiths SET attributionId=');
		expect(route).toContain('UPDATE hdith_hadith_metadata SET chain_type=');
		expect(item).toContain('data-prop="hdith_metadata.attribution_id"');
		expect(item).toContain('data-prop="hdith_metadata.chain_type"');
		expect(item).toContain('hadithChainCategorySelections');
		expect(item).toContain('bilingualLabel(grade.grade_en, grade.grade)');
		expect(item).toContain('bilingualLabel(grader.shortName_en, grader.shortName)');
		expect(item).not.toContain('data-prop="hadith.add"');
	});

	test('renders and manages custom Sharh in Arabic and English columns', () => {
		const route = read('routes/update.js');
		const template = read('views/sub-views/hadith_metadata.ejs');
		const css = read('public/static/css/style.css');
		expect(route).toContain("type === 'hdith_sharh'");
		expect(route).toContain("col === 'add'");
		expect(route).toContain("col === 'delete'");
		expect(route).toContain('CUSTOM_SHARH_SOURCE_BOOK_ID');
		expect(route).toContain('Only locally managed explanations can be deleted');
		expect(route).toContain("col === 'text' || col === 'text_en'");
		expect(template).toContain('hadith-sharh-columns');
		expect(template).toContain('data-prop="hdith_sharh.text_en"');
		expect(template).toContain('data-prop="hdith_sharh.text"');
		expect(template).toContain('data-prop="hdith_sharh.title_en"');
		expect(template).toContain('data-prop="hdith_sharh.title"');
		expect(template).toContain('placeholder="English book title"');
		expect(template).toContain('placeholder="عنوان كتاب الشرح"');
		expect(template).toContain('hadith-sharh-title-input');
		expect(template).toContain('data-hdith-sharh-sort-list');
		expect(template).toContain('hadith-sharh-drag-handle');
		expect(css).toContain('.hadith-admin-action,');
		expect(css).toContain('color: var(--bs-secondary-color) !important;');
		expect(css).toContain('.hadith-admin-action .bi,');
		expect(template).toContain('data-placeholder="English explanation"');
		expect(template).toContain('data-placeholder="نص الشرح"');
		expect(template).not.toContain("entry.title_en || '…'");
		expect(template).not.toContain('data-markdown-empty-html="&hellip;"');
		expect(template).toContain('data-prop="hdith_sharh.add"');
		expect(template).toContain('data-prop="hdith_sharh.delete"');
		expect(template).toContain('data-prop="hdith_sharh.import_dorar"');
		expect(template).toContain('align-items-center gap-2 hadith-sharh-actions');
		expect(template).toContain('site.editMode || renderedSharh.length');
		expect(template).not.toContain('data-prop="hdith_sharh.translate"');
		expect(route).toContain("col === 'text_en' && Utils.isFalsey(status.value)");
		expect(route).toContain("col === 'title_en' && Utils.isFalsey(status.value)");
		expect(route).toContain('Translate this Arabic Sharh book title into concise English');
		expect(route).toContain('UPDATE hdith_hadith_sharh SET ${col}');
		expect(route).toContain('UPDATE hdith_hadith_sharh SET title_en=${sql(status.value)} WHERE source_id=');
		expect(route).toContain("(col === 'title' || col === 'title_en') && Utils.isTruthy(status.value)");
		expect(route).toContain('UPDATE hdith_sharh_sources SET ${col}=${sql(status.value)}');
		expect(route).toContain('UPDATE hdith_hadith_sharh SET ${col}=${sql(status.value)} WHERE source_id=');
		expect(route).toContain('UPDATE hdith_hadith_grades SET grader_en=${sql(status.value)} WHERE ${sharedGraderWhere}');
		expect(route).toContain('UPDATE graders SET shortName_en=${sql(status.value)}');
		expect(template).toContain("if (entry.text_en)");
	});

	test('preserves translations and admin grades across enrichment imports', () => {
		const importer = read('bin/utils/import-hdith-six-books-enrichment.js');
		expect(importer).toContain("COALESCE(source_driver, '')<>'admin'");
		expect(importer).toContain('SELECT source_entry_id, ordinal, text_en, title, title_en FROM hdith_hadith_sharh');
		expect(importer).toContain('ss.source_book_id>0');
		expect(importer).toContain('existingEntries.get(Number(item.sourceEntryId))?.text_en || null');
		expect(importer).toContain('grader_en VARCHAR(255) NULL');
		expect(importer).toContain('grade_en TEXT NULL');
		expect(importer).toContain('text_en LONGTEXT NULL');
		expect(importer).toContain('title_en VARCHAR(255) NULL');
		expect(importer).toContain('existingEntries.get(Number(item.sourceEntryId))?.title_en || null');
		expect(importer).toContain('source_slug, ordinal, grader_en, grade_en, grade_category_id, grade_color');
	});

	test('updates translated fields inline and removes deleted rows', () => {
		const route = read('routes/update.js');
		const scripts = read('views/sub-views/scripts.ejs');
		const template = read('views/sub-views/hadith_metadata.ejs');
		const css = read('public/static/css/style.css');
		expect(scripts).toContain('if (resBody.fields)');
		expect(scripts).toContain("propStr === 'hdith_grade.add'");
		expect(scripts).toContain("propStr === 'hdith_grade.delete'");
		expect(scripts).toContain("propStr === 'hdith_sharh.add'");
		expect(scripts).toContain('Enter the Arabic Sharh book title. You may reuse an existing title:');
		expect(scripts).toContain("propStr === 'hdith_sharh.delete'");
		expect(scripts).toContain("propStr === 'hdith_sharh.import_dorar'");
		expect(scripts).toContain("editHadithApiPath('/autocomplete/sharh-titles')");
		expect(scripts).toContain("editHadithApiPath('/autocomplete/bilingual-pairs')");
		expect(scripts).toContain("prop: 'hdith_pair.save'");
		expect(template).toContain('data-hadith-pair-manager-open="narrator"');
		expect(template).toContain('data-hadith-pair-manager-open="sharh_title"');
		expect(template).toContain('data-hadith-pair-manager-open="attribution"');
		expect(template).toContain('data-hadith-pair-manager-open="chain_classification"');
		expect(template).toContain('data-hadith-pair-manager-open="grader"');
		expect(template).toContain('data-hadith-pair-manager-open="grade"');
		expect(template).toContain('data-bilingual-pair-type="grader"');
		expect(template).not.toContain('data-bilingual-pair-type="grade"');
		expect(template).toContain('data-hadith-pair-manager-filter');
		expect(scripts).toContain("limit: '100'");
		expect(scripts).toContain('bindBilingualMetadataAutocomplete($el)');
		expect(scripts).toContain("pairedBilingualValue: ($el.attr('data-paired-bilingual-value')");
		expect(scripts).toContain('pairedBilingualValue: reqBody.pairedBilingualValue');
		expect(route).toContain('var pairedBilingualColumn =');
		expect(scripts).toContain("prop: 'hdith_sharh.reorder'");
		expect(scripts).toContain("$el.closest('.hadith-grade-opinion').remove()");
		expect(scripts).toContain("prop: 'hdith_grade.reorder'");
		expect(scripts).toContain("this.addEventListener('dragover'");
		expect(template).toContain('hadith-grade-color-editor');
		expect(template).toContain('data-hdith-grade-color-indicator');
		expect(template).toContain('><%= colorOption.label %></option>');
		expect(css).toContain('.hadith-grade-color-select { border: 0; cursor: pointer;');
		expect(css).toContain('opacity: 0;');
		expect(css).toContain('.hadith-grade-color-indicator { background: var(--hadith-grade-color);');
		expect(css).toContain('.hadith-grade-opinion-en { font-size: var(--content-size-meta);');
		expect(css).toContain('.hadith-sharh-column:lang(en) .hadith-sharh-body');
		expect(css).toContain('.hadith-sharh-entry-heading > [lang="en"] { direction: ltr; text-align: left; }');
		expect(css).toContain('.hadith-sharh-column:lang(en) .hadith-sharh-more { font-size: calc(.9rem * var(--content-font-scale)) !important; }');
		expect(css).toContain('.hadith-sharh-column:lang(en) .hadith-sharh-more { direction: ltr; left: auto; right: 0; text-align: right; }');
		expect(css).toContain('.hadith-sharh-entry-heading > [lang="en"] h4 { font-size: calc(.95rem * var(--content-font-scale)) !important; }');
		expect(css).toContain('.hadith-scholarly-grade-actions .bi { font-size: .68rem !important;');
	});
});
