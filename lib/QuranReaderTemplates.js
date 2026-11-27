'use strict';
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
let bundle;

module.exports = function readerTemplates() {
	if (bundle) return bundle;
	const templates = new Map();
	const chrome = new Set(['head', 'header', 'mobile_navigation', 'page_end']);
	function compile(name) {
		if (templates.has(name) || chrome.has(name)) return;
		const file = name === 'section_quran' ? name : 'sub-views/' + name;
		const source = fs.readFileSync(path.join(__dirname, '../views', file + '.ejs'), 'utf8');
		templates.set(name, ejs.compile(source, { client: true, compileDebug: false }).toString());
		for (const match of source.matchAll(/include\('(?:sub-views\/)?([\w-]+)(?:\.ejs)?'/g)) compile(match[1]);
	}
	compile('section_quran');
	bundle = 'window.quranPageSchema=' + require('./PageStructuredData').toString() + ';window.quranStudyViews={' + [...templates].map(([name, fn]) => JSON.stringify(name) + ':' + fn).join(',') + '};';
	return bundle;
};
