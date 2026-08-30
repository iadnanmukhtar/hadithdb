#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');
const util = require('util');
const HadithAttributions = require('../lib/HadithAttributions');

function connectionSettings() {
	const settingsFile = path.join(os.homedir(), '.hadithdb', 'settings.json');
	const configured = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).mysql?.connection || {};
	return {
		host: process.env.MYSQL_HOST || configured.host || '127.0.0.1',
		port: Number(process.env.MYSQL_PORT || configured.port || 3306),
		user: process.env.MYSQL_USER || configured.user || process.env.USER,
		password: process.env.MYSQL_PASSWORD || configured.password || '',
		database: process.env.MYSQL_DATABASE || configured.database || 'hadithdb'
	};
}

async function main() {
	const connection = mysql.createConnection(connectionSettings());
	const query = (sql, values) => util.promisify(connection.query).call(connection, sql, values);
	try {
		await util.promisify(connection.connect).call(connection);
		await HadithAttributions.ensureSchema(query, { backfill: true });
		const counts = await query(`SELECT a.id, a.attribution_en, a.attribution, COUNT(h.id) AS hadith_count
			FROM attributions a LEFT JOIN hadiths h ON h.attributionId=a.id
			GROUP BY a.id, a.attribution_en, a.attribution ORDER BY CASE WHEN a.id < 0 THEN 9999 ELSE a.id END`);
		counts.forEach(row => console.log(`${row.id}\t${row.attribution_en}\t${row.attribution}\t${row.hadith_count}`));
	} finally {
		await util.promisify(connection.end).call(connection);
	}
}

if (require.main === module)
	main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { connectionSettings };
