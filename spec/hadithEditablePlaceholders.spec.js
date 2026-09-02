'use strict';

const fs = require('fs');
const path = require('path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('Hadith detail editable placeholders', () => {
	test('uses labeled placeholders instead of standalone ellipses', () => {
		const templates = [
			read('views/sub-views/hadith.ejs'),
			read('views/sub-views/hadith_item.ejs'),
			read('views/sub-views/hadith_metadata.ejs')
		].join('\n');
		[
			'English hadith title', 'عنوان الحديث', 'اسم المجموعة',
			'Highlight date', 'Internal reference', 'Hadith number',
			'English book title', 'English explanation', 'نص الشرح'
		].forEach(label => expect(templates).toContain(label));
		expect(templates).not.toMatch(/&hellip;|&#x2026;|…/);
	});

	test('labels chain, body, footnote, and note editors by language', () => {
		const item = read('views/sub-views/hadith_item.ejs');
		expect(item).toContain("placeholder: editPlaceholder('chain')");
		expect(item).toContain("placeholder: editPlaceholder('body')");
		expect(item).toContain("placeholder: editPlaceholder('footnote')");
		expect(item).toContain("data-placeholder=\"<%= editPlaceholder('note') %>\"");
	});
});
