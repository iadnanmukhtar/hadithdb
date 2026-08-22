'use strict';

const path = require('path');
const ejs = require('ejs');
const HadithHeadingOutlines = require('../lib/HadithHeadingOutlines');
const Index = require('../lib/Index');
const { Heading } = require('../lib/Model');

const template = path.join(__dirname, '..', 'views', 'sub-views', 'hadith_heading_toc.ejs');
const headingTemplate = path.join(__dirname, '..', 'views', 'sub-views', 'heading.ejs');

function render(outlines, options = {}) {
	return ejs.renderFile(template, {
		hadithHeadingOutlines: outlines,
		hadithHeadingInitialContext: options.context,
		hadithHeadingInitialKey: options.key,
		req: {},
		utils: {
			urlFor: (_req, href) => href
		}
	});
}

function renderHeading(continued, level = 2) {
	const book = { alias: 'ibnhibban' };
	const chapter = { h1: 3 };
	return ejs.renderFile(headingTemplate, {
		heading: { id: 1, level, h1: 3, h2: 2, h3: level === 3 ? 8 : undefined, path: level === 3 ? 'ibnhibban/3/2/8' : 'ibnhibban/3/2', title_en: 'Knowledge', title: '' },
		page: { menu: 'Section', context: { book, chapter, continued } },
		site: { editMode: false },
		req: {},
		utils: {
			emptyIfNull: value => value || '',
			markdownToHtml: value => value || '',
			urlFor: (_req, href) => href
		},
		arabic: { toArabicDigits: value => value }
	});
}

