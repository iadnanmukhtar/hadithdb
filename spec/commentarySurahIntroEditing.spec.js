'use strict';

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const Utils = require('../lib/Utils');

const template = path.join(__dirname, '..', 'views', 'sub-views', 'quran_commentary_surah_intro.ejs');

function render(editMode, heading) {
	return ejs.renderFile(template, {
		site: { editMode },
		utils: Utils,
		heading,
		commentaryBook: { id: 42, lang: 'en' },
		surah: 1,
		Tafsir: require('../lib/Tafsir')
	});
}

describe('commentary surah introduction editing', () => {
	test('shows both empty language columns directly in Edit mode', async () => {
		const html = await render(true, { id: 72, h1: 1, intro_en: '', intro: '' });

		expect(html).toContain('class="_e col-md-6 col-sm-12 intro" lang="en"');
		expect(html).toContain('data-id="72" data-prop="toc.intro_en"');
		expect(html).toContain('class="_e col-md-6 col-sm-12 intro" lang="ar"');
		expect(html).toContain('data-id="72" data-prop="toc.intro"');
	});

	test('does not render empty columns outside Edit mode', async () => {
		expect(await render(false, { id: 72, h1: 1, intro_en: '', intro: '' })).not.toContain('chapter-intro');
	});

	test('has no separate add-surah-introduction control', () => {
		const source = fs.readFileSync(template, 'utf8');
		expect(source).not.toContain('data-add-surah-introduction');
		expect(source).not.toContain('commentarySurahEnsure');
	});

	test('preserves Arabic-only typography when an English introduction is previewed after editing', () => {
		const editor = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'scripts.ejs'), 'utf8');
		const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'css', 'style.css'), 'utf8');

		expect(editor).toContain("$el.attr('data-prop') === 'toc.intro_en'");
		expect(editor).toContain("$block.addClass('quran-tafsir-arabic-only').attr({ lang: 'ar', dir: 'rtl' })");
		expect(editor).toContain('isEnglishTafsirMarkdown($el) || isEnglishCommentaryIntroMarkdown($el)');
		expect(css).toMatch(/\[data-prop="toc\.intro_en"\] \.quran-tafsir-arabic-only \{[^}]*font-family: Hafs, Serif;[^}]*text-indent: 0;/s);
	});
});
