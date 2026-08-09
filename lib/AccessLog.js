// @ts-check
'use strict';

require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');

const ACCESS_LOG_ROTATION_MS = 7 * 24 * 60 * 60 * 1000;
const ROTATION_CHECK_INTERVAL_MS = 60 * 1000;
let lastRotationCheck = 0;

function accessLogMiddleware(req, res, next) {
	if (!process.env.ACCESS_LOG_FILE)
		return next();

	const startedAt = performance.now();
	let logged = false;
	const logRequest = () => {
		if (logged)
			return;
		logged = true;
		writeAccessLog(`${JSON.stringify(buildAccessLog(req, res, performance.now() - startedAt))}\n`);
	};

	res.once('finish', logRequest);
	res.once('close', logRequest);
	next();
}

function writeAccessLog(line) {
	const configuredLogFile = process.env.ACCESS_LOG_FILE;
	if (!configuredLogFile)
		return;
	const logFile = resolveLogFile(configuredLogFile);
	try {
		fs.mkdirSync(path.dirname(logFile), { recursive: true });
	} catch (err) {
		process.stderr.write(`${new Date().toISOString()} hadithdb access log error: ${err.message}\n`);
		return;
	}
	const now = Date.now();
	if (now - lastRotationCheck >= ROTATION_CHECK_INTERVAL_MS) {
		lastRotationCheck = now;
		rotateAccessLog(logFile, now);
	}
	fs.appendFile(logFile, line, err => {
		if (err)
			process.stderr.write(`${new Date().toISOString()} hadithdb access log error: ${err.message}\n`);
	});
}

function resolveLogFile(logFile) {
	if (logFile === '~')
		return os.homedir();
	if (logFile.startsWith('~/'))
		return path.join(os.homedir(), logFile.slice(2));
	return logFile;
}

function rotateAccessLog(logFile, now = Date.now(), maxAgeMs = ACCESS_LOG_ROTATION_MS) {
	let stats;
	try {
		stats = fs.statSync(logFile);
	} catch (err) {
		if (err.code !== 'ENOENT')
			logRotationError(err);
		return;
	}
	const createdAt = stats.birthtimeMs || stats.ctimeMs;
	if (now - createdAt < maxAgeMs)
		return;

	const lockFile = `${logFile}.rotate.lock`;
	let lockFd;
	try {
		lockFd = fs.openSync(lockFile, 'wx');
	} catch (err) {
		if (err.code !== 'EEXIST')
			logRotationError(err);
		return;
	}
	try {
		// Another PM2 worker may have completed the rotation before this lock was acquired.
		const lockedStats = fs.statSync(logFile);
		const lockedCreatedAt = lockedStats.birthtimeMs || lockedStats.ctimeMs;
		if (now - lockedCreatedAt < maxAgeMs)
			return;
		const backupFile = `${logFile}.1`;
		fs.rmSync(backupFile, { force: true });
		fs.renameSync(logFile, backupFile);
	} catch (err) {
		if (err.code !== 'ENOENT')
			logRotationError(err);
	} finally {
		fs.closeSync(lockFd);
		fs.rmSync(lockFile, { force: true });
	}
}

function logRotationError(err) {
	process.stderr.write(`${new Date().toISOString()} hadithdb access log rotation error: ${err.message}\n`);
}

function buildAccessLog(req, res, elapsedMs) {
	const contentLength = res.getHeader && res.getHeader('content-length');
	return {
		timestamp: new Date().toISOString(),
		type: 'access',
		worker: process.env.NODE_APP_INSTANCE || process.env.pm_id || '0',
		pid: process.pid,
		clientIp: req.clientIp || req.ip || (req.socket && req.socket.remoteAddress) || '',
		method: req.method,
		url: req.originalUrl || req.url,
		status: res.statusCode,
		bytes: contentLength === undefined ? null : Number(contentLength),
		durationMs: Number(elapsedMs.toFixed(1)),
		referrer: requestHeader(req, 'referer') || '',
		userAgent: requestHeader(req, 'user-agent') || ''
	};
}

function requestHeader(req, name) {
	if (typeof req.get === 'function')
		return req.get(name);
	return req.headers && req.headers[name];
}

module.exports = accessLogMiddleware;
module.exports.buildAccessLog = buildAccessLog;
module.exports.rotateAccessLog = rotateAccessLog;
module.exports.resolveLogFile = resolveLogFile;
