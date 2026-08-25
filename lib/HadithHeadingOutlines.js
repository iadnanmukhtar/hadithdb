'use strict';

const Index = require('./Index');
const { Heading } = require('./Model');
const Utils = require('./Utils');

const PAGE_SIZE = 500;
const HEADING_FIELDS = [
	'ordinal', 'path', 'level', 'book_alias', 'h1', 'h2', 'h3',
	'title_en', 'title', 'h1_title_en', 'h1_title',
	'h2_title_en', 'h2_title', 'h3_title_en', 'h3_title'
];

function text(value) {
	return value === undefined || value === null ? '' : value.toString().trim();
}

function headingPath(value, fallback) {
	return Utils.canonicalHadithHeadingPath(text(value) || fallback);
}

function headingTitle(heading, level) {
	const english = text(heading[`h${level}_title_en`]) || text(heading.title_en);
	if (english)
		return { text: english, lang: 'en' };
	const arabic = text(heading[`h${level}_title`]) || text(heading.title);
	if (arabic)
		return { text: arabic, lang: 'ar' };
	return { text: level === 3 ? 'Subsection' : 'Section', lang: 'en' };
}

function h1NavigationItem(heading, bookAlias) {
	if (!heading || Number(heading.level) !== 1 || text(heading.book_alias) !== bookAlias)
		return null;
	const number = text(heading.h1);
	if (!number)
		return null;
	const title = headingTitle(heading, 1);
	return {
		number: number,
		title: title.text,
		titleLang: title.lang,
		path: headingPath(heading.path, `${bookAlias}/${number}`)
	};
}

function buildOutline(chapter, headings) {
	chapter = chapter || {};
	const bookAlias = text(chapter.book_alias || (chapter.book && chapter.book.alias));
	const chapterNumber = text(chapter.h1);
	if (!bookAlias || bookAlias === 'quran' || !chapterNumber)
		return null;

	const sections = [];
	const sectionsByNumber = new Map();
	(headings || []).forEach(function (heading) {
		if (Number(heading.level) !== 2)
			return;
		const sectionNumber = text(heading.h2);
		if (!sectionNumber || sectionsByNumber.has(sectionNumber))
			return;
		const title = headingTitle(heading, 2);
		const section = {
			key: `${bookAlias}:${chapterNumber}.${sectionNumber}`,
			level: 2,
			bookAlias: bookAlias,
			chapter: chapterNumber,
			section: sectionNumber,
			title: title.text,
			titleLang: title.lang,
			path: headingPath(heading.path, `${bookAlias}/${chapterNumber}/${sectionNumber}`),
			subsections: []
		};
		sectionsByNumber.set(sectionNumber, section);
		sections.push(section);
	});

	(headings || []).forEach(function (heading) {
		if (Number(heading.level) !== 3)
			return;
		const sectionNumber = text(heading.h2);
		const subsectionNumber = text(heading.h3);
		const section = sectionsByNumber.get(sectionNumber);
		if (!section || !subsectionNumber)
			return;
		const title = headingTitle(heading, 3);
		section.subsections.push({
			key: `${bookAlias}:${chapterNumber}.${sectionNumber}.${subsectionNumber}`,
			level: 3,
			bookAlias: bookAlias,
			chapter: chapterNumber,
			section: sectionNumber,
			subsection: subsectionNumber,
			title: title.text,
			titleLang: title.lang,
			path: headingPath(heading.path, `${bookAlias}/${chapterNumber}/${sectionNumber}/${subsectionNumber}`)
		});
	});

	return {
		key: `${bookAlias}:${chapterNumber}`,
		bookAlias: bookAlias,
		bookShortName: text(chapter.book_shortName_en || (chapter.book && (chapter.book.shortName_en || chapter.book.name_en)) || bookAlias),
		chapter: chapterNumber,
		nameEn: text(chapter.title_en || chapter.h1_title_en || chapter.title || chapter.h1_title),
		previousH1: h1NavigationItem(chapter.prev, bookAlias),
		nextH1: h1NavigationItem(chapter.next, bookAlias),
		sections: sections
	};
}

function buildFlatOutline(chapter, headings) {
	chapter = chapter || {};
	const book = chapter.book || {};
	const bookAlias = text(chapter.book_alias || book.alias);
	if (!bookAlias || bookAlias === 'quran')
		return null;

	const sections = [];
	const chaptersByNumber = new Set();
	(headings || []).forEach(function (heading) {
		if (Number(heading.level) !== 1)
			return;
		const chapterNumber = text(heading.h1);
		if (!chapterNumber || chaptersByNumber.has(chapterNumber))
			return;
		chaptersByNumber.add(chapterNumber);
		const title = headingTitle(heading, 1);
		const canonicalPath = headingPath(heading.path, `${bookAlias}/${chapterNumber}`);
		const pathParts = canonicalPath.split('/').filter(Boolean);
		const chapterKeyNumber = pathParts[pathParts.length - 1] || chapterNumber;
		sections.push({
			key: `${bookAlias}:${chapterKeyNumber}`,
			level: 1,
			bookAlias: bookAlias,
			chapter: chapterNumber,
			number: chapterNumber,
			section: chapterNumber,
			title: title.text,
			titleLang: title.lang,
			path: canonicalPath,
			subsections: []
		});
	});

	const currentIndex = sections.findIndex(function (section) {
		return text(section.chapter) === text(chapter.h1)
			|| (text(chapter.path) && section.path === headingPath(chapter.path, ''));
	});
	return {
		key: `${bookAlias}:flat`,
		flat: true,
		bookAlias: bookAlias,
		chapter: '',
		nameEn: text(book.name_en || book.shortName_en || book.title_en || bookAlias),
		previousH1: currentIndex > 0 ? sections[currentIndex - 1] : null,
		nextH1: currentIndex >= 0 && currentIndex < sections.length - 1 ? sections[currentIndex + 1] : null,
		sections: sections
	};
}

async function headingsFromQuery(query, orderBy) {
	const headings = [];
	let offset = 0;
	let page;
	do {
		page = await Index.docsFromQueryFields(Heading.INDEX, query, HEADING_FIELDS, offset, PAGE_SIZE, orderBy);
		headings.push(...page);
		offset += page.length;
	} while (page.length === PAGE_SIZE);
	return headings;
}

async function forChapter(chapter) {
	const bookAlias = text(chapter && (chapter.book_alias || (chapter.book && chapter.book.alias)));
	const chapterNumber = text(chapter && chapter.h1);
	if (!bookAlias || bookAlias === 'quran' || !chapterNumber)
		return {};

	const numericChapter = Number(chapterNumber);
	const query = {
		bool: {
			filter: [
				{ term: { book_alias: bookAlias } },
				{ term: { h1: Number.isFinite(numericChapter) ? numericChapter : chapterNumber } },
				{ terms: { level: [2, 3] } }
			]
		}
	};
	const headings = await headingsFromQuery(query, 'h2, h3, ordinal');
	const outline = buildOutline(chapter, headings);
	if (outline && outline.sections.length > 0)
		return { [outline.key]: outline };

	const flatHeadings = await headingsFromQuery({
		bool: {
			filter: [
				{ term: { book_alias: bookAlias } },
				{ term: { level: 1 } }
			]
		}
	}, 'h1, ordinal');
	const flatOutline = buildFlatOutline(chapter, flatHeadings);
	return flatOutline && flatOutline.sections.length > 0 ? { [flatOutline.key]: flatOutline } : {};
}

module.exports = { buildOutline, buildFlatOutline, forChapter };
