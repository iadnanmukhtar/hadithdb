'use strict';

const axios = require('axios');
let active = 0;
const queue = [];

function positive(value, fallback) {
	const number = Number(value);
	return Number.isSafeInteger(number) && number > 0 && number <= 2147483647 ? number : fallback;
}

function setting(name, env, fallback) {
	return positive(global.settings?.search?.[name] ?? process.env[env], fallback);
}

function authConfig() {
	const search = global.settings && global.settings.search ? global.settings.search : {};
	const username = search.username || search.user;
	const password = search.password || search.pass;
	if (!username)
		return {};
	return {
		auth: {
			username: username.toString(),
			password: password === undefined || password === null ? '' : password.toString()
		}
	};
}

function axiosConfig(options) {
	const config = Object.assign({}, authConfig(), options || {});
	config.timeout = positive(config.timeout, setting('httpTimeoutMs', 'HADITHDB_SEARCH_HTTP_TIMEOUT_MS', 10000));
	return config;
}

// The deadline includes queue time, DNS/connect time, and response download.
// Keep a running slot until Axios settles after cancellation, so timed-out
// requests cannot silently exceed the concurrency limit.
function request(method, url, data, options) {
	const config = axiosConfig(options);
	const limit = setting('maxConcurrency', 'HADITHDB_SEARCH_MAX_CONCURRENCY', 8);
	const maxQueue = setting('maxQueue', 'HADITHDB_SEARCH_MAX_QUEUE', 128);
	if (active >= limit && queue.length >= maxQueue)
		return Promise.reject(Object.assign(new Error('Elasticsearch request queue is full'), { code: 'ESEARCHBUSY', status: 503 }));
	return new Promise((resolve, reject) => {
		const controller = new AbortController();
		const callerSignal = config.signal;
		const deadline = Date.now() + config.timeout;
		let started = false;
		let done = false;
		let timer;
		const finish = (error, response) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			callerSignal?.removeEventListener('abort', cancel);
			if (!started) {
				const index = queue.indexOf(start);
				if (index >= 0) queue.splice(index, 1);
			}
			if (error) reject(error);
			else resolve(response);
		};
		const abort = error => {
			controller.abort();
			finish(error);
		};
		const cancel = () => abort(Object.assign(new Error('Elasticsearch request canceled'), { code: 'ERR_CANCELED' }));
		const expired = () => abort(Object.assign(new Error('Elasticsearch HTTP deadline exceeded'), { code: 'ECONNABORTED' }));
		const start = () => {
			if (done) return;
			const remaining = deadline - Date.now();
			if (remaining <= 0) { expired(); return; }
			started = true;
			active++;
			const httpConfig = { ...config, timeout: remaining, signal: controller.signal };
			Promise.resolve().then(() => {
				if (controller.signal.aborted) throw Object.assign(new Error('Elasticsearch request canceled'), { code: 'ERR_CANCELED' });
				return ['get', 'head', 'delete'].includes(method)
					? axios[method](url, httpConfig)
					: axios[method](url, data, httpConfig);
			}).then(response => finish(null, response), finish).finally(() => {
				active--;
				drain();
			});
		};
		timer = setTimeout(expired, config.timeout);
		callerSignal?.addEventListener('abort', cancel, { once: true });
		if (callerSignal?.aborted) { cancel(); return; }
		queue.push(start);
		drain();
	});
}

function drain() {
	const limit = setting('maxConcurrency', 'HADITHDB_SEARCH_MAX_CONCURRENCY', 8);
	while (active < limit && queue.length) queue.shift()();
}

module.exports = {
	axiosConfig,
	get: (url, options) => request('get', url, undefined, options),
	head: (url, options) => request('head', url, undefined, options),
	delete: (url, options) => request('delete', url, undefined, options),
	post: (url, data, options) => request('post', url, data, options),
	put: (url, data, options) => request('put', url, data, options)
};
