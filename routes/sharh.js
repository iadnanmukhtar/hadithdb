'use strict';
const express = require('express');
const createError = require('http-errors');
const Sharh = require('../lib/Sharh');
const HadithHeadingOutlines = require('../lib/HadithHeadingOutlines');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');
const ejs = require('ejs');
const router = express.Router();
router.use((req, res, next) => {
	res.locals.req = req;
	res.locals.res = res;
	// Browser responses stay fresh; public passage HTML uses the shared disk cache.
	res.setHeader('Cache-Control', 'no-store');
	next();
});
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/', handle(async (req, res) => {
	res.render('sharh_catalog', { books: await Sharh.catalog() });
}));
async function passage(req, res, next) {
	const kind = req.params.kind || (req.route.path.includes('/heading/') ? 'heading' : 'hadith');
	const editMode = Boolean(req.admin && req.editMode);
	const cacheEnabled = Utils.diskCacheEnabled();
	const cachedFile = Utils.cacheFileFromFilename(Utils.cacheReqToFilename({
		...req, url: req.originalUrl || req.url || req.path
	}), 'html', req.params.alias, 'sharh');
	const flushCache = Utils.shouldFlushCache(req);
	if (flushCache) await Utils.flushCachedFile(cachedFile, { strict: true });
	if (cacheEnabled && !editMode && !flushCache && Utils.cachedTextPathForRead(cachedFile)) {
		if (Utils.sendCachedHtml(res, req, cachedFile)) return;
		await Utils.flushCachedFile(cachedFile);
	}
	const data = kind === 'heading' ? await Sharh.entryById(req.params.id, kind) : await Sharh.entryByReference(req.params.alias, req.params.reference);
	if (!data) return res.sendStatus(404);
	if (req.params.alias && req.params.alias !== data.book.alias) return next(createError(404, 'Sharh not found'));
	const [readerContext, availableSharhs] = await Promise.all([Sharh.readerContext(data), Sharh.availableBooks(data)]);
	const [readerNavigation, hadithHeadingOutlines] = await Promise.all([
		Sharh.readerNavigation(data),
		readerContext?.chapter ? HadithHeadingOutlines.forChapter(readerContext.chapter) : {}
	]);
	const renderLocals = { ...data, readerContext, availableSharhs, readerNavigation, hadithHeadingOutlines, Tafsir };
	if (cacheEnabled && !editMode) {
		const html = await ejs.renderFile(`${__dirname}/../views/sharh_passage.ejs`, Utils.cachedRenderLocals(res, {
			...renderLocals, req, noadmin: true
		}));
		Utils.writeCachedHtml(cachedFile, html);
		// Existing hadith, heading and book edit invalidators use these same keys.
		const aliases = new Set([data.book.alias, data.owner.book_alias, readerContext?.book?.alias,
			...availableSharhs.map(book => book.alias)].filter(Boolean));
		const refs = [...aliases].flatMap(alias => [alias, `book:${alias}`]);
		if (kind === 'hadith') refs.push(`${data.owner.book_alias}:${data.owner.num}`);
		await Utils.indexCachedItem(refs, cachedFile);
		if (Utils.sendCachedHtml(res, req, cachedFile)) return;
	}
	res.render('sharh_passage', renderLocals);
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
