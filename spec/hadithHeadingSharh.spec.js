'use strict';

const fs = require('fs');
const path = require('path');

describe('Hadith heading and virtual-book sharh', () => {
	test('heading loader preserves a one-to-many relationship', async () => {
		jest.resetModules();
		const query = jest.fn(async sql => sql.startsWith('CREATE TABLE') ? { affectedRows: 0 } : [
			{ id: 1, toc_id: 42, title: 'شرح أ', text: 'أ' },
			{ id: 2, toc_id: 42, title: 'شرح ب', text: 'ب' }
		]);
		const HeadingSharh = require('../lib/HadithHeadingSharh');
		const heading = { id: 42 };
		await HeadingSharh.attach(heading, query);
		expect(heading.shuruh).toHaveLength(2);
		expect(query.mock.calls[0][0]).toContain('FOREIGN KEY (toc_id) REFERENCES toc(id)');
	});

	test('reader templates render heading explanations after their introductions', () => {
		const chapter = fs.readFileSync(path.join(__dirname, '../views/sub-views/chapterTitle.ejs'), 'utf8');
		const heading = fs.readFileSync(path.join(__dirname, '../views/sub-views/heading.ejs'), 'utf8');
		const partial = fs.readFileSync(path.join(__dirname, '../views/sub-views/hadith_heading_sharh.ejs'), 'utf8');
		expect(chapter.indexOf("include('hadith_heading_sharh.ejs'")).toBeGreaterThan(chapter.indexOf('Chapter Intro'));
		expect(heading.indexOf("include('hadith_heading_sharh.ejs'")).toBeGreaterThan(heading.indexOf('Heading Intro'));
		expect(partial).toContain('renderedHeadingShuruh.forEach');
		expect(partial).toContain('الشروح');
		expect(partial).toContain('data-prop="hdith_toc_sharh.title_en"');
		expect(partial).toContain('data-prop="hdith_toc_sharh.title"');
		expect(partial).toContain('data-prop="hdith_toc_sharh.text_en"');
		expect(partial).toContain('data-prop="hdith_toc_sharh.text"');
		expect(partial).toContain('data-prop="hdith_toc_sharh.add"');
		expect(partial).toContain('data-sharh-update-prop="hdith_toc_sharh.reorder"');
		expect(partial).toContain('data-reader-language-column="english"');
		expect(partial).toContain('data-reader-language-column="arabic"');
		expect(partial).toContain('data-hadith-sharh-more-label="More..." data-hadith-sharh-less-label="Less..."');
		expect(partial).toContain('data-hadith-sharh-more-label="مزيد..." data-hadith-sharh-less-label="أقل..."');
	});

	test('English explanations use the smaller English introduction font size', () => {
		const css = fs.readFileSync(path.join(__dirname, '../public/static/css/style.css'), 'utf8');
		expect(css).toMatch(/main \.intro\[lang="en"\]\[data-prop="toc\.intro_en"\]\s*\{\s*font-size: calc\(\.81rem \* var\(--content-font-scale\)\);/);
		expect(css).toMatch(/\.hadith-sharh-column:lang\(en\) \.hadith-sharh-body,\s*\.hadith-sharh-column:lang\(en\) \.hadith-sharh-more \{ font-size: calc\(\.81rem \* var\(--content-font-scale\)\) !important; \}/);
	});

	test('reinitializes independent More and Less controls in appended reader sections', () => {
		const script = fs.readFileSync(path.join(__dirname, '../public/static/js/script.js'), 'utf8');
		expect(script).toContain("var wrap = body.closest('.hadith-sharh-collapse-wrap');");
		expect(script).toContain("body.classList.toggle('is-expanded', expanded);");
		expect(script).toContain("button.textContent = expanded ? lessLabel : moreLabel;");
		expect(script.match(/initHadithSharhDisclosures\(chunk\)/g)).toHaveLength(2);
	});

	test('canonical Hadith commentary does not depend on a virtual query parameter', () => {
		const route = fs.readFileSync(path.join(__dirname, '../routes/search.js'), 'utf8');
		expect(route).toContain("queryParams.delete('virtualId')");
		expect(route).not.toContain("queryParams.set('virtualId'");
		expect(route).not.toContain('HadithVirtualSharh');
	});

	test('the importer recognizes styled and plain global source numbers', () => {
		const importer = require('../bin/import-riyad-uthaymin-sharh');
		expect(importer.sourceNumberMatches('\n9/454- وعن فلان')).toEqual([
			expect.objectContaining({ number: 454, slash: true })
		]);
		expect(importer.sourceNumberMatches('\n169 ـ عن عائشة')).toEqual([
			expect.objectContaining({ number: 169, slash: false })
		]);
	});

	test('the importer falls back to canonical hadith text when a virtual match has no textActual', () => {
		const importer = fs.readFileSync(path.join(__dirname, '../bin/import-riyad-uthaymin-sharh.js'), 'utf8');
		expect(importer).toContain("COALESCE(NULLIF(hv.textActual, ''), CONCAT_WS(' ', h.chain, h.body)) AS matchText");
		expect(importer).toContain('JOIN hadiths h ON h.id=hv.hadithId');
		expect(importer).toContain('row.matchText');
	});

	test('heading explanation blocks are matched independently when an EPUB anchor spans headings', () => {
		const importer = require('../bin/import-riyad-uthaymin-sharh');
		const blocks = [
			{ entryId: 1, headingAnchor: 'C20', hadithNumbers: [], source: 'قال المؤلف: باب فضل الجمعة', text: 'شرح الجمعة' },
			{ entryId: 2, headingAnchor: 'C20', hadithNumbers: [], source: 'قال المؤلف: باب سجود الشكر', text: 'شرح السجود' }
		];
		const toc = [
			{ id: 10, title: 'باب فضل الجمعة', ordinal: 1 },
			{ id: 11, title: 'باب استحباب سجود الشكر', ordinal: 2 }
		];
		const mapping = importer.mapHeadingAnchors(blocks, toc);
		expect(mapping.get(1).id).toBe(10);
		expect(mapping.get(2).id).toBe(11);
	});

	test('multiple EPUB blocks from one commentator become one heading explanation', () => {
		const importer = require('../bin/import-riyad-uthaymin-sharh');
		const grouped = importer.groupHeadingRows([
			{ tocId: 42, sourceEntryId: 5, ordinal: 5, page: 10, text: 'Heading explanation' },
			{ tocId: 42, sourceEntryId: 6, ordinal: 6, page: 11, text: 'Verse explanation' }
		]);
		expect(grouped).toEqual([expect.objectContaining({
			tocId: 42, sourceEntryId: 5, sourceEntryIds: [5, 6], text: 'Heading explanation\n\nVerse explanation'
		})]);
	});

	test('chapter commentary remains on the heading when its introduction quotes hadiths', () => {
		const importer = require('../bin/import-riyad-uthaymin-sharh');
		const blocks = [
			{ entryId: 1, headingAnchor: 'C9', source: 'باب في حكم عام\nوثبت أن رسول الله ﷺ قال كذا' },
			{ entryId: 2, headingAnchor: 'C9', source: 'هذا الباب ذكر فيه المؤلف أحاديث أخرى' }
		];
		importer.alignBlocks(blocks, new Map([[1, 'عن فلان قال رسول الله ﷺ كذا']]));
		expect(blocks.map(block => block.hadithNumbers)).toEqual([[], []]);
	});
});
