/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const Rag = require('../lib/Rag');

const router = express.Router();

router.get('/', async function (req, res) {
	var question = req.query.q || req.query.question;
	if (!wantsJson(req)) {
		res.locals.req = req;
		res.locals.res = res;
		res.render('rag', {
			q: question || '',
			topK: req.query.k || 6,
			books: req.query.b || []
		});
		return;
	}
	if (!question) {
		res.setHeader('Content-Type', 'application/json');
		res.end(JSON.stringify({
			usage: 'GET /rag?q=your question',
			options: {
				b: 'optional book alias or repeated book filters',
				k: 'optional number of sources, 1-10',
				retrieveOnly: 'set to 1 to skip generation'
			}
		}));
		return;
	}
	var result = await Rag.answer(question.toString(), {
		books: req.query.b,
		topK: req.query.k ? parseInt(req.query.k.toString(), 10) : undefined,
		generate: req.query.retrieveOnly !== '1'
	});
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(result));
});

router.post('/', async function (req, res) {
	var result = await Rag.answer(req.body?.question || req.body?.q, {
		books: req.body?.books || req.body?.b,
		topK: req.body?.topK || req.body?.k,
		generate: req.body?.generate !== false && req.body?.retrieveOnly !== true
	});
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(result));
});

router.post('/html', async function (req, res) {
	var result = await Rag.answerWithItems(req.body?.question || req.body?.q, {
		books: req.body?.books || req.body?.b,
		topK: req.body?.topK || req.body?.k,
		generate: req.body?.generate !== false && req.body?.retrieveOnly !== true
	});
	var html = await renderView(req, res, 'rag_results_fragment', {
		items: result.items,
		searchResult: true
	});
	delete result.items;
	result.html = html;
	result.count = result.retrieval.length;
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(result));
});

router.get('/retrieve', async function (req, res) {
	var question = req.query.q || req.query.question;
	var result = await Rag.retrieve(question ? question.toString() : '', {
		books: req.query.b,
		topK: req.query.k ? parseInt(req.query.k.toString(), 10) : undefined
	});
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify({
		question: question,
		retrieval: result
	}));
});

router.get('/similar', async function (req, res) {
	var result = await Rag.similar({
		id: req.query.id,
		tocId: req.query.tocId,
		doctype: req.query.doctype,
		ref: req.query.ref,
		books: req.query.b,
		topK: req.query.k ? parseInt(req.query.k.toString(), 10) : undefined,
		includeLinked: req.query.linked !== '0'
	});
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(result));
});

router.get('/similar-html', async function (req, res) {
	var result = await Rag.similarItems({
		id: req.query.id,
		tocId: req.query.tocId,
		doctype: req.query.doctype,
		ref: req.query.ref,
		books: req.query.b,
		topK: req.query.k ? parseInt(req.query.k.toString(), 10) : undefined,
		includeLinked: req.query.linked !== '0'
	});
	var html = await renderView(req, res, 'rag_similar_fragment', {
		items: result.similar,
		target: result.target,
		query: result.query
	});
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify({
		method: result.method,
		query: result.query,
		count: result.similar.length,
		html: html
	}));
});

function wantsJson(req) {
	if ('json' in req.query)
		return true;
	if (req.xhr)
		return true;
	var accept = req.get('accept') || '';
	return accept.includes('application/json') && !accept.includes('text/html');
}

function renderView(req, res, view, locals) {
	locals = Object.assign(buildRenderLocals(req), locals || {});
	return new Promise(function (resolve, reject) {
		res.app.render(view, locals, function (err, html) {
			if (err)
				return reject(err);
			resolve(html);
		});
	});
}

function buildRenderLocals(req) {
	var site = new Object(global.settings.site);
	site.admin = (req.cookies.admin == global.admin.key);
	site.editMode = false;
	return {
		req: req,
		res: {},
		site: site,
		page: {
			menu: 'RAG',
			title_en: `${site.shortName} | Hadith RAG Search`,
			subtitle_en: 'Hadith RAG Search',
			subtitle: null,
			canonical: '/rag',
			context: {
				fromSearch: true
			}
		}
	};
}

module.exports = router;
