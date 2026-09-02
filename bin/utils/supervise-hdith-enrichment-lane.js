#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');
const util = require('util');
const { SUPPORTED_BOOKS } = require('./import-hdith-six-books-enrichment');

const books = String(process.argv[process.argv.indexOf('--books') + 1] || '').split(',').filter(Boolean);
const lane = String(process.argv[process.argv.indexOf('--lane') + 1] || 'lane');
const replayFirst = process.argv.includes('--replay-first');
const configs = books.map(slug => SUPPORTED_BOOKS.find(book => book.sourceSlug === slug));
if (!books.length || configs.some(config => !config)) throw new Error('Usage: supervise-hdith-enrichment-lane.js --lane NAME --books b-N,b-N');

const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb', 'settings.json'), 'utf8')).mysql?.connection || {};
const logDir = '/tmp/hadithdb-import-logs';
const monitorLog = path.join(logDir, `${lane}-supervisor.log`);
let child = null;
let stopping = false;
let lastEnriched = null;
let unchangedChecks = 0;

function log(message) {
	const line = `${new Date().toISOString()} ${message}`;
	fs.appendFileSync(monitorLog, `${line}\n`);
	console.log(line);
}

function connect() {
	return mysql.createConnection({
		host: process.env.MYSQL_HOST || settings.host, port: Number(process.env.MYSQL_PORT || settings.port || 3306),
		user: process.env.MYSQL_USER || settings.user, password: process.env.MYSQL_PASSWORD || settings.password || '',
		database: process.env.MYSQL_DATABASE || settings.database || 'hadithdb'
	});
}

async function status(config) {
	const connection = connect();
	const query = (sql, values) => util.promisify(connection.query).call(connection, sql, values);
	try {
		await util.promisify(connection.connect).call(connection);
		return (await query(`SELECT COUNT(h.id) total, COUNT(DISTINCT m.hadith_id) enriched, MAX(m.source_entry_id) source_id
			FROM hadiths h LEFT JOIN hdith_hadith_metadata m ON m.hadith_id=h.id AND m.source_book_slug=? WHERE h.bookId=?`,
			[config.sourceSlug, config.bookId]))[0];
	} finally {
		connection.end();
	}
}

async function waitForDatabase() {
	while (!stopping) {
		try { const connection = connect(); await util.promisify(connection.connect).call(connection); connection.end(); return; }
		catch (error) { log(`database unavailable (${error.code || error.message}); retrying in 30s`); await wait(30000); }
	}
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function runBook(config) {
	while (!stopping) {
		await waitForDatabase();
		const before = await status(config);
		const args = ['bin/utils/import-hdith-six-books-enrichment.js', '--apply', '--book', config.sourceSlug, '--delay', '100'];
		const replaying = replayFirst && config === configs[0];
		if (before.source_id && !replaying) args.push('--resume-source-id', String(Number(before.source_id) + 1));
		const output = fs.openSync(path.join(logDir, `${config.sourceSlug}.log`), 'a');
		log(`${config.alias}: launching at ${before.enriched}/${before.total}${replaying ? ' replaying from the first source' : (before.source_id ? ` after source ${before.source_id}` : '')}`);
		child = spawn(process.execPath, args, { cwd: path.resolve(__dirname, '../..'), stdio: ['ignore', output, output] });
		lastEnriched = Number(before.enriched); unchangedChecks = 0;
		const monitor = setInterval(async () => {
			try {
				const current = await status(config);
				const percent = current.total ? (100 * current.enriched / current.total).toFixed(2) : '0.00';
				log(`${config.alias}: ${current.enriched}/${current.total} (${percent}%), source ${current.source_id || 'none'}, pid ${child?.pid || 'none'}`);
				unchangedChecks = Number(current.enriched) === lastEnriched ? unchangedChecks + 1 : 0;
				lastEnriched = Number(current.enriched);
				if (unchangedChecks >= 2 && child && child.exitCode === null) {
					log(`${config.alias}: stalled for two checks; terminating for checkpoint restart`);
					child.kill('SIGTERM');
				}
			} catch (error) { log(`${config.alias}: monitor error ${error.code || error.message}`); }
		}, 600000);
		const code = await new Promise(resolve => child.once('exit', resolve));
		clearInterval(monitor); fs.closeSync(output); child = null;
		if (stopping) return false;
		if (code === 0) { log(`${config.alias}: completed successfully`); return true; }
		log(`${config.alias}: exited ${code}; restarting from committed checkpoint in 30s`);
		await wait(30000);
	}
	return false;
}

async function main() {
	fs.mkdirSync(logDir, { recursive: true });
	for (const config of configs) if (!(await runBook(config))) break;
	log('lane complete');
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
	stopping = true;
	if (child && child.exitCode === null) child.kill('SIGTERM');
});

main().catch(error => { log(`fatal: ${error.stack || error}`); process.exitCode = 1; });
