#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');
const util = require('util');
const { preferredColoredGradeOpinion } = require('./import-hdith-six-books-enrichment');

function connectionSettings() {
	const configured = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.hadithdb', 'settings.json'), 'utf8')).mysql?.connection || {};
	return {
		host: process.env.MYSQL_HOST || configured.host, port: Number(process.env.MYSQL_PORT || configured.port || 3306),
		user: process.env.MYSQL_USER || configured.user, password: process.env.MYSQL_PASSWORD || configured.password || '',
		database: process.env.MYSQL_DATABASE || configured.database || 'hadithdb'
	};
}

async function main() {
	const connection = mysql.createConnection(connectionSettings());
	const query = (sql, values) => util.promisify(connection.query).call(connection, sql, values);
	await util.promisify(connection.connect).call(connection);
	try {
		const rows = await query(`SELECT hg.id, hg.hadith_id, hg.ordinal, hg.grade, hg.grade_category_id
			FROM hadiths h JOIN hdith_hadith_metadata hm ON hm.hadith_id=h.id
			JOIN hdith_hadith_grades hg ON hg.hadith_id=h.id
			WHERE h.gradeId=-1 ORDER BY hg.hadith_id, hg.ordinal, hg.id`);
		const grouped = new Map();
		for (const row of rows) {
			if (!grouped.has(row.hadith_id)) grouped.set(row.hadith_id, []);
			grouped.get(row.hadith_id).push(row);
		}
		let updated = 0;
		for (const [hadithId, opinions] of grouped) {
			const preferred = preferredColoredGradeOpinion(opinions);
			if (!preferred || Number(opinions[0]?.id) === Number(preferred.id)) continue;
			const ordered = [preferred, ...opinions.filter(opinion => Number(opinion.id) !== Number(preferred.id))];
			const cases = ordered.map(() => 'WHEN ? THEN ?').join(' ');
			const values = ordered.flatMap((opinion, index) => [opinion.id, index + 1]);
			await query(`UPDATE hdith_hadith_grades SET ordinal=CASE id ${cases} ELSE ordinal END WHERE hadith_id=?`,
				[...values, hadithId]);
			updated++;
		}
		console.log(`colored grade order: promoted ${updated}/${grouped.size} imported hadith(s)`);
	} finally {
		connection.end();
	}
}

if (require.main === module)
	main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

module.exports = { connectionSettings };
