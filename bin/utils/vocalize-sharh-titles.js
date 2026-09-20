#!/usr/bin/env node
'use strict';

// Display metadata only: imported source titles also serve as identity keys.
const titles = [
	'فَتْحُ الْبَارِي (ابْنُ حَجَرٍ)',
	'عُمْدَةُ الْقَارِي (بَدْرُ الدِّينِ الْعَيْنِيُّ)',
	'الْمِنْهَاجُ (النَّوَوِيُّ)',
	'عَوْنُ الْمَعْبُودِ (مُحَمَّد أَشْرَف)',
	'تُحْفَةُ الْأَحْوَذِيِّ (الْمُبَارَكْفُورِى)',
	'حَاشِيَةُ السُّيُوطِيِّ عَلَى سُنَنِ التِّرْمِذِيِّ',
	'حَاشِيَةُ السِّنْدِيِّ عَلَى سُنَنِ النَّسَائِيِّ',
	'حَاشِيَةُ السِّنْدِيِّ عَلَى بْنِ مَاجَهْ',
	'فَتْحُ الْبَارِي (ابْنُ رَجَبٍ)',
	'الْمُفْهِمُ (أَبُو الْعَبَّاسِ)',
	'الْإِعْلَامُ بِسُنَّتِهِ عَلَيْهِ الصَّلَاةُ وَالسَّلَامُ (الْمُغَلْطَائِيُّ)',
	'التَّمْهِيدُ لِمَا فِي الْمُوَطَّأِ (ابْنُ عَبْدِ الْبَرِّ)',
	'الِاسْتِذْكَارُ الْجَامِعُ لِمَذَاهِبِ فُقَهَاءِ الْأَمْصَارِ وَعُلَمَاءِ الْأَقْطَارِ',
	'شَرْحُ الزُّرْقَانِيِّ عَلَى الْمُوَطَّأِ (عَبْدُ الْبَاقِي)',
	'الدُّرَرُ السَّنِيَّةُ',
	'شَرْحٌ مُخَصَّصٌ',
	'خَصَائِلُ نَبَوِيٍّ (مُحَمَّد زَكَرِيَّا)',
	'عَادِل صَلَاحِي',
	'شَرْحُ رِيَاضِ الصَّالِحِينَ (ابْنُ الْعُثَيْمِينِ)',
	'شَرْحُ الْأَرْبَعِينَ النَّوَوِيَّةِ (ابْنُ دَقِيقِ الْعِيدِ)',
	'جَامِعُ الْعُلُومِ وَالْحِكَمِ (ابْنُ رَجَبٍ)',
	'مُسْنَدُ أَحْمَدَ ط. الرِّسَالَةِ (الْأَرْنَاؤُوطُ)',
	'شَرْحٌ مُخْتَصَرٌ',
	'جَمْعُ الْوَسَائِلِ فِي شَرْحِ الشَّمَائِلِ',
	'دَلِيلُ الْفَالِحِينَ (ابْنُ عَلَّانَ)'
];
const strip = value => value.replace(/[\u064b-\u0652\u0670]/gu, '');
const replacements = new Map(titles.map(title => [strip(title), title]));

async function main() {
	require('../../lib/Globals');
	const fs = require('fs/promises');
	const path = require('path');
	const os = require('os');
	const { promisify } = require('util');
	const axios = require('axios');
	const SearchHttp = require('../../lib/SearchHttp');
	const Utils = require('../../lib/Utils');
	const connection = await promisify(global.dbPool.getConnection).call(global.dbPool);
	const query = promisify(connection.query).bind(connection);
	const apply = process.argv.includes('--apply');
	try {
		await query('START TRANSACTION');
		const rows = await query("SELECT id,alias,shortName,name,title FROM books WHERE type='sharh' ORDER BY id FOR UPDATE");
		const changes = rows.map(row => {
			const after = {};
			for (const field of ['shortName', 'name', 'title']) {
				if (!/[\u0621-\u064a]/u.test(row[field] || '')) continue;
				const value = replacements.get(strip(row[field]));
				if (!value) throw new Error(`Unrecognized Arabic ${field}: ${row.id} ${row[field]}`);
				if (value !== row[field]) after[field] = value;
			}
			return { before: row, after };
		}).filter(change => Object.keys(change.after).length);
		console.log(JSON.stringify({ apply, books: rows.length, updates: changes.length, changes }, null, 2));
		if (!apply) { await query('ROLLBACK'); return; }
		if (changes.length) {
			const directory = path.join(os.homedir(), '.hadithdb', 'backups');
			await fs.mkdir(directory, { recursive: true });
			const backup = path.join(directory, `sharh-titles-${Date.now()}.json`);
			await fs.writeFile(backup, JSON.stringify(changes, null, 2), { flag: 'wx', mode: 0o600 });
			console.log(`Backup: ${backup}`);
			for (const { before, after } of changes) {
				await query('UPDATE books SET ?, content_lastmod=CURRENT_TIMESTAMP() WHERE id=?', [after, before.id]);
			}
		}
		await query('COMMIT');
		// Refresh even on a repeated apply, so interrupted post-commit work is recoverable.
		const updated = await query("SELECT id,alias,shortName,title FROM books WHERE type='sharh' ORDER BY id");
		for (const row of updated) {
			await Utils.flushCacheContaining(row.alias);
			await Utils.flushBookDiskCache(row.alias);
		}
		await Utils.flushCachedFile(Utils.cacheFileFromFilename('_books'));
		await Utils.flushCachedFile(path.join(os.homedir(), '.hadithdb/cache/_books.html'));
		await require('../../lib/RuntimeRefresh').publish();
		console.log('Database titles and caches updated; runtime refresh published.');
		for (const row of updated) {
			const response = await axios.post(`${global.settings.search.domain}/sharhs/_update_by_query?refresh=true`, {
				query: { term: { bookId: row.id } },
				script: { lang: 'painless', source: 'ctx._source.commentary_shortName = params.shortName; ctx._source.commentary_name = params.title;', params: { shortName: row.shortName, title: row.title } }
			}, SearchHttp.axiosConfig({ timeout: 120000 }));
			if (response.data.failures?.length || response.data.timed_out) throw new Error(JSON.stringify(response.data));
			console.log(`Search ${row.alias}: ${response.data.updated} updated`);
		}
		console.log('Sharh titles, search metadata, caches, and runtime refresh complete.');
	} catch (error) {
		await query('ROLLBACK');
		throw error;
	} finally {
		connection.release();
	}
}

if (require.main === module) main().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
module.exports = { titles, strip };
