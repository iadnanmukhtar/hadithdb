'use strict';

const crypto = require('crypto');
const importer = require('../bin/utils/import-mokhtasar-introductions');

describe('Mokhtasar surah introduction importer', () => {
	test('extracts and converts the introduction preceding ayah 1', () => {
		const result = importer.parseIntroductionResponse({ status: true, data: [{
			sura: 2, aya: 1, books: [{ language_id: 4, surrah_intro: '<div>The Cow<br><strong>• &nbsp; Surah Objective(s): &nbsp;</strong><br>Establishing stewardship on Earth.</div>' }]
		}] }, 2);
		expect(result).toMatchObject({
			surah: 2,
			url: 'https://mokhtasr.com/en/books/319?sura=2&aya=1&lang=1',
			intro_en: 'The Cow\n\n**• Surah Objective(s):**\n\nEstablishing stewardship on Earth.'
		});
		expect(result.sha256).toBe(crypto.createHash('sha256').update(result.intro_en).digest('hex'));
	});

	test('rejects an ayah-1 response without a surah introduction', () => {
		expect(() => importer.parseIntroductionResponse({ status: true, data: [{
			sura: 2, aya: 1, books: [{ language_id: 4, surrah_intro: null }]
		}] }, 2)).toThrow('did not contain surrah_intro');
	});

	test('is a dry run by default and targets mokhtasar', () => {
		const options = importer.readOptions([]);
		expect(options).toMatchObject({ alias: 'mokhtasar', sourceBookId: 319, dryRun: true, buildIndex: true });
	});
});
