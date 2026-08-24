'use strict';

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const widgetTemplate = path.join(__dirname, '..', 'views', 'sub-views', 'comment_widget.ejs');

test('renders an independently addressable reflection disclosure closed by default', async () => {
	const html = await ejs.renderFile(widgetTemplate, {
		widgetId: 'quran-passage-comments-42',
		heading: 'Reflect on this passage:',
		targetId: 42,
		targetType: 'toc',
		ref: 'quran/2/9',
		collapsible: true,
		collapsed: true
	});
	const detailsTag = html.match(/<details[^>]*data-reflection-disclosure[^>]*>/);

	expect(detailsTag).not.toBeNull();
	expect(detailsTag[0]).not.toMatch(/\sopen(?:\s|>)/);
	expect(html).toContain('id="quran-passage-comments-42-disclosure"');
	expect(html).toContain('<summary class="reflection-disclosure-summary">');
	expect(html).toContain('observer.observe(disclosure || container);');
	expect(html).toContain('if (disclosure.open) loadWidget();');
});

test('opts only Quran Study and dedicated Tafsir pages into per-section disclosures', () => {
	const study = fs.readFileSync(path.join(__dirname, '..', 'views', 'section_quran.ejs'), 'utf8');
	const tafsir = fs.readFileSync(path.join(__dirname, '..', 'views', 'tafsir_passage.ejs'), 'utf8');
	const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');

	for (const template of [study, tafsir]) {
		expect(template).toContain('class="mt-4 reflection-section" data-reflection-section');
		expect(template).toContain('collapsible: true');
		expect(template).toContain('collapsed: true');
	}
	expect(study).toContain('widgetId: `quran-passage-comments-${passageLikeId}`');
	expect(study).toContain('data-reflection-disclosure-trigger="quran-passage-comments-<%= passageLikeId %>-disclosure"');
	expect(tafsir).toContain('widgetId: `tafsir-comments-${ayahs[0]');
	expect(script).toContain("$(document).on('click', '[data-reflection-disclosure-trigger]'");
	expect(script.match(/matches\('\.reflection-section\[data-reflection-section\]'\)/g)).toHaveLength(4);
	expect(script.match(/executeInlineScripts\(imported\);/g).length).toBeGreaterThanOrEqual(2);
});
