'use strict';

const fs = require('fs');
const path = require('path');

describe('Quran Study selected passage ayah highlight', () => {
	test('matches searched Mushaf ayah colors for Arabic and English without changing the hero', () => {
		const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'css', 'style.css'), 'utf8');
		const selectedPassageRules = css.match(/\.quran-passage-section \[lang="ar"\] \.body \.ayah-selected,[\s\S]*?\.body\.passage:lang\(ar\) \.ayah-selected \.quran-corpus-word \{([^}]+)\}/);
		const selectedEnglishRules = css.match(/\.quran-passage-section \[lang="en"\] \.body \.ayah-selected,[\s\S]*?\.body\.passage:lang\(en\) \.ayah-selected \{([^}]+)\}/);

		expect(selectedPassageRules).not.toBeNull();
		expect(selectedPassageRules[1]).toContain('background-color: var(--c-cornsilk)');
		expect(selectedPassageRules[1]).toContain('color: var(--c-link-dark)');
		expect(selectedPassageRules[1]).toContain('font-weight: 400');
		expect(selectedEnglishRules).not.toBeNull();
		expect(selectedEnglishRules[1]).toContain('background-color: var(--c-cornsilk)');
		expect(selectedEnglishRules[1]).toContain('color: var(--c-link-dark)');
		expect(selectedEnglishRules[1]).toContain('font-weight: 400');
		expect(css).not.toContain('.quran-selected-ayah-hero .quran-ayah-hero [lang="ar"] .quran-ayah-hero-ayah {');
	});
});
