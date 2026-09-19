'use strict';

const Pairs = require('./HadithBilingualPairs');

async function attach(rows, query = global.query) {
	const ids = [...new Set(rows.map(row => Number(row.hId || row.id)).filter(id => Number.isSafeInteger(id) && id > 0))];
	if (!ids.length) return rows;
	const [metadata, narrators, managed] = await Promise.all([
		query(`SELECT hadith_id,narrator,narrator_en FROM hdith_hadith_metadata WHERE hadith_id IN (${ids.join(',')})`),
		query(`SELECT hn.hadith_id,hn.ordinal,COALESCE(NULLIF(n.name_tashkil,''),n.name) AS name,n.name_ala_lc
			FROM hdith_hadith_narrators hn JOIN hdith_narrators n ON n.id=hn.narrator_id
			WHERE hn.hadith_id IN (${ids.join(',')}) ORDER BY hn.hadith_id,hn.ordinal`),
		Pairs.managed('narrator', query)
	]);
	const primary = new Map(metadata.map(row => [Number(row.hadith_id), row]));
	const chains = new Map();
	for (const row of narrators) {
		const chain = chains.get(Number(row.hadith_id)) || [];
		chain.push(Pairs.resolve(managed, 'narrator', row.name, row.name_ala_lc));
		chains.set(Number(row.hadith_id), chain);
	}
	for (const row of rows) {
		const id = Number(row.hId || row.id), source = primary.get(id);
		const chain = chains.get(id) || [];
		const pair = Pairs.resolve(managed, 'narrator', source?.narrator, source?.narrator_en);
		row.narrator = pair.value_ar;
		row.narrator_en = pair.value_en;
		row.narrator_names_search = [...new Set([pair, ...chain].map(p => Pairs.normalize(p.value_ar)).filter(Boolean))];
		row.narrator_names_en_search = [...new Set([pair, ...chain].map(p => Pairs.normalize(p.value_en)).filter(Boolean))];
	}
	return rows;
}

async function reindex(hadithIds) {
	const Index = require('./Index');
	const ids = [...new Set(hadithIds.map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
	for (let offset = 0; offset < ids.length; offset += 100) {
		const batch = ids.slice(offset, offset + 100);
		const rows = await global.query(`SELECT * FROM v_hadiths WHERE hId IN (${batch.join(',')}) ORDER BY ordinal`);
		const found = new Set(rows.map(row => Number(row.hId)));
		if (batch.some(id => !found.has(id))) throw new Error('Unable to load all affected hadiths for narrator indexing');
		await Index.updateBulkPartial('hadiths', rows);
	}
	if (ids.length) await Index.refresh('hadiths');
}

module.exports = { attach, reindex };
