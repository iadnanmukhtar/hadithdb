'use strict';

const path = require('path');
const ejs = require('ejs');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');
const CommentaryHeadings = require('../lib/CommentaryHeadings');

const articleTemplate = path.join(__dirname, '..', 'views', 'sub-views', 'quran_commentary_article.ejs');
const surahTemplate = path.join(__dirname, '..', 'views', 'sub-views', 'quran_commentary_heading_intro.ejs');
const pageTemplate = path.join(__dirname, '..', 'views', 'quran_commentary_introduction.ejs');
const railTemplate = path.join(__dirname, '..', 'views', 'sub-views', 'quran_commentary_introduction_rail.ejs');
const shared = { Tafsir, utils: Utils, commentaryBook: { id: 71, type: 'tafsir', lang: 'ar-en' } };

test('renders a Surah 0 H2 as a bilingual introductory article', async () => {
	const html = await ejs.renderFile(articleTemplate, {
		...shared,
		site: { editMode: false },
		article: { id: 91, h1: 0, h2: 1, title_en: 'Foreword', title: 'تقديم', intro_en: 'A **work** introduction.', intro: 'مقدمة **الكتاب**.' }
	});
	expect(html).toContain('data-introduction-article="1"');
	expect(html).toContain('Foreword');
	expect(html).toContain('<strong>work</strong>');
	expect(html).toContain('<strong>الكتاب</strong>');
	expect(html).toContain('data-prop="toc.intro_en"');
	expect(html).toContain('<details class="quran-commentary-introduction-disclosure">');
	expect(html).toMatch(/<summary>\s*<heading class="row heading py-2">/);
	expect(html).not.toContain('Read article');
	expect(html).not.toContain('Collapse article');
	expect(html).not.toContain('<details class="quran-commentary-introduction-disclosure" open>');
});

test('renders a commentary surah H1 introduction with the Hadith chapter-intro contract', async () => {
	const html = await ejs.renderFile(surahTemplate, {
		...shared,
		site: { editMode: true },
		heading: { id: 92, h1: 2, intro_en: '', intro: '' }
	});
	expect(html).toContain('class="chapter-intro row mt-2 quran-commentary-heading-intro"');
	expect(html).toContain('data-id="92" data-prop="toc.intro_en"');
	expect(html).toContain('data-id="92" data-prop="toc.intro"');
});

test('renders Arabic-only paragraphs in English commentary introductions with Tafsir Arabic typography metadata', async () => {
	const intro = 'An English paragraph.\n\n«لَا تَجْعَلُوا بُيُوتَكُمْ قُبُورًا»';
	const surahHtml = await ejs.renderFile(surahTemplate, {
		...shared,
		site: { editMode: false },
		heading: { id: 94, h1: 2, intro_en: intro, intro: '' }
	});
	const articleHtml = await ejs.renderFile(articleTemplate, {
		...shared,
		site: { editMode: false },
		article: { id: 95, h1: 0, h2: 1, title_en: 'Foreword', intro_en: intro, intro: '' }
	});

	for (const html of [surahHtml, articleHtml]) {
		expect(html).toContain('data-prop="toc.intro_en"');
		expect(html).toContain('<p>An English paragraph.</p>');
		expect(html).toContain('<p class="quran-tafsir-arabic-only" lang="ar" dir="rtl">«لَا تَجْعَلُوا بُيُوتَكُمْ قُبُورًا»</p>');
		expect(html).not.toContain('<p class="quran-tafsir-arabic-only" lang="ar" dir="rtl">An English paragraph.</p>');
	}
});

test('distinguishes escaped literal backticks from Tafsir formatting backticks', () => {
	const rendered = Tafsir.renderEnglishCommentaryMarkdown('Ubayy bin Ka\\`b said, `اقْرَأْ`.');

	expect(rendered).toContain('Ubayy bin Ka`b said,');
	expect(rendered).toContain('<span class="quran-tafsir-backtick quran-hafs" lang="ar" dir="rtl">اقْرَأْ</span>');
	expect(rendered).not.toContain('>b said,</span>');
});

