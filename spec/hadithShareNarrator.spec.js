'use strict';

const fs = require('fs');
const path = require('path');
const Arabic = require('../lib/Arabic');

describe('Hadith share narrator', () => {
	test('transliterates vocalized Arabic narrator names for English display', () => {
		expect(Arabic.toALALCName('أَبِي هُرَيْرَةَ')).toBe('Abī Hurayrah');
		expect(Arabic.toALALCName('المُغِيرَة بْن شُعْبَة')).toBe('al-Mughīrah b. Shuʿbah');
	});

	test('prefers the imported primary narrator and retains timeline and chain fallbacks', () => {
		const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_modal.ejs'), 'utf8');
		expect(template).toContain('const importedNarrator = i.hdithNarrator ||');
		expect(template).toContain('const firstTimelineNarrator = timelineNarrators.length ? timelineNarrators[0] : null;');
		expect(template).toContain('firstTimelineNarrator.vocalized_name || firstTimelineNarrator.name');
		expect(template).toContain('const arNarrator = importedArNarrator || timelineArNarrator ||');
		expect(template).toContain('importedNarrator.name_en');
	});

	test('uses the imported narrator on chapter and section pages but prefers returned search fields', () => {
		const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_item.ejs'), 'utf8');
		const searchRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'search.js'), 'utf8');
		expect(template).toContain("page.menu === 'Chapter' || page.menu === 'Section'");
		expect(template).toContain('!!searchResult && !hasReturnedSearchChain && !hasReturnedSearchFootnote');
		expect(template).toContain('function hasReturnedSearchHighlight(fields)');
		expect(template).toContain("hasReturnedSearchHighlight(lang === 'ar' ? ['chain'] : ['chain_en', 'chain_en_search'])");
		expect(template).toContain("hasReturnedSearchHighlight(lang === 'ar' ? ['footnote'] : ['footnote_en', 'footnote_en_search'])");
		expect(template).toContain("var _p = searchResult && isQuranItem ? 'partial' : '';");
		expect(template).toContain('const compactUnmatchedSearchBody = !!searchResult && !isQuranItem && !hasReturnedSearchText;');
		expect(template).toContain("compactUnmatchedSearchBody ? ' search-result-unmatched-body' : ''");
		expect(template).toContain('(langData.footnote && !compactUnmatchedSearchBody) || site.editMode');
		expect(template).toContain('const showPrimaryNarrator = showPrimaryNarratorOnly && !!primaryNarratorText;');
		expect(template).toContain('const displayedChain = showPrimaryNarrator ? primaryNarratorText : langData.chain;');
		expect(template).toContain('showPrimaryNarratorOnly && !primaryNarratorText');
		const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'css', 'style.css'), 'utf8');
		expect(styles).toMatch(/\.search-results \.hadith-body-content\.search-result-unmatched-body \{[\s\S]*?-webkit-line-clamp: 4;[\s\S]*?line-clamp: 4;/);
		expect(template).toContain('title="Ḥadīth Narrator"');
		expect(searchRoute).toContain("result.doctype === 'hadith'");
		expect(searchRoute).toContain('await HdithMetadata.attachClassifications(results.filter');
	});
});
