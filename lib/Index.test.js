// @ts-check
'use strict';
require('./Globals');
const Index = require("./Index");

describe('Index tests', () => {

	test('from id', async () => {
		var doc;
		expect((doc = await Index.docFromId('hadiths', 71825))).toBeDefined();
		expect(doc.hId).toBe(71825);
		expect((doc = await Index.docFromId('toc', 20308))).toBeDefined();
		expect(doc.tId).toBe(20308);
	});

	test('from object array', async () => {
		var docs;
		expect((docs = await Index.docsFromObjectArray('hadiths', [{ id: 71825 }, { id: 71826 }], 'id', 0))).toBeInstanceOf(Array);
		expect(docs.length).toBe(2);
		expect(docs[0].hId).toBe(71825);
		expect((docs = await Index.docsFromObjectArray('toc', [{ id: 20308 }, { id: 20309 }], 'id', 0))).toBeInstanceOf(Array);
		expect(docs.length).toBe(2);
		expect(docs[0].hId).toBe(20308);
	});

	test('from id array', async () => {
		var docs;
		expect((docs = await Index.docsFromIdArray('hadiths', [71825, 71826], 0))).toBeInstanceOf(Array);
		expect(docs.length).toBe(2);
		expect(docs[0].hId).toBe(71825);
	});

	test('from key value', async () => {
		var docs;
		expect((docs = await Index.docsFromKeyValue('hadiths', { ref: 'muslim:2924b' }, 0))).toBeInstanceOf(Array);
		expect(docs.length).toBe(1);
		expect(docs[0].ref).toBe('muslim:2924b');
		expect((docs = await Index.docsFromKeyValue('hadiths', { ref: 'quran:114:6' }, 0))).toBeInstanceOf(Array);
		expect(docs.length).toBe(1);
		expect(docs[0].ref).toBe('quran:114:6');
	});

	test('sort', async () => {
		var docs;
		expect((docs = await Index.docsFromQueryString('hadiths',
			'book_alias:quran AND h1:1', 0, 10, 'ordinal DESC'))).toBeInstanceOf(Array);
		expect(docs.length).toBe(7);
		expect(docs[0].ref).toBe('quran:1:7');
	});


});