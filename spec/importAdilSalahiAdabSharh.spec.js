/* jslint node:true, esversion:11 */
'use strict';

const Importer = require('../bin/utils/import-adil-salahi-adab-sharh');

describe('Adil Salahi Adab commentary importer', () => {
	it('repairs known OCR defects in source entry labels', () => {
		const source = [
			'449, (Athar 106) Aslam said',
			'499, (Athar 118) Khalid said',
			'769. Ibn ‘Abbas said: ‘This is a Prophet’s word:',
			'876. This is the same as Number 861',
			'1135. Ibn ‘Abbas reported that the Prophet instructed people',
			'1136. Jabir ibn ‘Abdullah reports that the Prophet said',
			'‘Abdullah ibn “Umar reports that the Prophet said: ‘Do not leave',
			'an open fire',
			'Abu Misa al-Ash‘ari reports that a house in Madinah was burnt',
			'one night'
		].join('\n');
		const repaired = Importer.repairOcrEntryLabels(source);
		expect(repaired).toContain('449. (Athar 106)');
		expect(repaired).toContain('499. (Athar 118)');
		expect(repaired).toContain('796. Ibn ‘Abbas');
		expect(repaired).toContain('867. This is the same');
		expect(repaired).toContain('1232. ‘Abdullah');
		expect(repaired).toContain('1233. Abu Misa');
		expect(repaired).toContain('1235. Ibn ‘Abbas');
		expect(repaired).toContain('1236. Jabir');
	});

	it('removes page numbers and rejoins wrapped prose', () => {
		expect(Importer.normalizeText('A self-\nrestraint example.\n\n31\n\nNext line\ncontinues.\n\nThe child stood on\n\n33 3\n\nhis feet.'))
			.toBe('A self-restraint example.\n\nNext line continues.\n\nThe child stood on his feet.');
	});

	it('moves a following chapter introduction out of the prior entry', () => {
		const split = Importer.splitTrailingIntroduction('Hadith and commentary.\n\nAnger and self restraint\n\nAn introduction to the next hadith.');
		expect(split.body).toBe('Hadith and commentary.');
		expect(split.introduction).toBe('Anger and self restraint\n\nAn introduction to the next hadith.');
	});

	it('does not treat an ordinary sentence as an introduction heading', () => {
		expect(Importer.isIntroductionHeading('This hadith provides important guidance.')).toBe(false);
		expect(Importer.isIntroductionHeading('Refined Manners')).toBe(true);
		expect(Importer.isIntroductionHeading('Le')).toBe(false);
	});

	it('aligns by content and permits source-only entries', () => {
		const source = [
			{ sourceEntryId: 1, leadText: 'kindness to parents' },
			{ sourceEntryId: 2, leadText: 'an unrelated extra report' },
			{ sourceEntryId: 3, leadText: 'control your anger' }
		];
		const local = [
			{ id: 1, num: '1', body_en: 'Show kindness to your parents.' },
			{ id: 2, num: '2', body_en: 'A strong man can control his anger.' }
		];
		const result = Importer.alignEntries(source, local);
		expect(result.matches.map(match => match.source.sourceEntryId)).toEqual([1, 3]);
		expect(result.skippedSource.map(entry => entry.sourceEntryId)).toEqual([2]);
	});
});
