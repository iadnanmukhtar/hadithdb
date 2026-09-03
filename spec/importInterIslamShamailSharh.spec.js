'use strict';

const { alignSequences, chapterLinks, normalizeCommentary, parseChapter } = require('../bin/utils/import-inter-islam-shamail-sharh');

describe('Inter-Islam Shamail sharh importer', () => {
	test('discovers only the numbered English chapter pages', () => {
		const html = '<a href="st2.htm">two</a><a href="st1.html">one</a><a href="st1arabic.html">Arabic</a>';
		expect(chapterLinks(html)).toEqual([
			{ chapter: 1, href: 'st1.html' },
			{ chapter: 2, href: 'st2.htm' }
		]);
	});

	test('extracts commentary below each hadith without importing its translation', () => {
		const html = `<html><body>
			<p><a name="1"></a><font>(1) Hadith Number 1.</font><br>The first translated hadith.</p>
			<p><font>Commentary</font><br><strong>First explanation.</strong></p><p>Its second paragraph.<br><a href="#top">back</a></p>
			<p><a name="2"></a><font>(2) Hadith Number 2.</font><br>The second translated hadith.</p>
			<p><font>Commentary.</font><br>Second explanation.<br><a href="#top">back</a></p>
			<p><a name="3"></a><font>(3) Athar Number 1.</font><br>An athar without commentary.</p>
		</body></html>`;
		const chapter = parseChapter(html, 'http://example.test/st1.htm', 1);
		expect(chapter.hadiths).toHaveLength(3);
		expect(chapter.hadiths[0].commentary).toContain('**First explanation.**');
		expect(chapter.hadiths[0].commentary).toContain('Its second paragraph.');
		expect(chapter.hadiths[0].commentary).not.toContain('first translated hadith');
		expect(chapter.hadiths[1].commentary).toBe('Second explanation.');
		expect(chapter.hadiths[2].commentary).toBe('');
	});

	test('combines multiple commentary blocks belonging to one long hadith', () => {
		const html = `<html><body><p><font>(240) Hadith 1</font><br>Translation.</p>
			<p><font>Commentary</font><br>First note.<br><a href="#top">back</a></p>
			<p>More translated material.</p>
			<p><font>Commentary</font><br>Second note.<br><a href="#top">back</a></p>
		</body></html>`;
		expect(parseChapter(html, 'http://example.test/st37.htm', 37).hadiths[0].commentary)
			.toBe('First note.\n\nSecond note.');
	});

	test('expands source headings that combine two hadith numbers', () => {
		const html = `<html><body>
			<p><font>(53 &amp; 54) Hadith Number 1 and 2</font><br>Shared translation.</p>
			<p><font>Commentary</font><br>Shared explanation.<br><a href="#top">back</a></p>
			<p><font>(55) Hadith Number 3</font><br>Next translation.</p>
		</body></html>`;
		const rows = parseChapter(html, 'http://example.test/st8.htm', 8).hadiths;
		expect(rows.map(row => row.printedNumber)).toEqual([53, 54, 55]);
		expect(rows.slice(0, 2).map(row => row.commentary)).toEqual(['Shared explanation.', 'Shared explanation.']);
	});

	test('aligns around an extra local-edition record', () => {
		const source = [
			{ sourceText: 'Anas reports the description of his hair' },
			{ sourceText: 'Aisha reports the description of his shoes' }
		];
		const local = [
			{ id: 1, chain_en: 'Anas reports', body_en: 'the description of his hair' },
			{ id: 2, chain_en: 'unrelated narrator', body_en: 'an additional report' },
			{ id: 3, chain_en: 'Aisha reports', body_en: 'the description of his shoes' }
		];
		expect(alignSequences(source, local).map(match => match.local.id)).toEqual([1, 3]);
	});

	test('normalizes the requested English blessing to the honorific ligature', () => {
		expect(normalizeCommentary("Rasulullah Sallallahu 'Alayhi Wasallam said; Rasulullah (Sallallahu alaihe wasallam); Anas (Radiallahu Anhu); Anas (R.A.)"))
			.toBe('Rasulullah ﷺ said; Rasulullah ﷺ; Anas ᴿᴬ; Anas ᴿᴬ');
	});

	test.each([
		['(Radiallahu Anhum)', 'ᴿᴬ'],
		['(radiallahu anhum)', 'ᴿᴬ'],
		["Radiyallahu 'Anhum", 'ᴿᴬ'],
		["Radiyallahu'Anhum", 'ᴿᴬ'],
		['Radhiallahu Anhum', 'ᴿᴬ'],
		['Radiallhu Anhu', 'ᴿᴬ'],
		['Radiyallahu Anha', 'ᴿᴬ'],
		['(r.a)', 'ᴿᴬ']
	])('normalizes the honorific variant %s', (input, expected) => {
		expect(normalizeCommentary(input)).toBe(expected);
	});

	test('propagates both source titles into every imported commentary row', () => {
		const importer = require('fs').readFileSync(require('path').join(__dirname, '../bin/utils/import-inter-islam-shamail-sharh.js'), 'utf8');
		expect(importer).toContain("SELECT title, title_en FROM hdith_sharh_sources WHERE id=? LIMIT 1");
		expect(importer).toContain('sourceTitles.title, sourceTitles.title_en, match.source.commentary');
	});
});
