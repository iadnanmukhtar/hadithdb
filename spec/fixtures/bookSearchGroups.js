'use strict';
const seed = require('../../bin/utils/book-search-groups-seed.json');
module.exports = function groupBooks() {
	const books = new Map();
	for (const { aliases, memberEvidence, ...group } of seed) {
		aliases.forEach((alias, memberOrdinal) => {
			if (!books.has(alias)) books.set(alias, { alias, type: group.scope === 'tafsir' ? 'tafsir' : 'hadith', hidden: 0, properties: { searchGroups: [] } });
			books.get(alias).properties.searchGroups.push({ ...group, memberOrdinal, ...memberEvidence?.[alias] });
		});
	}
	return [...books.values()];
};
