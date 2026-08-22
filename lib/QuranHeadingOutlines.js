'use strict';

const Index = require('./Index');
const { Heading } = require('./Model');
const Surahs = require('./Surahs');

const PAGE_SIZE = 500;
const HEADING_FIELDS = [
	'ordinal', 'level', 'book_alias', 'h1', 'h2', 'h3',
	'title_en', 'title', 'start', 'count',
	'h2_title_en', 'h2_title', 'h2_start', 'h2_count',
	'h3_title_en', 'h3_title', 'h3_start', 'h3_count'
];

function text(value) {
	return value === undefined || value === null ? '' : value.toString().trim();
}

function headingTitle(heading, level) {
	return text(heading[`h${level}_title_en`]) || text(heading.title_en) ||
		text(heading[`h${level}_title`]) || text(heading.title);
}

function headingRange(heading, level) {
	const startValue = heading[`h${level}_start`] ?? heading.start;
	const startParts = text(startValue).split(':').map(Number);
	const count = Number(heading[`h${level}_count`] ?? heading.count);
	if (startParts.length !== 2 || !Number.isInteger(startParts[0]) ||
		!Number.isInteger(startParts[1]) || !Number.isInteger(count) || count <= 0)
		return null;
	return {
		surah: startParts[0],
		start: startParts[1],
		end: startParts[1] + count - 1
	};
}

function h1NavigationItem(surah) {
	const info = Surahs.find(surah) || (global.surahs || []).find(function (item) {
		return Number(item.num) === Number(surah);
	});
	return info ? {
		number: Number(info.num),
		title: info.name_en || '',
		titleAr: info.name_ar || ''
	} : null;
}

async function headingsForSurahs(surahNumbers) {
	const headings = [];
	let offset = 0;
	let page;
	const query = {
		bool: {
			filter: [
				{ term: { book_alias: 'quran' } },
				{ terms: { h1: surahNumbers } },
				{ terms: { level: [2, 3] } }
			]
		}
	};
	do {
		page = await Index.docsFromQueryFields(
			Heading.INDEX, query, HEADING_FIELDS, offset, PAGE_SIZE, 'ordinal');
		headings.push(...page);
		offset += page.length;
	} while (page.length === PAGE_SIZE);
	return headings;
}

function buildOutlines(surahNumbers, headings) {
	const outlines = {};
	const sectionsBySurah = new Map();
	const requestedSurahs = new Set(surahNumbers);

	surahNumbers.forEach(function (surah) {
		const surahInfo = Surahs.find(surah) || (global.surahs || []).find(function (item) {
			return Number(item.num) === surah;
		}) || {};
		outlines[surah] = {
			surah: surah,
			nameEn: surahInfo.name_en || '',
			nameAr: surahInfo.name_ar || '',
			previousH1: h1NavigationItem(surah - 1),
			nextH1: h1NavigationItem(surah + 1),
			sections: []
		};
		sectionsBySurah.set(surah, new Map());
	});

	(headings || []).forEach(function (heading) {
		if (Number(heading.level) !== 2)
			return;
		const range = headingRange(heading, 2);
		const surah = Number(heading.h1);
		const sectionNumber = Number(heading.h2);
		if (!range || range.surah !== surah || !requestedSurahs.has(surah) ||
			!Number.isInteger(sectionNumber) || sectionNumber <= 0)
			return;
		const sectionsByNumber = sectionsBySurah.get(surah);
		if (sectionsByNumber.has(sectionNumber))
			return;
		const section = {
			key: `${surah}.${sectionNumber}`,
			level: 2,
			surah: surah,
			section: sectionNumber,
			title: headingTitle(heading, 2) || `Passage ${sectionNumber}`,
			start: range.start,
			end: range.end,
			subsections: []
		};
		sectionsByNumber.set(sectionNumber, section);
		outlines[surah].sections.push(section);
	});

	(headings || []).forEach(function (heading) {
		if (Number(heading.level) !== 3)
			return;
		const range = headingRange(heading, 3);
		const surah = Number(heading.h1);
		const sectionNumber = Number(heading.h2);
		const subsectionNumber = Number(heading.h3);
		const section = sectionsBySurah.get(surah)?.get(sectionNumber);
		if (!range || range.surah !== surah || !section ||
			!Number.isInteger(subsectionNumber) || subsectionNumber <= 0)
			return;
		section.subsections.push({
			key: `${surah}.${sectionNumber}.${subsectionNumber}`,
			level: 3,
			surah: surah,
			section: sectionNumber,
			subsection: subsectionNumber,
			title: headingTitle(heading, 3) || `Subsection ${subsectionNumber}`,
			start: range.start,
			end: range.end
		});
	});

	return outlines;
}

async function forSurahs(surahNumbers) {
	const uniqueSurahs = Array.from(new Set((surahNumbers || []).map(Number).filter(function (surah) {
		return Number.isInteger(surah) && surah >= 1 && surah <= 114;
	})));
	if (uniqueSurahs.length < 1)
		return {};

	return buildOutlines(uniqueSurahs, await headingsForSurahs(uniqueSurahs));
}

module.exports = { buildOutlines, forSurahs };
