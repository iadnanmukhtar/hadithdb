/* jslint node:true, esversion:11 */
'use strict';

const childProcess = require('child_process');
const os = require('os');
const path = require('path');
const util = require('util');
const cheerio = require('cheerio');
const Utils = require('./Utils');

const execFile = util.promisify(childProcess.execFile);
const DORAR_SHARH_SOURCE_BOOK_ID = -2;

function invalidUrlError() {
	const err = new Error('Enter a full dorar.net explanation URL, such as https://dorar.net/hadith/sharh/92164.');
	err.statusCode = 400;
	return err;
}

function normalizeDorarSharhUrl(value) {
	let url;
	try {
		url = new URL(String(value || '').trim());
	} catch (_err) {
		throw invalidUrlError();
	}
	if (url.protocol !== 'https:' || !['dorar.net', 'www.dorar.net'].includes(url.hostname))
		throw invalidUrlError();
	const match = url.pathname.match(/^\/hadith\/sharh\/(\d+)\/?$/);
	if (!match)
		throw invalidUrlError();
	return {
		sourceEntryId: Number(match[1]),
		sourceUrl: `https://dorar.net/hadith/sharh/${Number(match[1])}`
	};
}

function parseDorarSharhHtml(html) {
	const $ = cheerio.load(String(html || ''));
	const $content = $('#sharh-text-content').first();
	if (!$content.length) {
		const err = new Error('The explanation text was not found at that dorar.net URL.');
		err.statusCode = 422;
		throw err;
	}
	$content.find('script, style, button, .visible-xs').remove();
	const contentHtml = ($content.html() || '').replace(/<br\s*\/?\s*>/gi, '</p><p>');
	const text = Utils.htmlToMarkdown(`<p>${contentHtml}</p>`);
	if (!text) {
		const err = new Error('The dorar.net explanation is empty.');
		err.statusCode = 422;
		throw err;
	}
	return text;
}

async function importDorarSharh(value, options = {}) {
	const source = normalizeDorarSharhUrl(value);
	const lightpanda = options.lightpandaBin || process.env.LIGHTPANDA_BIN || path.join(os.homedir(), '.local', 'bin', 'lightpanda');
	const runner = options.execFile || execFile;
	let result;
	try {
		result = await runner(lightpanda, [
			'fetch', '--dump', 'html', '--wait-until', 'networkalmostidle', '--wait-ms', '10000',
			'--obey-robots', '--block-private-networks', source.sourceUrl
		], { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
	} catch (err) {
		const wrapped = new Error(err?.code === 'ENOENT'
			? 'Lightpanda is not installed. Set LIGHTPANDA_BIN to its production executable.'
			: 'Dorar.net could not be retrieved. Try the URL again.');
		wrapped.statusCode = err?.code === 'ENOENT' ? 500 : 502;
		throw wrapped;
	}
	return Object.assign(source, { text: parseDorarSharhHtml(result?.stdout || result) });
}

module.exports = {
	DORAR_SHARH_SOURCE_BOOK_ID,
	importDorarSharh,
	normalizeDorarSharhUrl,
	parseDorarSharhHtml
};
