'use strict';

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const searchRouter = require('../routes/search');
const CommentaryHeadings = require('../lib/CommentaryHeadings');
const Index = require('../lib/Index');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');

function introductionHandler() {
	const layer = searchRouter.stack.find(item => item.route && item.route.path === '/:bookAlias/introduction');
	return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('Hadith book introductions', () => {
	const book = {
		id: 2,
		alias: 'muslim',
		type: 'hadith',
		hidden: 0,
		shortName_en: 'Sahih Muslim',
		shortName: 'صحيح مسلم',
		name_en: 'Sahih Muslim',
		title: 'صحيح مسلم',
		lang: 'ar-en'
	};

	beforeEach(() => {
		global.books = [book];
	});

	afterEach(() => {
		jest.restoreAllMocks();
		delete global.books;
		delete global.query;
	});

	test('renders the friendly introduction route for an authored article', async () => {
		const article = { id: 91, h1: 0, h2: 1, title_en: 'Foreword', intro_en: 'Text' };
		jest.spyOn(CommentaryHeadings, 'introductionArticles').mockResolvedValue([article]);
		jest.spyOn(Index, 'docsFromQueryString')
			.mockResolvedValueOnce([{ path: 'muslim/1/1', title_en: 'Faith' }])
			.mockResolvedValueOnce([{ path: 'muslim/56/8', title_en: 'Paradise' }]);
		const req = { params: { bookAlias: 'muslim' }, admin: false, editMode: false };
		const res = { locals: {}, render: jest.fn() };

		await introductionHandler()(req, res, jest.fn());

		expect(res.render).toHaveBeenCalledWith('hadith_introduction', expect.objectContaining({
			book: book,
			introductionArticles: [article],
			nextHeading: expect.objectContaining({ path: 'muslim/1/1' }),
			previousHeading: expect.objectContaining({ path: 'muslim/56/8' })
		}));
	});

	test('allows an admin in Edit mode to open an empty introduction page', async () => {
		jest.spyOn(CommentaryHeadings, 'introductionArticles').mockResolvedValue([]);
		jest.spyOn(Index, 'docsFromQueryString').mockResolvedValue([]);
		const req = { params: { bookAlias: 'muslim' }, admin: true, editMode: true };
		const res = { locals: {}, render: jest.fn() };
		const next = jest.fn();

		await introductionHandler()(req, res, next);

		expect(next).not.toHaveBeenCalled();
		expect(res.render).toHaveBeenCalledWith('hadith_introduction', expect.objectContaining({ introductionArticles: [] }));
	});

	test('returns 404 for an empty public introduction page', async () => {
		jest.spyOn(CommentaryHeadings, 'introductionArticles').mockResolvedValue([]);
		const req = { params: { bookAlias: 'muslim' }, admin: false, editMode: false };
		const res = { locals: {}, render: jest.fn() };
		const next = jest.fn();

		await introductionHandler()(req, res, next);

		expect(res.render).not.toHaveBeenCalled();
		expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }));
	});

	test('creates the hidden chapter 0 and its first article for a Hadith book', async () => {
		global.query = jest.fn(async query => {
			if (/FROM books/.test(query))
				return [book];
			if (/SELECT \* FROM toc/.test(query))
				return [];
			if (/INSERT INTO toc[\s\S]*level, h1[\s\S]*VALUES \(0, 2, 1, 0/.test(query))
				return { insertId: 90, message: 'created chapter' };
			if (/INSERT INTO toc[\s\S]*VALUES \(1, 2, 2, 0, 1/.test(query))
				return { insertId: 91, message: 'created article' };
			return [];
		});

		const result = await CommentaryHeadings.addIntroductionArticle(2, { title_en: 'Foreword' }, 'admin');

		expect(result.value).toMatchObject({ id: 91, chapterId: 90, h1: 0, h2: 1, title_en: 'Foreword' });
		expect(global.query.mock.calls.some(call => call[0].includes("'Introduction', 'المقدمة'"))).toBe(true);
	});

	test('uses the shared editable article and add endpoint contracts', () => {
		const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'hadith_introduction.ejs'), 'utf8');
		expect(template).toContain("include('sub-views/quran_commentary_article.ejs'");
		expect(template).toContain("include('sub-views/quran_commentary_introduction_rail.ejs'");
		expect(template).toContain('quran-heading-layout quran-heading-layout-tafsir hadith-introduction-layout');
		expect(template).toContain("introductionRailNextKind: 'section'");
		expect(template).toContain('data-reader-infinite="hadith-section"');
		expect(template).toContain('data-reader-starts-introduction="1"');
		expect(template).toContain('data-reader-next-url=');
		expect(template).toContain('introductionRailHadith: true');
		expect(template).toContain('data-add-introduction-article');
		expect(template).toContain('toc.commentaryArticleAdd');
		expect(template).toContain('var introductionPath = `${bookPath}/introduction`');
	});

	test('uses the Tafsir introduction prefetch boundary and delays the Hadith rail transition', () => {
		const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');
		expect(script).toContain("var startsAtReaderIntroduction = startsAtTafsirIntroduction || main.attr('data-reader-starts-introduction') === '1';");
		expect(script).toContain("var prefetchAhead = startsAtReaderIntroduction ? 2 : (mode === 'tafsir' ? 1 : 3);");
		expect(script).toContain("document.querySelector('[data-reader-infinite^=\"hadith-\"][data-reader-starts-introduction=\"1\"]')");
	});

	test('always exposes English title and text fields in Hadith Edit mode', async () => {
		const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'sub-views', 'quran_commentary_article.ejs'), {
			Tafsir: Tafsir,
			utils: Utils,
			site: { editMode: true },
			commentaryBook: { ...book, lang: 'ar' },
			introductionBilingual: true,
			article: { id: 91, h1: 0, h2: 1, title: 'المقدمة', title_en: '', intro: 'نص المقدمة', intro_en: '' }
		});

		expect(html).toContain('lang="en"><span class="_e" data-id="91" data-prop="toc.title_en"');
		expect(html).toContain('lang="en" data-id="91" data-prop="toc.intro_en"');
		expect(html).toContain('lang="ar" dir="rtl" data-id="91" data-prop="toc.intro"');
	});

	test('keeps the Hadith TOC introduction controls and rows on the friendly route', () => {
		const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'toc.ejs'), 'utf8');
		expect(template).toContain('Manage introduction articles');
		expect(template).toContain('hadith-introduction-link-row');
		expect(template).toContain('hadithIntroductionHref');
	});
});
