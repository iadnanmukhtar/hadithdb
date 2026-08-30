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

test('opts Quran Study, dedicated Tafsir, and Hadith detail pages into per-section disclosures', () => {
	const study = fs.readFileSync(path.join(__dirname, '..', 'views', 'section_quran.ejs'), 'utf8');
	const tafsir = fs.readFileSync(path.join(__dirname, '..', 'views', 'tafsir_passage.ejs'), 'utf8');
	const ayah = fs.readFileSync(path.join(__dirname, '..', 'views', 'translation_passage.ejs'), 'utf8');
	const ayahModal = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'quran_ayah_modal.ejs'), 'utf8');
	const hadith = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith.ejs'), 'utf8');
	const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'js', 'script.js'), 'utf8');

	for (const template of [study, tafsir]) {
		expect(template).toContain('class="mt-4 reflection-section" data-reflection-section');
		expect(template).toContain('collapsible: true');
		expect(template).toContain('collapsed: true');
	}
	expect(hadith).toContain('class="mt-4 reflection-section col-12"');
	expect(hadith).toContain('data-reflection-section');
	expect(hadith).toContain('data-toc-heading-key="reflection"');
	expect(hadith).toContain("heading: 'Reflect on this hadith'");
	expect(hadith).not.toContain('headingAr');
	expect(hadith).toContain('collapsible: true');
	expect(hadith).toContain('collapsed: true');
	expect(hadith.indexOf("include('comment_widget.ejs'")).toBeLessThan(hadith.indexOf("include('hadith_metadata.ejs'"));
	expect(study).toContain('widgetId: `quran-passage-comments-${passageLikeId}`');
	expect(study).toContain("heading: 'Reflect on this Quranic passage'");
	expect(study).toContain('data-reflection-disclosure-trigger="quran-passage-comments-<%= passageLikeId %>-disclosure"');
	expect(tafsir).toContain('widgetId: `tafsir-comments-${ayahs[0]');
	expect(tafsir).toContain("heading: 'Reflect on this tafsir passage'");
	expect(ayah).toContain("heading: 'Reflect on this ayah'");
	expect(ayahModal).toContain("heading: 'Reflect on this ayah'");
	expect(script).toContain("$(document).on('click', '[data-reflection-disclosure-trigger]'");
	expect(script.match(/matches\('\.reflection-section\[data-reflection-section\]'\)/g)).toHaveLength(4);
	expect(script.match(/executeInlineScripts\(imported\);/g).length).toBeGreaterThanOrEqual(2);
});
