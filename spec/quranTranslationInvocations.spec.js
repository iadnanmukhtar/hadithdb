'use strict';

const fs = require('fs');
const path = require('path');
const {
	INVOCATIONS,
	planRows,
	validateCatalog
} = require('../bin/utils/populate-quran-translation-invocations');

describe('Quran translation invocations', () => {
	const books = Object.keys(INVOCATIONS).map(function (alias, index) {
		return { id: index + 1, alias: alias, shortName_en: alias };
	});
	const sourceRows = books.map(function (book, index) {
		return {
			bookId: book.id,
			alias: book.alias,
			id: index + 100,
			surah: 16,
			ayahFrom: 98,
			ayahTo: 98,
			text_en: INVOCATIONS[book.alias].source,
			footnotes_en: null
		};
	});

	test('defines a first-person Quran 1:0 invocation for every configured local translation', () => {
		validateCatalog(books);
		const plan = planRows(books, sourceRows, 460953);

		expect(plan).toHaveLength(21);
		expect(plan.every(row => row.action === 'create')).toBe(true);
		expect(plan.every(row => /^I seek\b/.test(row.text))).toBe(true);
	});

	test('is idempotent when the Quran 1:0 rows already match', () => {
		const existingRows = books.map(function (book, index) {
			return {
				bookId: book.id,
				alias: book.alias,
				id: index + 200,
				surah: 1,
				ayahFrom: 0,
				ayahTo: 0,
				text_en: INVOCATIONS[book.alias].text,
				footnotes_en: null
			};
		});
		const plan = planRows(books, sourceRows.concat(existingRows), 460953);

		expect(plan.every(row => row.action === 'unchanged')).toBe(true);
	});

	test('loads local Quran 1:0 while retaining the shared 1:1 basmalah fallback elsewhere', () => {
		const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');
		const server = fs.readFileSync(path.join(__dirname, '..', 'routes', 'search.js'), 'utf8');
		const tafsir = fs.readFileSync(path.join(__dirname, '..', 'lib', 'Tafsir.js'), 'utf8');
		const loader = fs.readFileSync(path.join(__dirname, '..', 'bin', 'utils', 'load-quran-translation.js'), 'utf8');

		expect(client).toContain("fetchQuranLocalTranslation(book, '1', originalPrefatory ? '0' : '1')");
		expect(client).not.toContain("if (isQuranOriginalPrefatoryTranslationTarget(target))\n\t\t\treturn Promise.resolve();");
		expect(server).not.toContain("Number(surah) === 1 && ayah === 0");
		expect(server).toContain("(value === undefined || value === null ? '' : value).toString()");
		expect(server).toContain("if (itemAyah === undefined || itemAyah === null || itemAyah === '')");
		expect(tafsir).not.toContain("if (Number(ayah) === 0) {");
		expect(loader).toContain('AND NOT (surah=1 AND ayahFrom=0 AND ayahTo=0)');
	});
});
