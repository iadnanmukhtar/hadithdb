'use strict';

const fs = require('fs');
const path = require('path');

function source(relativePath) {
	return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('dedicated Tafsir passage presentation', () => {
	test('links each range heading to its canonical Tafsir passage', () => {
		const passage = source('views/tafsir_passage.ejs');
		const tafsirs = source('views/sub-views/quran_tafsirs.ejs');
		const styles = source('public/static/css/style.css');

		expect(passage).toContain('tafsirHeadingHref: tafsirPassageHref');
		expect(tafsirs).toContain('class="quran-section-heading-link" href="<%= tafsirHeadingHref %>"');
		expect(styles).toMatch(/\.quran-section-heading-link:hover,[\s\S]*text-decoration: underline;/);
	});

	test('places muted book metadata above only the initial range separator', () => {
		const script = source('public/static/js/script.js');

		expect(script).toContain("container.closest('[data-reader-infinite-page=\"1\"]')");
		expect(script).toContain("container.children('.quran-tafsir-source').length");
		expect(script).toContain("header.addClass('text-muted').insertBefore(container.children('.quran-tafsir-heading').first())");
		expect(script).toContain("'data-tafsir-disabled': book.disabled === true ? '1' : '0'");
		expect(script).toContain(".prop('checked', book.disabled !== true).appendTo(toggleLabel)");
		expect(script).toContain("header.appendTo(panel)");
	});
});
