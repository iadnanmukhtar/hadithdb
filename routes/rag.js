/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const debug = require('../lib/Debug')('hadithdb:Chatbot');
const Chatbot = require('../lib/Chatbot');

const router = express.Router();

router.use(function requireAdmin(req, res, next) {
	if (isAdmin(req))
		return next();
	if (isPageRequest(req))
		return res.redirect('/');
	return sendJson(res, 403, {
		error: 'Forbidden',
		message: 'Hadith chatbot is available only in admin mode',
		status: 403
	});
});

router.get('/', async function (req, res) {
	var question = req.query.q || req.query.question;
	if (!wantsJson(req)) {
		res.locals.req = req;
		res.locals.res = res;
		res.render('rag', {
			q: question || ''
		});
		return;
	}
	if (!question) {
		res.setHeader('Content-Type', 'application/json');
		res.end(JSON.stringify({
			usage: 'GET /chatbot?q=your question',
			options: {
				b: 'optional book alias or repeated book filters',
				k: 'optional number of sources, 1-10',
				retrieveOnly: 'set to 1 to skip generation'
			}
		}));
		return;
	}
	var result = await Chatbot.answer(question.toString(), {
		books: req.query.b,
		topK: req.query.k ? parseInt(req.query.k.toString(), 10) : undefined,
		generate: req.query.retrieveOnly !== '1'
	});
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(result));
});

router.post('/', async function (req, res) {
	var result = await Chatbot.answer(req.body?.question || req.body?.q, {
		books: req.body?.books || req.body?.b,
		topK: req.body?.topK || req.body?.k,
		generate: req.body?.generate !== false && req.body?.retrieveOnly !== true
	});
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(result));
});

router.post('/html', async function (req, res) {
	try {
		var result = await Chatbot.answerWithItems(req.body?.question || req.body?.q, {
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
		sendJson(res, 200, result);
	} catch (err) {
		sendJsonError(res, err, 'Hadith chatbot HTML search failed');
	}
});

router.post('/message', async function (req, res) {
	try {
		var result = await Chatbot.chat(req.body?.messages || [{
			role: 'user',
			content: req.body?.question || req.body?.q
		}], {
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
		sendJson(res, 200, result);
	} catch (err) {
		sendJsonError(res, err, 'Hadith chatbot message failed');
	}
});

router.get('/retrieve', async function (req, res) {
	var question = req.query.q || req.query.question;
	var result = await Chatbot.retrieve(question ? question.toString() : '', {
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
	var result = await Chatbot.similar({
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
	try {
		var result = await Chatbot.similarItems({
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
		sendJson(res, 200, {
			method: result.method,
			query: result.query,
			count: result.similar.length,
			html: html
		});
	} catch (err) {
		sendJsonError(res, err, 'Hadith chatbot similar HTML failed');
	}
});

function wantsJson(req) {
	if ('json' in req.query)
		return true;
	if (req.xhr)
		return true;
	var accept = req.get('accept') || '';
	return accept.includes('application/json') && !accept.includes('text/html');
}

function isPageRequest(req) {
	return req.method === 'GET' && req.path === '/' && !wantsJson(req);
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
	var site = Object.assign({}, global.settings.site);
	site.admin = isAdmin(req);
	site.editMode = isEditMode(req);
	return {
		req: req,
		res: {},
		site: site,
		page: {
			menu: 'Chatbot',
			title_en: `Hadith Chatbot`,
			subtitle_en: 'Hadith Chatbot',
			subtitle: null,
			canonical: '/chatbot',
			context: {
				fromSearch: true
			}
		}
	};
}

function isAdmin(req) {
	return req.admin;
}

function isEditMode(req) {
	return isAdmin(req) && req.editMode;
}

function sendJson(res, status, payload) {
	res.status(status);
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(payload));
}

function sendJsonError(res, err, context) {
	var status = err.status || err.statusCode || 500;
	debug.error(`${context}: ${err.message}\n${err.stack || ''}`);
	sendJson(res, status, {
		error: context,
		message: err.message || 'Unexpected chatbot error',
		status: status
	});
}

module.exports = router;
