'use strict';

const AdmZip = require('adm-zip');
const BookDownloads = require('../lib/BookDownloads');
const Utils = require('../lib/Utils');

function commentaryBook(type) {
	return {
		id: 42,
		alias: type === 'tafsir' ? 'sample-tafsir' : 'sample-translation',
		type: type,
		name_en: 'Sample Work',
		author_en: 'Sample Author',
		description: 'A concise description.'
	};
}

function commentaryRow(type) {
	return {
		id: 7,
		hId: 7,
		book_id: 42,
		book_alias: 'sample',
		book_name_en: 'Sample Work',
		commentary_type: type,
		h1: 1,
		h1_title_en: 'Al-Fatihah',
		surah: 1,
		ayahFrom: 1,
		ayahTo: 1,
		passageNum: 1,
		ref: 'quran:1:1',
		body_en: 'Commentary text.'
	};
}

function headingContent() {
	return {
		introductions: [{
			h2: 1,
			title_en: 'Foreword',
			intro_en: 'The **book introduction**.'
		}],
		surahs: [{
			h1: 1,
			intro_en: 'The *surah introduction*.'
		}]
	};
}

describe('Quran commentary downloads', () => {
	test.each(['tafsir', 'trans'])('JSON includes description and introductions for %s', type => {
		const book = commentaryBook(type);
		const rows = [commentaryRow(type)];
		const base = BookDownloads.buildBookDocument(book, rows);
		const document = BookDownloads.bookDownloadDocument(book, rows, base, {
			format: 'json',
			commentaryHeadings: headingContent()
		});

		expect(document.book.description.en).toBe('A concise description.');
		expect(document.description.en).toBe('A concise description.');
		expect(document.introductions[0]).toMatchObject({
			number: 1,
			title: { en: 'Foreword' },
			intro: { en: 'The **book introduction**.' }
		});
		expect(document.chapters[0].intro.en).toBe('The *surah introduction*.');
	});

	test('EPUB renders description and book introductions before the surah', () => {
		const book = commentaryBook('tafsir');
		const rows = [commentaryRow('tafsir')];
		const base = BookDownloads.buildBookDocument(book, rows);
		const document = BookDownloads.bookDownloadDocument(book, rows, base, {
			format: 'epub',
			commentaryHeadings: headingContent()
		});
		const zip = new AdmZip(Utils.toEpub(book, document));
		const chapters = zip.getEntries()
			.filter(entry => /^EPUB\/chapter-\d+\.xhtml$/.test(entry.entryName))
			.map(entry => entry.getData().toString('utf8'));

		expect(chapters).toHaveLength(3);
		expect(chapters[0]).toContain('About this book');
		expect(chapters[0]).toContain('A concise description.');
		expect(chapters[1]).toContain('Foreword');
		expect(chapters[1]).toContain('<strong>book introduction</strong>');
		expect(chapters[2]).toContain('Al-Fatihah');
		expect(chapters[2]).toContain('<em>surah introduction</em>');
	});
});
