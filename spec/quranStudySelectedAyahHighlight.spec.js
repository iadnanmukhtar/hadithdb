'use strict';

const fs = require('fs');
const path = require('path');

describe('Quran Study selected passage ayah highlight', () => {
	test('matches searched Mushaf ayah colors for Arabic and English without changing the hero', () => {
		const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'css', 'style.css'), 'utf8');
		const selectedPassageRules = css.match(/\.quran-passage-section \[lang="ar"\] \.body \.ayah-selected,[^{]*?\.body\.passage:lang\(ar\) \.ayah-selected \{([^}]+)\}/);
		const selectedEnglishRules = css.match(/\.quran-passage-section \[lang="en"\] \.body \.ayah-selected,[^{]*?\.body\.passage:lang\(en\) \.ayah-selected \{([^}]+)\}/);

		expect(selectedPassageRules).not.toBeNull();
		expect(selectedPassageRules[1]).toContain('background-color: var(--c-cornsilk)');
		expect(selectedPassageRules[1]).toContain('color: var(--c-link-dark)');
		expect(selectedPassageRules[1]).toContain('font-weight: 400');
		expect(selectedPassageRules[1]).toContain('--ayah-interaction-background: transparent');
		const interactionRules = css.match(/\.body \.ayah:hover a,[^{]*\.body \.ayah-hover-pair \.quran-ayah-body \{([^}]+)\}/);
		expect(interactionRules[1]).toContain('background-color: var(--ayah-interaction-background, var(--c-cornsilk))');
		// A positioned corpus word with an opaque fill can paint over adjacent Arabic marks.
		const selectedWordRules = [...css.matchAll(/([^{}]*\.ayah-selected[^{}]*\.quran-corpus-word[^{}]*)\{([^}]+)\}/g)];
		expect(selectedWordRules.length).toBeGreaterThan(0);
		for (const rule of selectedWordRules)
			expect(rule[2]).not.toMatch(/background(?:-color)?\s*:/);
		expect(selectedEnglishRules).not.toBeNull();
		expect(selectedEnglishRules[1]).toContain('background-color: var(--c-cornsilk)');
		expect(selectedEnglishRules[1]).toContain('color: var(--c-link-dark)');
		expect(selectedEnglishRules[1]).toContain('font-weight: 400');
		expect(css).not.toContain('.quran-selected-ayah-hero .quran-ayah-hero [lang="ar"] .quran-ayah-hero-ayah {');
	});
});
