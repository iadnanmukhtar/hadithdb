// @ts-check
'use strict';

require('dotenv').config();
const debugFactory = require('debug');
const util = require('util');

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
	if (logger.enabled) {
		logger(`${level}: ${message}`);
		return;
	}
	debugFactory.log(formatPlain(logger.namespace || 'hadithdb', level, message));
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

module.exports = createLogger;
