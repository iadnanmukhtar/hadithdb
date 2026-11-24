'use strict';

const path = require('path');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
const Arabic = require('../lib/Arabic');

const template = path.join(__dirname, '..', 'views', 'sub-views', 'chapterTitle.ejs');

async function renderHadithChapterTitle({ sectionNumber = 1, introEn = '', introAr = '', editMode = false } = {}) {
	const book = {
		alias: 'bukhari',
		name_en: 'Sahih al-Bukhari',
		shortName_en: 'Bukhari',
		title: 'صحيح البخاري',
		shortName: 'البخاري'
	};
	const chapter = {
		id: 41,
		h1: 1,
		level: 1,
		path: 'bukhari/1',
		title_en: 'Revelation',
		title: 'بدء الوحي',
		intro_en: introEn,
		intro: introAr,
		book
	};
	chapter.sections = [1, 2].map(h2 => ({
		id: 41 + h2,
		h1: 1,
		h2,
		level: 2,
		path: `bukhari/1/${h2}`,
		chapter,
		book
	}));
	const section = chapter.sections.find(candidate => candidate.h2 === sectionNumber);

	return ejs.renderFile(template, {
		page: { context: { book, chapter, section }, menu: 'Section' },
		site: { editMode },
		req: {},
		Tafsir: { renderCommentaryText: value => value ? `<p>${value}</p>` : '' },
		utils: {
			trimToEmpty: value => (value || '').trim(),
			notebookIntroTitle: require('../lib/NotebookIntro').title,
			emptyIfNull: value => value || '',
			markdownToHtml: value => value ? `<p>${value}</p>` : '',
			urlFor: (_req, href) => href
		},
		arabic: Arabic
	});
}

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
		Tafsir: { renderCommentaryText: value => value ? `<p>${value}</p>` : '' },
		utils: {
			trimToEmpty: value => (value || '').trim(),
			notebookIntroTitle: require('../lib/NotebookIntro').title,
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

test('renders the chapter intro on the first section reached by the chapter redirect', async () => {
	const html = await renderHadithChapterTitle({
		introEn: 'Chapter introduction',
		introAr: 'مقدمة الكتاب'
	});

	expect(html).toContain('class="chapter-intro row mt-2"');
	expect(html).toContain('<p>Chapter introduction</p>');
	expect(html).toContain('<p>مقدمة الكتاب</p>');
	expect(html).toContain('data-id="41" data-prop="toc.intro_en"');
	expect(html).toContain('data-id="41" data-prop="toc.intro"');
});

test('keeps an empty chapter intro editable on the first section only', async () => {
	const firstSectionHtml = await renderHadithChapterTitle({ editMode: true });
	const laterSectionHtml = await renderHadithChapterTitle({ sectionNumber: 2, editMode: true });

	expect(firstSectionHtml).toContain('class="chapter-intro row mt-2"');
	expect(firstSectionHtml).toContain('data-id="41" data-prop="toc.intro_en"');
	expect(firstSectionHtml).toContain('data-markdown-empty-html="&hellip;"');
	expect(laterSectionHtml).not.toContain('class="chapter-intro row mt-2"');
});

test('uses the full row for a one-language chapter intro but shows both editors in Edit mode', async () => {
	const publicHtml = await renderHadithChapterTitle({ introEn: 'English only' });
	const editHtml = await renderHadithChapterTitle({ introEn: 'English only', editMode: true });

	expect(JSDOM.fragment(publicHtml).querySelector('.chapter-intro ._e.col-12.intro[lang="en"]')).not.toBeNull();
	expect(publicHtml).not.toMatch(/class="chapter-intro[\s\S]*data-prop="toc\.intro"/);
	expect(JSDOM.fragment(editHtml).querySelector('.chapter-intro ._e.col-md-6.col-sm-12.intro[lang="en"]')).not.toBeNull();
	expect(editHtml).toContain('lang="ar" data-id="41" data-prop="toc.intro"');
});

test.each([[0, '/bukhari/1'], [2, '/bukhari/1/2']])('links the final English and Arabic breadcrumb for section %s', async (sectionNumber, href) => {
	const dom = JSDOM.fragment(await renderHadithChapterTitle({ sectionNumber }));
	const links = [...dom.querySelectorAll('.breadcrumbs > div')].map(row => row.lastElementChild.getAttribute('href'));
	expect(links).toEqual([href, href]);
});
