'use strict';
const express = require('express');
const createError = require('http-errors');
const Sharh = require('../lib/Sharh');
const Tafsir = require('../lib/Tafsir');
const router = express.Router();
router.use((req, res, next) => {
	res.locals.req = req;
	res.locals.res = res;
	// These pages read current SQL content, including immediately after edits.
	res.setHeader('Cache-Control', 'no-store');
	next();
});
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/', handle(async (req, res) => {
	res.render('sharh_catalog', { books: await Sharh.catalog() });
}));
async function passage(req, res, next) {
	const kind = req.params.kind || (req.route.path.includes('/heading/') ? 'heading' : 'hadith');
	const data = kind === 'heading' ? await Sharh.entryById(req.params.id, kind) : await Sharh.entryByReference(req.params.alias, req.params.reference);
	if (!data) return res.sendStatus(404);
	if (req.params.alias && req.params.alias !== data.book.alias) return next(createError(404, 'Sharh not found'));
	const [readerContext, availableSharhs] = await Promise.all([Sharh.readerContext(data), Sharh.availableBooks(data)]);
	res.render('sharh_passage', { ...data, readerContext, availableSharhs, Tafsir });
}
router.get('/:alias/heading/:id', handle(passage));
router.get('/:alias/:reference', handle(passage));
router.get('/:alias', handle(async (req, res, next) => {
	const books = await Sharh.catalog();
	const book = books.find(book => book.alias === req.params.alias);
	if (!book) return next(createError(404, 'Sharh book not found'));
	res.render('sharh_books', { books, sharhBook: book, coveredBooks: await Sharh.coveredBooks(book), entries: [], offset: 0, Sharh });
}));
module.exports = router;
