'use strict';

const path = require('path');
const fs = require('fs');
const ejs = require('ejs');
const Arabic = require('../lib/Arabic');
const Utils = require('../lib/Utils');

const template = path.join(__dirname, '..', 'views', 'sub-views', 'heading.ejs');

function render(editMode) {
	const book = { alias: 'quran' };
	const chapter = { h1: 2 };
	const heading = {
		id: 72, level: 2, h1: 2, h2: 1, path: 'quran/2/1',
		title_en: 'Guidance', title: 'الهداية', intro_en: 'English passage introduction', intro: ''
	};
	return ejs.renderFile(template, {
		page: { context: { book, chapter, section: heading }, menu: 'Section' },
		site: { editMode },
		req: {},
		utils: Utils,
		arabic: Arabic,
		heading,
		headingEnglishOnly: true
	});
}

test('uses the full passage-intro row publicly and exposes Arabic authoring in Edit mode', async () => {
	const publicHtml = await render(false);
	const editHtml = await render(true);

	expect(publicHtml).toContain('class="_e col-12 intro" lang="en"');
	expect(publicHtml).not.toContain('data-prop="toc.intro"');
	expect(editHtml).toContain('class="_e col-md-6 col-sm-12 intro" lang="en"');
	expect(editHtml).toContain('lang="ar" data-id="72" data-prop="toc.intro"');
	expect(editHtml).toContain('data-markdown-empty-html="&hellip;"');
});

test('does not indent introduction text', () => {
	const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'css', 'style.css'), 'utf8');
	expect(css).toMatch(/\.intro,\s*\.heading-intro\s*\{\s*text-indent: 0;/);
});
