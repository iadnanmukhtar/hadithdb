'use strict';

const {
	chapterPageUrl,
	contentPageUrl,
	inlineMarkdown,
	normalizeText,
	parseChapterPage,
	parseDetailPage,
	parseFootnotes,
	printPageUrl,
	sortTranslations,
	validateSource
} = require('../bin/utils/import-mquran-translation');

describe('mquran.org Quran translation importer', () => {
	test('builds an unpaginated chapter URL from the supplied category URL', () => {
		expect(chapterPageUrl('https://mquran.org/content/category/2/1/4/', 2))
			.toBe('https://mquran.org/content/category/2/2/4/500/0/');
		expect(chapterPageUrl('https://mquran.org/content/category/2/1/4/50/0/', 114))
			.toBe('https://mquran.org/content/category/2/114/4/500/0/');
	});

	test('builds a detail URL for source entries omitted from category listings', () => {
		expect(contentPageUrl('https://mquran.org/content/category/2/1/4/', 4950))
			.toBe('https://mquran.org/content/view/4950/4/');
	});

	test('builds the smaller printable detail-page URL used for annotations', () => {
		expect(printPageUrl('https://mquran.org/content/category/2/1/4/', 17))
			.toBe('https://mquran.org/index2.php?option=com_content&task=view&id=17&pop=1&page=0&Itemid=4');
	});

	test('extracts only the expected chapter and decodes HTML text', () => {
		const html = `
			<div id="component">
				<table>
					<tr class="sectiontableentry1"><td><a href="https://mquran.org/content/view/8/4/">1.1. IN THE NAME OF GOD</a></td></tr>
					<tr class="sectiontableentry2"><td><a href="https://mquran.org/content/view/9/4/">1.2. All praise &amp; gratitude&nbsp; are for God</a></td></tr>
					<tr><td><a href="https://mquran.org/content/category/2/2/4/">2. Al-Baqarah</a></td></tr>
				</table>
			</div>`;
		expect(parseChapterPage(html, 1)).toEqual([
			{ surah: 1, ayah: 1, text: 'IN THE NAME OF GOD', contentId: 8 },
			{ surah: 1, ayah: 2, text: 'All praise & gratitude are for God', contentId: 9 }
		]);
	});

	test('keeps verse text from malformed nested links by parsing the listing row', () => {
		const html = '<div id="component"><table><tr class="sectiontableentry1"><td><a href="/content/view/1/4/">1.1. <a name="001.001">Verse text</a></a></td></tr></table></div>';
		expect(parseChapterPage(html, 1)).toEqual([{ surah: 1, ayah: 1, text: 'Verse text', contentId: 1 }]);
	});

	test('extracts translation markers and multi-paragraph Markdown footnotes from a detail page', () => {
		const html = `
			<table class="contentpaneopen"><tr><td class="contentheading">2.10. Translation title</td></tr></table>
			<table class="contentpaneopen"><tr><td valign="top">
				<p align="right"><font face="Traditional Arabic">Arabic</font></p>
				<p><b>10</b>. God increased their sickness.<b><sup>10</sup></b> A punishment awaits.</p>
				<blockquote>
					<p><strong>10.</strong> First paragraph with <em>emphasis</em>.</p>
					<p>Second paragraph.</p>
				</blockquote>
			</td></tr></table>`;
		expect(parseDetailPage(html, 2, 10, 17)).toEqual({
			t: 'God increased their sickness.[^10] A punishment awaits.',
			f: '[^10]: First paragraph with *emphasis*.\n\n    Second paragraph.'
		});
	});

	test('extracts translation text from mquran.org malformed paragraph tags', () => {
		const html = `
			<table class="contentpaneopen"><tr><td class="contentheading">1.3. Translation title</td></tr></table>
			<table class="contentpaneopen"><tr><td valign="top">
				<p align="right"><font face="Traditional Arabic">Arabic</font></p>
				<p<b>3. The All-Merciful, the All-Compassionate,</p>
			</td></tr></table>`;
		expect(parseDetailPage(html, 1, 3, 3)).toEqual({
			t: 'The All-Merciful, the All-Compassionate,',
			f: ''
		});
	});

	test('retains a page-attached footnote when mquran.org omits its inline marker', () => {
		const html = `
			<table class="contentpaneopen"><tr><td class="contentheading">21.90. Translation title</td></tr></table>
			<table class="contentpaneopen"><tr><td valign="top">
				<p align="right"><font face="Traditional Arabic">Arabic</font></p>
				<p><b>90</b>. They were utterly humble before Us.</p>
				<hr><p>19. The conclusion confirms Zachariah's supplication.</p>
				<p>19. The conclusion confirms Zachariah's supplication.</p>
			</td></tr></table>`;
		const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
		expect(parseDetailPage(html, 21, 90, 2573)).toEqual({
			t: 'They were utterly humble before Us.[^19]',
			f: "[^19]: The conclusion confirms Zachariah's supplication."
		});
		expect(warning).toHaveBeenCalledWith(expect.stringContaining('omitted inline marker(s) 19'));
		warning.mockRestore();
	});

	test('applies explicit mquran.org footnote-label corrections', () => {
		const verse190 = `
			<table class="contentpaneopen"><tr><td class="contentheading">2.190. Translation title</td></tr></table>
			<table class="contentpaneopen"><tr><td valign="top">
				<p>190. Do not exceed the bounds.<sup>137</sup></p>
				<blockquote><p><strong>*</strong>. See Appendix 2.</p></blockquote>
			</td></tr></table>`;
		const verse191 = `
			<table class="contentpaneopen"><tr><td class="contentheading">2.191. Translation title</td></tr></table>
			<table class="contentpaneopen"><tr><td valign="top">
				<p>191. Disorder is worse than killing.<sup>137</sup></p>
				<blockquote><p><strong>138</strong>. The verse regards disorder as a reason for war.</p></blockquote>
			</td></tr></table>`;
		const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
		expect(parseDetailPage(verse190, 2, 190, 197)).toEqual({
			t: 'Do not exceed the bounds.[^137]',
			f: '[^137]: See Appendix 2.'
		});
		expect(parseDetailPage(verse191, 2, 191, 198)).toEqual({
			t: 'Disorder is worse than killing.[^138]',
			f: '[^138]: The verse regards disorder as a reason for war.'
		});
		expect(warning).toHaveBeenCalledTimes(2);
		warning.mockRestore();
	});

	test('parses a footnote marker whose period begins an italic element', () => {
		const html = `
			<table class="contentpaneopen"><tr><td class="contentheading">2.218. Translation title</td></tr></table>
			<table class="contentpaneopen"><tr><td valign="top">
				<p>218. Strive in God's cause.<sup>147</sup></p>
				<blockquote><p><strong>147</strong> <em>. Jihâd</em> denotes doing one's utmost.</p></blockquote>
			</td></tr></table>`;
		expect(parseDetailPage(html, 2, 218, 225)).toEqual({
			t: "Strive in God's cause.[^147]",
			f: "[^147]: *Jihâd* denotes doing one's utmost."
		});
	});

	test('parses direct, combined, and colon-labeled footnotes', () => {
		const html = `
			<table class="contentpaneopen"><tr><td class="contentheading">4.23. Translation title</td></tr></table>
			<table class="contentpaneopen"><tr><td valign="top">
				<p>23. Relations through descent.<sup>7</sup> Another ruling.<sup>8</sup> A warning.<sup>20</sup> A conclusion.<sup>21</sup></p>
				<blockquote><strong>7/8</strong>. One definition attached to both rulings.</blockquote>
				<p>20: A colon-labeled definition.</p>
				<p><em>21. An italic opening</em> continues.</p>
			</td></tr></table>`;
		expect(parseDetailPage(html, 4, 23, 516)).toEqual({
			t: 'Relations through descent.[^7] Another ruling.[^8] A warning.[^20] A conclusion.[^21]',
			f: '[^7]: One definition attached to both rulings.\n[^8]: One definition attached to both rulings.\n[^20]: A colon-labeled definition.\n[^21]: *An italic opening* continues.'
		});
	});

	test('rejects chapter gaps and duplicate ayahs', () => {
		const gap = '<div id="component"><table><tr class="sectiontableentry1"><td><a href="/content/view/1/4/">2.2. Text</a></td></tr></table></div>';
		const duplicate = '<div id="component"><table><tr class="sectiontableentry1"><td><a href="/content/view/1/4/">2.1. A</a></td></tr><tr class="sectiontableentry2"><td><a href="/content/view/2/4/">2.1. B</a></td></tr></table></div>';
		expect(() => parseChapterPage(gap, 2)).toThrow(/missing ayah 1/);
		expect(() => parseChapterPage(duplicate, 2)).toThrow(/repeated ayah 1/);
	});

	test('normalizes layout whitespace without altering punctuation', () => {
		expect(normalizeText('  God\u00a0  —\n the Lord.  ')).toBe('God — the Lord.');
	});

	test('sorts Quran refs numerically', () => {
		expect(Object.keys(sortTranslations({ '10:1': 'C', '2:10': 'B', '2:2': 'A' })))
			.toEqual(['2:2', '2:10', '10:1']);
	});

	test('requires a complete 6,236-ayah, 114-surah source', () => {
		expect(() => validateSource({ '1:1': 'Text' })).toThrow(/Expected 6236/);
	});
});
