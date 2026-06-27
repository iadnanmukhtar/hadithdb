// @ts-check
'use strict';

require('dotenv').config();
const debugFactory = require('debug');
const util = require('util');
const { AsyncLocalStorage } = require('async_hooks');

const requestLogContext = new AsyncLocalStorage();

if (!debugFactory.__hadithdbTimestampedFormat) {
	const originalFormatArgs = debugFactory.formatArgs;

	debugFactory.formatArgs = function formatHadithdbDebugArgs(args) {
		originalFormatArgs.call(this, args);
		if (debugFactory.inspectOpts && debugFactory.inspectOpts.hideDate)
			return;
		if (!this.useColors)
			return;
		const timestamp = new Date().toISOString();
		args[0] = `${timestamp} ${args[0]}`;
	};

	Object.defineProperty(debugFactory, '__hadithdbTimestampedFormat', {
		value: true,
		enumerable: false
	});
}

function createLogger(namespace) {
	const logger = debugFactory(namespace);
	if (!logger.__hadithdbAlwaysMethods) {
		logger.info = (...args) => logAlways(logger, 'INFO', args);
		logger.error = (...args) => logAlways(logger, 'ERROR', args);
		logger.slow = (label, elapsedMs, details) => {
			elapsedMs = Number(elapsedMs);
			if (!Number.isFinite(elapsedMs) || elapsedMs < slowDependencyThresholdMs())
				return;
			const suffix = details ? ` ${details}` : '';
			logAlways(logger, 'INFO', [`slow dependency ${label} ${elapsedMs}ms${suffix}`]);
		};
		Object.defineProperty(logger, '__hadithdbAlwaysMethods', {
			value: true,
			enumerable: false
		});
	}
	return logger;
}

Object.keys(debugFactory).forEach(key => {
	createLogger[key] = debugFactory[key];
});

Object.defineProperties(createLogger, {
	inspectOpts: {
		get: () => debugFactory.inspectOpts
	},
	formatArgs: {
		get: () => debugFactory.formatArgs,
		set: value => {
			debugFactory.formatArgs = value;
		}
	},
	log: {
		get: () => debugFactory.log,
		set: value => {
			debugFactory.log = value;
		}
	}
});

function logAlways(logger, level, args) {
	const message = util.formatWithOptions(debugFactory.inspectOpts, ...args);
	const requestUrl = level === 'ERROR' ? currentRequestUrl() : '';
	if (logger.enabled) {
		if (requestUrl)
			logger(`URL: ${requestUrl}`);
		logger(`${level}: ${message}`);
		return;
	}
	const namespace = logger.namespace || 'hadithdb';
	if (requestUrl)
		debugFactory.log(formatPlain(namespace, 'URL', requestUrl));
	debugFactory.log(formatPlain(namespace, level, message));
}

function formatPlain(namespace, level, message) {
	const timestamp = debugFactory.inspectOpts && debugFactory.inspectOpts.hideDate
		? ''
		: `${new Date().toISOString()} `;
	return `${timestamp}${namespace} ${level}: ${message}`;
}

function slowDependencyThresholdMs() {
	const value = Number(process.env.SLOW_DEPENDENCY_MS || 500);
	return Number.isFinite(value) && value >= 0 ? value : 500;
}

function requestContextMiddleware(req, res, next) {
	requestLogContext.run({ url: formatRequestUrl(req) }, next);
}

function currentRequestUrl() {
	const context = requestLogContext.getStore();
	if (!context || !context.url)
		return '';
	return context.url;
}

function formatRequestUrl(req) {
	if (!req)
		return '';
	const originalUrl = req.originalUrl || req.url || '';
	const host = requestHeader(req, 'host');
	if (!host)
		return originalUrl;
	const proto = requestHeader(req, 'x-forwarded-proto') || req.protocol || 'http';
	return `${req.method || 'GET'} ${proto.split(',')[0]}://${host}${originalUrl}`;
}

function requestHeader(req, name) {
	if (!req)
		return '';
	if (typeof req.get === 'function')
		return req.get(name) || '';
	if (req.headers && req.headers[name])
		return req.headers[name];
	return '';
}

module.exports = createLogger;
module.exports.requestContextMiddleware = requestContextMiddleware;
module.exports.formatRequestUrl = formatRequestUrl;
