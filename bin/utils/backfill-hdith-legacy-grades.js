#!/usr/bin/env node
/* jslint node:true, esversion:11 */
'use strict';

require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql');
const os = require('os');
const path = require('path');
const util = require('util');
const { legacyGradeForOpinion, normalizeArabicForMatch, preferredLegacyOpinion } = require('./import-hdith-six-books-enrichment');

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
		const [grades, graders, rows] = await Promise.all([
			query('SELECT id, grade FROM grades WHERE id<>-1'),
			query('SELECT id, shortName, name FROM graders'),
			query(`SELECT h.id hadith_id, hg.grader, hg.grade
				FROM hadiths h JOIN hdith_hadith_grades hg ON hg.hadith_id=h.id
				WHERE h.gradeId IS NULL OR h.gradeId=-1 ORDER BY h.id, hg.ordinal, hg.id`)
		]);
		const grouped = new Map();
		for (const row of rows) {
			if (!grouped.has(row.hadith_id)) grouped.set(row.hadith_id, []);
			grouped.get(row.hadith_id).push(row);
		}
		let updated = 0;
		for (const [hadithId, opinions] of grouped) {
			const opinion = preferredLegacyOpinion(opinions);
			const grade = legacyGradeForOpinion(opinion, grades);
			if (!opinion || !grade) continue;
			const normalized = normalizeArabicForMatch(opinion.grader);
			const grader = graders.find(candidate => {
				const names = `${normalizeArabicForMatch(candidate.shortName)} ${normalizeArabicForMatch(candidate.name)}`;
				return /الارنا?و+ط/.test(normalized) ? /الارنا?و+ط/.test(names) : /الالباني/.test(names);
			});
			if (!grader) continue;
			const result = await query('UPDATE hadiths SET gradeId=?, graderId=? WHERE id=? AND (gradeId IS NULL OR gradeId=-1)',
				[grade.id, grader.id, hadithId]);
			updated += result.affectedRows;
		}
		console.log(`legacy grades: updated ${updated} hadith(s)`);
	} finally {
		connection.end();
	}
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
