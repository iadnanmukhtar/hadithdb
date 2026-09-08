'use strict';

const express = require('express');
const Books = require('../lib/Books');
const router = require('../routes/search');

describe('punctuation-insensitive book aliases', () => {
	let server;
	let base;
	const book = { id: 90, alias: 'ibnhisham', type: 'sirah', hidden: 0 };
	const redirect = router.stack.find(layer => layer.name === 'redirectCanonicalBookAlias').handle;

	beforeAll(async () => {
		const app = express();
		app.use(redirect);
		app.use((_req, res) => res.sendStatus(204));
		server = await new Promise(resolve => {
			const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
		});
		base = `http://127.0.0.1:${server.address().port}`;
	});
	beforeEach(() => { global.books = [book]; });
	afterEach(() => { delete global.books; });
	afterAll(() => new Promise(resolve => server.close(resolve)));

	test.each(['ibn-hisham', 'ibn.hisham', 'ibn|hisham', 'ibn_hisham', 'Ibn—Hisham', 'ibnhisham'])('resolves %s to the stored book', alias => {
		expect(Books.findByAlias(alias)).toBe(book);
	});
	test('matches punctuation in stored aliases and prefers exact matches', () => {
		const hyphenated = { alias: 'ibn-hisham' };
		expect(Books.findByAlias('ibnhisham', [hyphenated])).toBe(hyphenated);
		expect(Books.findByAlias('ibnhisham', [hyphenated, book])).toBe(book);
		expect(Books.findByAlias('...|--')).toBeNull();
	});
	test.each(['', '/introduction', '/1', '/1/2', ':12', '.json', '.epub'])('redirects a reader URL with suffix %s, preserving its query', async suffix => {
		const response = await fetch(`${base}/ibn%7Chisham${suffix}?x=a%2Bb&o=2`, { redirect: 'manual' });
		expect(response.status).toBe(301);
		expect(response.headers.get('location')).toBe(`/ibnhisham${suffix}?x=a%2Bb&o=2`);
	});
	test.each(['/ibnhisham', '/missing-book', '/...'])('leaves canonical and unknown paths alone: %s', async path => {
		expect((await fetch(base + path, { redirect: 'manual' })).status).toBe(204);
	});
	test('does not expose hidden books or redirect writes', async () => {
		global.books = [{ ...book, hidden: 1 }];
		expect((await fetch(base + '/ibn-hisham', { redirect: 'manual' })).status).toBe(204);
		global.books = [book];
		expect((await fetch(base + '/ibn-hisham', { method: 'POST', redirect: 'manual' })).status).toBe(204);
	});
});
