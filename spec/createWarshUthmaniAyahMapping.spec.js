'use strict';

const { buildAlignedEdition, buildMapping } = require('../bin/createWarshUthmaniAyahMapping');

function ayah(ref, text) {
	const [surah, number] = ref.split(':').map(Number);
	return { ref, surah, ayah: number, text };
}

function word(sourceRef, text, sourceId) {
	const [surah, ayahNumber, wordNumber] = sourceRef.split(':').map(Number);
	return { sourceId, sourceRef, surah, ayah: ayahNumber, word: wordNumber, text };
}

describe('Warsh to Uthmani ayah mapping', () => {
	test('maps joined and split ayah boundaries in both directions', () => {
		const warsh = [
			ayah('1:1', 'الحمد لله رب العالمين'),
			ayah('2:1', 'الم ذلك الكتاب'),
			ayah('3:1', 'قال'),
			ayah('3:2', 'موسى')
		];
		const uthmani = [
			ayah('1:1', 'بسم الله الرحمن الرحيم'),
			ayah('1:2', 'الحمد لله رب العالمين'),
			ayah('2:1', 'الم'),
			ayah('2:2', 'ذلك الكتاب'),
			ayah('3:1', 'قال موسى')
		];

		const mapping = buildMapping(warsh, uthmani);

		expect(mapping.warsh_to_uthmani['1:1']).toEqual(['1:2']);
		expect(mapping.uthmani_to_warsh['1:1']).toEqual([]);
		expect(mapping.warsh_to_uthmani['2:1']).toEqual(['2:1', '2:2']);
		expect(mapping.uthmani_to_warsh['3:1']).toEqual(['3:1', '3:2']);
		expect(mapping.unmapped_uthmani).toEqual(['1:1']);
	});

	test('rejects a Warsh ayah that cannot be aligned', () => {
		expect(() => buildMapping(
			[ayah('1:1', 'الحمد'), ayah('1:2', 'زخرف')],
			[ayah('1:1', 'الحمد')]
		)).toThrow('Unmapped Warsh ayahs: 1:2');
	});

	test('builds a canonical-numbered Warsh edition and splits joined boundary words', () => {
		const uthmani = [
			ayah('1:1', 'بسم الله الرحمن الرحيم'),
			ayah('1:2', 'الحمد لله'),
			ayah('2:1', 'الم'),
			ayah('2:2', 'ذلك الكتاب'),
			ayah('3:1', 'قال موسى'),
			ayah('4:1', 'السبيل'),
			ayah('4:2', 'والله')
		];
		const warshWords = [
			word('1:1:1', 'الحمد', 1),
			word('1:1:2', 'لله', 2),
			word('2:1:1', 'الم', 3),
			word('2:1:2', 'ذلك', 4),
			word('2:1:3', '۞', 5),
			word('2:1:4', 'الكتاب', 6),
			word('3:1:1', 'قال', 7),
			word('3:2:1', 'موسى', 8),
			word('4:1:1', 'السبيلۖوالله', 9)
		];

		const aligned = buildAlignedEdition(warshWords, uthmani);

		expect(aligned.ayahs['1:1'].text).toBe('بِسْمِ اِ۬للَّهِ اِ۬لرَّحْمَٰنِ اِ۬لرَّحِيمِ');
		expect(aligned.ayahs['1:2'].text).toBe('الحمد لله');
		expect(aligned.ayahs['2:1'].text).toBe('الم');
		expect(aligned.ayahs['2:2'].text).toBe('ذلك ۞ الكتاب');
		expect(aligned.words['2:2:2'].text).toBe('۞ الكتاب');
		expect(aligned.ayahs['3:1'].text).toBe('قال موسى');
		expect(aligned.ayahs['4:1'].text).toBe('السبيلۖ');
		expect(aligned.ayahs['4:2'].text).toBe('والله');
		expect(aligned.splitWordCount).toBe(1);
		expect(aligned.foldedMarkerCount).toBe(1);
		expect(Object.keys(aligned.ayahs)).toHaveLength(uthmani.length);
	});
});
