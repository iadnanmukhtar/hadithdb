'use strict';

const {
	importDorarSharh,
	normalizeDorarSharhUrl,
	parseDorarSharhHtml
} = require('../lib/DorarSharhImport');

describe('Dorar explanation import', () => {
	test('accepts only exact dorar.net explanation URLs', () => {
		expect(normalizeDorarSharhUrl('https://www.dorar.net/hadith/sharh/92164?utm_source=test#x')).toEqual({
			sourceEntryId: 92164,
			sourceUrl: 'https://dorar.net/hadith/sharh/92164'
		});
		expect(() => normalizeDorarSharhUrl('http://dorar.net/hadith/sharh/92164')).toThrow(/full dorar.net explanation URL/);
		expect(() => normalizeDorarSharhUrl('https://example.com/hadith/sharh/92164')).toThrow(/full dorar.net explanation URL/);
		expect(() => normalizeDorarSharhUrl('https://dorar.net/h/abc')).toThrow(/full dorar.net explanation URL/);
	});

	test('extracts only the explanation body as Markdown', () => {
		const html = '<h1>Unrelated</h1><div id="sharh-text-content">الفقرة الأولى.<br>الفقرة الثانية.<div class="visible-xs">Spacer</div></div>';
		expect(parseDorarSharhHtml(html)).toBe('الفقرة الأولى.\n\nالفقرة الثانية.');
		expect(() => parseDorarSharhHtml('<div>Missing</div>')).toThrow(/not found/);
	});

	test('retrieves the normalized URL through Lightpanda', async () => {
		const execFile = jest.fn().mockResolvedValue({
			stdout: '<div id="sharh-text-content">شرح الحديث</div>'
		});
		const result = await importDorarSharh('https://dorar.net/hadith/sharh/92164', {
			execFile,
			lightpandaBin: '/opt/lightpanda'
		});
		expect(result).toEqual({
			sourceEntryId: 92164,
			sourceUrl: 'https://dorar.net/hadith/sharh/92164',
			text: 'شرح الحديث'
		});
		expect(execFile).toHaveBeenCalledWith('/opt/lightpanda', expect.arrayContaining([
			'fetch', '--dump', 'html', 'https://dorar.net/hadith/sharh/92164'
		]), expect.objectContaining({ timeout: 30000 }));
	});
});
