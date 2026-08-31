'use strict';

const fs = require('fs');
const path = require('path');
const Arabic = require('../lib/Arabic');

describe('Hadith share narrator', () => {
	test('transliterates vocalized Arabic narrator names for English display', () => {
		expect(Arabic.toALALCName('أَبِي هُرَيْرَةَ')).toBe('Abī Hurayrah');
		expect(Arabic.toALALCName('المُغِيرَة بْن شُعْبَة')).toBe('al-Mughīrah b. Shuʿbah');
	});

	test('prefers the first rendered isnad timeline narrator and retains the chain fallback', () => {
		const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'sub-views', 'hadith_modal.ejs'), 'utf8');
		expect(template).toContain('const firstTimelineNarrator = timelineNarrators.length ? timelineNarrators[0] : null;');
		expect(template).toContain('firstTimelineNarrator.vocalized_name || firstTimelineNarrator.name');
		expect(template).toContain('const arNarrator = timelineArNarrator ||');
		expect(template).toContain('arabic.toALALCName(timelineArNarrator) : derivedEnNarrator');
	});
});
