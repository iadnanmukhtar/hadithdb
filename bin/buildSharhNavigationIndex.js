#!/usr/bin/env node
'use strict';

// Read-only by default. --apply publishes snapshots and invalidates affected HTML.
require('dotenv').config();
require('../lib/Globals');
const mysql = require('mysql');
const Navigation = require('../lib/SharhNavigationIndex');
const Sharh = require('../lib/Sharh');

(async () => {
	try {
		const args = process.argv.slice(2);
		if (args.some(arg => arg !== '--apply' && !arg.startsWith('--book='))) throw new Error('Usage: node bin/buildSharhNavigationIndex.js [--book=alias] [--apply]');
		const alias = args.find(arg => arg.startsWith('--book='))?.slice(7);
		const apply = args.includes('--apply');
		const books = await global.query(`SELECT id, alias FROM books WHERE type='sharh'${alias ? ` AND alias=${mysql.escape(alias)}` : ''} ORDER BY id`);
		if (!books.length) throw new Error('No matching Sharh books');
		if (apply) await Navigation.ensureIndex();
		for (const book of books) {
			const started = Date.now();
			if (apply) console.log(JSON.stringify({ alias: book.alias, entries: await Navigation.refreshBook(book), published: true, ms: Date.now() - started }));
			else {
				const rows = await Sharh.buildReaderSequence(book);
				const doc = Navigation.document(book, rows);
				if (!Navigation.valid(doc, book)) throw new Error(`Invalid navigation for ${book.alias}`);
				const indexed = await Navigation.read(book);
				console.log(JSON.stringify({ alias: book.alias, entries: rows.length, bytes: Buffer.byteLength(JSON.stringify(doc)), matchesIndex: JSON.stringify(indexed) === JSON.stringify(rows), dryRun: true, ms: Date.now() - started }));
			}
		}
	} catch (error) { console.error(error.message); process.exitCode = 1; }
	finally { global.dbPool.end(); }
})();