test('gives a one-language article the full row and hides the empty language side', async () => {
	const html = await ejs.renderFile(articleTemplate, {
		...shared,
		site: { editMode: false },
		article: { id: 93, h1: 0, h2: 1, title_en: 'Foreword', title: 'المقدمة', intro_en: 'English only.', intro: '' }
	});
	expect(html).toContain('<h2 class="col-12 fs-5 title" lang="en">');
	expect(html).toContain('<section class="_e col-12 intro" lang="en"');
	expect(html).not.toContain('lang="ar"');
});

test('shows an empty Arabic side in Edit mode for authoring', async () => {
	const html = await ejs.renderFile(articleTemplate, {
		...shared,
		site: { editMode: true },
		article: { id: 93, h1: 0, h2: 1, title_en: 'Foreword', title: '', intro_en: 'English only.', intro: '' }
	});
	expect(html).toContain('<h2 class="col-md-6 col-sm-12 fs-5 title" lang="ar"');
	expect(html).toContain('lang="ar" dir="rtl" data-id="93" data-prop="toc.intro"');
	expect(html).toContain('data-markdown-empty-html="&hellip;"');
});

test('shows the first available surah as the introduction rail next heading', async () => {
	const html = await ejs.renderFile(railTemplate, {
		utils: Utils,
		req: {},
		commentaryBookPath: '/quran/tafsir/unal',
		commentaryNameEn: 'Tafsir Unal',
		commentaryIntroductionArticles: [{ h2: 1, title_en: 'Foreword', intro_en: 'Text' }],
		commentaryIntroductionNextH1: { number: 1, title: 'al-Fatihah', href: '/quran/tafsir/unal/1' },
		commentaryIntroductionPreviousPassage: { title: '§114.1-6', href: '/quran/tafsir/unal/quran:114:1-6' }
	});
	expect(html).toMatch(/data-quran-heading-h1-prev href="[^"]*\/quran\/tafsir\/unal\/quran:114:1-6" rel="prev"/);
	expect(html).toContain('>§114.1-6</a>');
	expect(html).toContain('data-quran-heading-toc-nav');
	expect(html).toMatch(/href="[^"]*\/quran\/tafsir\/unal\/1" rel="next"/);
	expect(html).toContain('>1 al-Fatihah</a>');
});

test('only counts introduction articles with body content', () => {
	expect(CommentaryHeadings.hasIntroduction([{ title_en: 'Empty', intro_en: '', intro: '' }])).toBe(false);
	expect(CommentaryHeadings.hasIntroduction([{ title_en: 'Foreword', intro_en: 'Text' }])).toBe(true);
});

test('uses the tafsir rail grid without collapsing the introduction content column', () => {
	const template = require('fs').readFileSync(pageTemplate, 'utf8');
	expect(template).toContain('quran-heading-layout quran-heading-layout-tafsir');
	expect(template).toContain('quran-heading-content quran-heading-content-tafsir');
	expect(template).not.toContain('container col-lg-8 mx-auto quran-heading-content');
});

test('makes Surah 0 introductions part of the tafsir infinite-reader sequence', () => {
	const fs = require('fs');
	const page = fs.readFileSync(pageTemplate, 'utf8');
	const article = fs.readFileSync(articleTemplate, 'utf8');
	const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');

	expect(page).toContain('data-reader-infinite="tafsir"');
	expect(page).toContain('data-reader-context-key="0"');
	expect(page).toContain('data-reader-next-url=');
	expect(article).toContain('data-quran-introduction-target=');
	expect(script).toContain("node.matches('.quran-commentary-introduction-article')");
	expect(script).toContain("node.matches('.quran-commentary-heading-intro')");
	expect(script).toContain('initQuranCommentaryIntroductionDisclosures();');
	expect(script).toContain("disclosure.open = true;");
	expect(script).toContain('main[data-reader-infinite="tafsir"][data-reader-context-key="0"]');
	expect(script).toContain('openDirectIntroductionDisclosure();');
	expect(script).toContain("var startsWithIntroduction = mode === 'tafsir'");
	expect(script).toContain("var startsAtTafsirIntroduction = mode === 'tafsir' && main.attr('data-reader-context-key') === '0';");
	expect(script).toContain("var prefetchAhead = mode === 'tafsir' ? (startsAtTafsirIntroduction ? 2 : 1) : 3;");
	expect(script).toMatch(/if \(!loaded \|\| pagesAhead\(\) >= prefetchAhead\) \{\s*ensuring = false;\s*window\.requestAnimationFrame\(scheduleInfiniteWork\);/);
});
