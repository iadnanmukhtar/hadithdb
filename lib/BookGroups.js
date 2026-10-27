'use strict';

// Use the author's death year when known, otherwise the publication year.
function sortYear(book) {
	for (const value of [book.death, book.published_year]) {
		const match = String(value || '').match(/\d+/);
		if (match && Number(match[0]) > 0) return Number(match[0]);
	}
	return Infinity;
}

function compareDates(a, b) {
	return sortYear(a) - sortYear(b) || 0;
}

function translationGroups(books) {
	return [20, 21].map(century => ({
		id: `trans-${century}${century === 21 ? 'st' : 'th'}-century`, scope: 'trans', label: `${century}${century === 21 ? 'st' : 'th'} Century`, ordinal: century,
		aliases: books.filter(book => Number(book.hidden) !== 1 && Math.ceil(Number(book.published_year) / 100) === century)
			.slice().sort((a, b) => compareDates(a, b) || a.alias.localeCompare(b.alias)).map(book => book.alias)
	})).filter(group => group.aliases.length);
}

// Group metadata belongs to each books row in properties.searchGroups.
function list(scope, books = global.books || []) {
	const groups = new Map();
	const byAlias = new Map(books.filter(Boolean).map(book => [book.alias, book]));
	for (const book of books) {
		if (!book || (Number(book.hidden) === 1 && !(scope === 'sharh' && book.type === 'sharh'))) continue;
		let properties = book.properties;
		if (typeof properties === 'string' || Buffer.isBuffer(properties)) {
			try { properties = JSON.parse(properties.toString()); } catch (_) { continue; }
		}
		let memberships = properties?.searchGroups;
		if (typeof memberships === 'string' || Buffer.isBuffer(memberships)) {
			try { memberships = JSON.parse(memberships.toString()); } catch (_) { continue; }
		}
		for (const membership of Array.isArray(memberships) ? memberships : []) {
			if (!membership || typeof membership.id !== 'string' || typeof membership.label !== 'string' || (scope && membership.scope !== scope)) continue;
			if (!groups.has(membership.id)) groups.set(membership.id, { ...membership, value: membership.id, label: membership.scope === 'sharh' ? (byAlias.get(membership.hadithBookAlias)?.shortName_en || membership.label) : membership.label.replace(/\b[a-z]/g, letter => letter.toUpperCase()), aliases: [], memberOrdinals: {} });
			const group = groups.get(membership.id);
			if (!group.aliases.includes(book.alias)) group.aliases.push(book.alias);
			group.memberOrdinals[book.alias] = membership.memberOrdinal || 0;
		}
	}
	return Array.from(groups.values()).map(({ memberOrdinals, ...group }) => ({ ...group, aliases: group.aliases.sort((a, b) => compareDates(byAlias.get(a), byAlias.get(b)) || memberOrdinals[a] - memberOrdinals[b]) })).sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0) || a.label.localeCompare(b.label));
}

function expand(values, scope, books) {
	const groups = new Map(list(scope, books).map(group => [group.id, group.aliases]));
	return Array.from(new Set((values || []).flatMap(value => groups.get(value) || [value])));
}

module.exports = { list, expand, translationGroups, sortYear, compareDates };
