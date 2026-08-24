'use strict';

const fs = require('fs');
const path = require('path');
const Index = require('../lib/Index');
const Tafsir = require('../lib/Tafsir');

describe('tafsir surah introduction anchors', () => {
	afterEach(() => jest.restoreAllMocks());

	test('allows Surah 1 authored introductions to precede an available 1:0 passage', async () => {
		const lookup = jest.spyOn(Index, 'docsFromQueryFields').mockResolvedValue([{
			surah: 1,
			ayahFrom: 0,
			ayahTo: 0
		}]);

		const passage = await Tafsir.firstPassageInSurah({ alias: 'test-tafsir', source: 'local' }, 1, { includeZero: true });

		expect(passage).toEqual({ surah: 1, ayah: 0, endAyah: 0 });
		const filters = lookup.mock.calls[0][1].bool.filter;
		expect(filters).toContainEqual({ range: { ayahFrom: { gte: 0 } } });
		expect(filters).toContainEqual({ range: { ayahTo: { gte: 0 } } });
	});

	test('keeps the normal first-passage lookup anchored at ayah 1', async () => {
		const lookup = jest.spyOn(Index, 'docsFromQueryFields').mockResolvedValue([{
			surah: 1,
			ayahFrom: 1,
			ayahTo: 1
		}]);

		await Tafsir.firstPassageInSurah({ alias: 'test-tafsir', source: 'local' }, 1);

		const filters = lookup.mock.calls[0][1].bool.filter;
		expect(filters).toContainEqual({ range: { ayahFrom: { gte: 1 } } });
	});

	test('preserves both adjacent tafsir passage boundaries', async () => {
		const lookup = jest.spyOn(Index, 'docsFromQuery').mockResolvedValue([{
			surah: 2,
			ayahFrom: 10,
			ayahTo: 14
		}]);

		const adjacent = await Tafsir.adjacentPassage({ alias: 'test-tafsir', source: 'local' }, [{
			surah: 2,
			startAyah: 5,
			endAyah: 9
		}], 1);

		expect(adjacent).toEqual({ surah: 2, ayah: 10, endAyah: 14 });
		expect(lookup.mock.calls[0][1].bool.should).toContainEqual({
			bool: { filter: [{ term: { surah: 2 } }, { range: { ayahFrom: { gt: 9 } } }] }
		});
	});

	test('treats 1:0 as its own boundary and wraps Previous to the final passage', async () => {
		const lookup = jest.spyOn(Index, 'docsFromQuery').mockResolvedValue([{
			surah: 114,
			ayahFrom: 1,
			ayahTo: 6
		}]);

		const adjacent = await Tafsir.adjacentPassage({ alias: 'test-tafsir', source: 'local' }, [{
			surah: 1,
			startAyah: 0,
			endAyah: 0
		}], -1);

		expect(adjacent).toEqual({ surah: 114, ayah: 1, endAyah: 6 });
		expect(lookup.mock.calls[0][1].bool.should).toBeUndefined();
	});

	test('keeps the synthetic 1:0 boundary navigable when a tafsir has no 1:0 entry', async () => {
		jest.spyOn(Index, 'docsFromQuery').mockResolvedValue([{
			surah: 114,
			ayahFrom: 1,
			ayahTo: 6
		}]);
		global.surahs = [{ num: 1, ayahs: 7 }, { num: 114, ayahs: 6 }];

		await expect(Tafsir.adjacentPassage(
			{ alias: 'test-tafsir', source: 'local' },
			[],
			-1,
			{ surah: 1, ayah: 0 }
		)).resolves.toEqual({ surah: 114, ayah: 1, endAyah: 6 });
	});

	test('uses the tafsir first passage range after the synthetic 1:0 boundary', async () => {
		jest.spyOn(Index, 'docsFromQuery').mockResolvedValue([{
			surah: 1,
			ayahFrom: 1,
			ayahTo: 7
		}]);
		global.surahs = [{ num: 1, ayahs: 7 }, { num: 114, ayahs: 6 }];

		await expect(Tafsir.adjacentPassage(
			{ alias: 'test-tafsir', source: 'local' },
			[],
			1,
			{ surah: 1, ayah: 0 }
		)).resolves.toEqual({ surah: 1, ayah: 1, endAyah: 7 });
	});

	test('places the introduction in both directions between Surah 114 and the 1:0 boundary', () => {
		global.surahs = [{ num: 1, ayahs: 7 }, { num: 114, ayahs: 6 }];
		const introductionHref = '/quran/tafsir/test-tafsir/introduction';

		expect(Tafsir.invocationBoundary([
			{ surah: 114, startAyah: 1, endAyah: 6 }
		], 114, 1, 1, introductionHref)).toEqual({ href: introductionHref, title: 'Introduction' });
		expect(Tafsir.invocationBoundary([
			{ surah: 1, startAyah: 0, endAyah: 0 }
		], 1, 0, -1, introductionHref)).toEqual({ href: introductionHref, title: 'Introduction' });
		expect(Tafsir.invocationBoundary([
			{ surah: 1, startAyah: 1, endAyah: 7 }
		], 1, 1, -1, introductionHref)).toEqual({ surah: 1, ayah: 0, endAyah: 0 });
	});

	test('places the surah introduction before the Study passage-range heading', () => {
		const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'section_quran.ejs'), 'utf8');
		expect(template.indexOf("include('sub-views/quran_commentary_surah_intro.ejs'")).toBeLessThan(
			template.indexOf("include('sub-views/heading.ejs'")
		);
	});
});