describe('Hadith heading rail', () => {
	const originalQuery = global.query;

	afterEach(() => {
		jest.restoreAllMocks();
		global.query = originalQuery;
	});

	const outline = HadithHeadingOutlines.buildOutline({
		book_alias: 'bukhari',
		book: { shortName_en: 'Sahih al-Bukhari' },
		h1: 1,
		title_en: 'Revelation'
	}, [{
		level: 2,
		h1: 1,
		h2: 1,
		h2_title_en: 'How the Divine Revelation started',
		path: 'bukhari/1/1'
	}, {
		level: 3,
		h1: 1,
		h2: 1,
		h3: 1,
		h3_title_en: 'The beginning of revelation',
		path: 'bukhari/1/1/1'
	}, {
		level: 2,
		h1: 1,
		h2: 2,
		h2_title: 'باب عربي',
		path: 'bukhari/1/2'
	}, {
		level: 3,
		h1: 1,
		h2: 2,
		h3: 1,
		h3_title: 'عنوان فرعي',
		path: 'bukhari/1/2/1'
	}]);

	test('uses natural-case chapter text, section-only numbers, and unnumbered subsections', async () => {
		const html = await render({ [outline.key]: outline }, {
			context: outline.key,
			key: 'bukhari:1.1.1'
		});

		expect(html).toContain('data-hadith-heading-toc');
		expect(html).toContain('>SAHIH AL-BUKHARI</span>');
		expect(html).toContain('>1 Revelation</strong>');
		expect(html).not.toContain('>1 REVELATION</strong>');
		expect(html).toContain('>1 How the Divine Revelation started</a>');
		expect(html).toContain('>The beginning of revelation</a>');
		expect(html).not.toContain('1.1 How the Divine Revelation started');
		expect(html).not.toContain('1.1.1 The beginning of revelation');
		expect(html).toContain('href="/bukhari/1/1/1"');
		expect(html).toMatch(/data-hadith-heading-key="bukhari:1\.1\.1"[^>]*aria-current="location"/);
		expect(html).toMatch(/data-hadith-heading-key="bukhari:1\.2"[^>]*lang="ar" dir="rtl"[^>]*>2 باب عربي<\/a>/);
		expect(html).toMatch(/data-hadith-heading-key="bukhari:1\.2\.1"[^>]*lang="ar" dir="rtl"[^>]*>عنوان فرعي<\/a>/);
		expect(outline.sections[1].titleLang).toBe('ar');
		expect(outline.sections[1].subsections[0].titleLang).toBe('ar');
	});

	test('keeps serialized outlines inert and omits an empty rail', async () => {
		const unsafe = JSON.parse(JSON.stringify(outline));
		unsafe.nameEn = '</script><script>alert(1)</script>';
		const html = await render({ [unsafe.key]: unsafe }, { context: unsafe.key });

		expect(html).toContain('\\u003c/script>\\u003cscript>alert(1)\\u003c/script>');
		expect((html.match(/<script/g) || [])).toHaveLength(1);
		expect(await render({})).not.toContain('data-hadith-heading-toc');
	});

	test('uses a virtual book name and its H1 chapters for a flat outline', async () => {
		const flatOutline = HadithHeadingOutlines.buildFlatOutline({
			book: { alias: 'riyad', virtual: 1, name_en: 'Riyad al-Salihin' },
			h1: 0.07
		}, [{
			level: 1,
			h1: 0.06,
			h1_title_en: 'Piety',
			path: 'riyad/0.06'
		}, {
			level: 1,
			h1: 0.07,
			h1_title_en: 'Certainty and Trust in Allah',
			path: 'riyad/0.07'
		}]);
		const html = await render({ [flatOutline.key]: flatOutline }, {
			context: flatOutline.key,
			key: 'riyad:0.07'
		});

		expect(flatOutline.flat).toBe(true);
		expect(html).toContain('>Riyad al-Salihin</strong>');
		expect(html).toContain('>0.06 Piety</a>');
		expect(html).toContain('>0.07 Certainty and Trust in Allah</a>');
		expect(html).toMatch(/data-hadith-heading-key="riyad:0\.07"[^>]*aria-current="location"/);
		expect(flatOutline.sections[1].key).toBe('riyad:0.07');
	});

	test('does not let a continued parent section replace the active subsection', async () => {
		const section = await renderHeading(false);
		const subsection = await renderHeading(false, 3);
		expect(section).toContain('data-hadith-heading-target');
		expect(section).toContain('data-hadith-heading-level="2"');
		expect(subsection).toContain('data-hadith-heading-level="3"');
		expect(subsection).toContain('data-hadith-heading-parent-key="ibnhibban:3.2"');
		expect(await renderHeading(true)).not.toContain('data-hadith-heading-target');
	});

	test('loads chapter rail headings from Elasticsearch without querying the DB', async () => {
		global.query = jest.fn(() => {
			throw new Error('Hadith heading rails must not query the DB');
		});
		const search = jest.spyOn(Index, 'docsFromQueryFields').mockResolvedValue([{
			ordinal: 1,
			level: 2,
			book_alias: 'bukhari',
			h1: 1,
			h2: 1,
			h2_title_en: 'How the Divine Revelation started',
			path: 'bukhari/1/1'
		}]);

		await expect(HadithHeadingOutlines.forChapter({
			book_alias: 'bukhari',
			h1: 1,
			title_en: 'Revelation'
		})).resolves.toHaveProperty('bukhari:1');

		expect(search).toHaveBeenCalledWith(
			Heading.INDEX,
			expect.objectContaining({
				bool: {
					filter: [
						{ term: { book_alias: 'bukhari' } },
						{ term: { h1: 1 } },
						{ terms: { level: [2, 3] } }
					]
				}
			}),
			expect.any(Array),
			0,
			500,
			'ordinal'
		);
		expect(global.query).not.toHaveBeenCalled();
	});

	test('loads virtual-book chapter rails from Elasticsearch without querying the DB', async () => {
		global.query = jest.fn(() => {
			throw new Error('Virtual Hadith heading rails must not query the DB');
		});
		const search = jest.spyOn(Index, 'docsFromQueryFields')
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{
				ordinal: 1,
				level: 1,
				book_alias: 'riyad',
				h1: 0.07,
				h1_title_en: 'Certainty and Trust in Allah',
				path: 'riyad/0.07'
			}]);

		await expect(HadithHeadingOutlines.forChapter({
			book_alias: 'riyad',
			h1: 0.07,
			book: { alias: 'riyad', virtual: 1, name_en: 'Riyad al-Salihin' }
		})).resolves.toHaveProperty('riyad:flat');

		expect(search).toHaveBeenCalledTimes(2);
		expect(search.mock.calls[1][0]).toBe(Heading.INDEX);
		expect(search.mock.calls[1][1]).toEqual({
			bool: {
				filter: [
					{ term: { book_alias: 'riyad' } },
					{ term: { level: 1 } }
				]
			}
		});
		expect(global.query).not.toHaveBeenCalled();
	});
});
