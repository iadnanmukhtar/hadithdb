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
		expect(template).toContain('class="_e hadith-scholarly-grader-value"');
		expect(template).not.toContain('data-prop="hdith_grade.grade_en" value=');
		expect(template).not.toContain('bi-box-arrow-up-right');
	});

	test('renders and manages custom Sharh in Arabic and English columns', () => {
		const route = read('routes/update.js');
		const template = read('views/sub-views/hadith_metadata.ejs');
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
		expect(template).toContain('data-placeholder="English book title"');
		expect(template).toContain('data-placeholder="عنوان كتاب الشرح"');
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
		expect(route).not.toContain('UPDATE hdith_sharh_sources SET ${col}');
		expect(template).toContain("if (entry.text_en)");
	});

	test('preserves translations and admin grades across enrichment imports', () => {
		const importer = read('bin/utils/import-hdith-six-books-enrichment.js');
		expect(importer).toContain("COALESCE(source_driver, '')<>'admin'");
		expect(importer).toContain('SELECT source_entry_id, text_en, title, title_en FROM hdith_hadith_sharh');
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
