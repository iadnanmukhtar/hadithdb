'use strict';

const path = require('path');
const ejs = require('ejs');
const Arabic = require('../lib/Arabic');

const template = path.join(__dirname, '..', 'views', 'sub-views', 'chapterTitle.ejs');

test('omits legacy page numbers from English and Arabic chapter headings', async () => {
	const book = {
		alias: 'ahmad',
		name_en: 'Musnad Ahmad',
		shortName_en: 'Ahmad',
		title: 'مسند أحمد',
		shortName: 'أحمد'
	};
	const chapter = {
		id: 15,
		h1: 15.01,
		level: 1,
		path: 'ahmad/15.01',
		title_en: 'The Musnad of Abu Bakr',
		title: 'مسند أبي بكر',
		count: 60,
		page: { number: 2, hasNext: true },
		book
	};

	const html = await ejs.renderFile(template, {
		page: { context: { book, chapter }, menu: 'Chapter' },
		site: { editMode: false },
		req: {},
		utils: {
			emptyIfNull: value => value || '',
			markdownToHtml: value => value || '',
			urlFor: (_req, href) => href
		},
		arabic: Arabic
	});

	expect(html).toContain('The Musnad of Abu Bakr');
	expect(html).toContain('مسند أبي بكر');
	expect(html).not.toContain('(2/3)');
	expect(html).not.toContain('ص ٢');
});
