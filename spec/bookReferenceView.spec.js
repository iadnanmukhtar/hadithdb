'use strict';

const fs = require('fs');
const path = require('path');
const Books = require('../lib/Books');

function source(relativePath) {
	return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('book reference view property', () => {
	test('defaults to individual items and accepts the section reader opt-in', () => {
		expect(Books.referenceView({})).toBe('item');
		expect(Books.referenceView({ properties: '{"reader":{"referenceView":"section"}}' })).toBe('section');
		expect(Books.referenceView({ properties: { reader: { referenceView: 'unsupported' } } })).toBe('item');
	});

	test('configures Ibn Hisham imports and existing data for section-oriented references', () => {
		expect(source('bin/utils/import-hdith-sirah.js')).toContain("reader:{referenceView:'section'}");
		const migration = source('data/add_book_reference_view.sql');
		expect(migration).toContain("'$.reader.referenceView'");
		expect(migration).toContain("WHERE alias='ibnhisham'");
	});

	test('redirects HTML item references to the configured heading while preserving data formats', () => {
		const route = source('routes/search.js');
		expect(route).toContain("Books.referenceView(book) === 'section'");
		expect(route).toContain("return res.redirect(302, `${headingPath}${appendOriginalQuery(req)}#${String(results[0].num || results[0].id).replace(/:/g, '-')}`)");
		for (const format of ['json', 'tsv', 'md'])
			expect(route).toContain(`!('${format}' in req.query)`);
	});
});
