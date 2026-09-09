'use strict';

// Group metadata belongs to each books row in properties.searchGroups.
function list(scope, books = global.books || []) {
	const groups = new Map();
	for (const book of books) {
		if (!book || Number(book.hidden) === 1) continue;
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
			if (!groups.has(membership.id)) groups.set(membership.id, { ...membership, value: membership.id, label: membership.label.replace(/\b[a-z]/g, letter => letter.toUpperCase()), aliases: [], memberOrdinals: {} });
			const group = groups.get(membership.id);
			if (!group.aliases.includes(book.alias)) group.aliases.push(book.alias);
			group.memberOrdinals[book.alias] = membership.memberOrdinal || 0;
		}
	}
	return Array.from(groups.values()).map(({ memberOrdinals, ...group }) => ({ ...group, aliases: group.aliases.sort((a, b) => memberOrdinals[a] - memberOrdinals[b]) })).sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0) || a.label.localeCompare(b.label));
}

function expand(values, scope, books) {
	const groups = new Map(list(scope, books).map(group => [group.id, group.aliases]));
	return Array.from(new Set((values || []).flatMap(value => groups.get(value) || [value])));
}

module.exports = { list, expand };
