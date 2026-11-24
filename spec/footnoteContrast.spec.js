'use strict';

const fs = require('fs');
const path = require('path');

describe('muted content contrast', () => {
	test('uses one darker adaptive color for footnotes, metadata, and Hadith chains', () => {
		const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'css', 'style.css'), 'utf8');

		expect(css).toContain('--c-muted: color-mix(in srgb, var(--bs-body-color) 62%, var(--bs-body-bg) 38%);');
		expect(css).toContain('--c-gray-mid: var(--c-muted);');
		expect(css).toContain('--c-footnote-muted: var(--c-muted);');
		expect(css).toMatch(/\.text-muted \{\s*color: var\(--c-gray-mid\) !important;/);
		expect(css).toMatch(/\.h \.chain \{\s*color: var\(--c-gray-mid\) !important;/);
		expect(css).toMatch(/sup \{\s*color: var\(--c-footnote-muted\);/);
		const shared = fs.readFileSync(path.join(__dirname, '../public/static/css/ux-foundations.css'), 'utf8');
		expect(shared).toMatch(/body :is\(\.footnotes, footer\.footnote,[^)]*\) \{\s*color: var\(--c-footnote-muted,/);
		expect(shared).toMatch(/body \.footnote-ref a, body \.footnote-backref \{ color: var\(--c-footnote-muted,/);
	});
});
