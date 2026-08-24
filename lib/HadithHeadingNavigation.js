'use strict';

const Index = require('./Index');
const { Heading } = require('./Model');

async function documents(query, orderBy) {
	return Index.docsFromQueryString(Heading.INDEX, query, 0, 1, orderBy);
}

async function applySameBookHeadingNavigation(heading) {
	if (!heading || !heading.book_alias || !Number.isFinite(Number(heading.ordinal)))
		return heading;
	const level = Number(heading.level);
	if (level !== 1 && level !== 2)
		return heading;

	const baseQuery = `book_alias:${heading.book_alias} AND level:${level}`;
	const introduction = await documents(`${baseQuery} AND h1:0`, 'ordinal ASC');
	const cyclic = introduction.length > 0;
	const field = level === 1 ? 'h1' : 'ordinal';
	const value = Number(level === 1 ? heading.h1 : heading.ordinal);
	const previous = await documents(`${baseQuery} AND ${field}:<${value}`, `${field} DESC`);
	const next = await documents(`${baseQuery} AND ${field}:>${value}`, `${field} ASC`);

	let previousHeading = previous[0] || null;
	let nextHeading = next[0] || null;
	if (cyclic && !previousHeading)
		previousHeading = (await documents(baseQuery, `${field} DESC`))[0] || null;
	if (cyclic && !nextHeading)
		nextHeading = (await documents(baseQuery, `${field} ASC`))[0] || null;

	heading.prev = previousHeading ? Heading.toLevel(previousHeading) : null;
	heading.next = nextHeading ? Heading.toLevel(nextHeading) : null;
	return heading;
}

module.exports = { applySameBookHeadingNavigation };
