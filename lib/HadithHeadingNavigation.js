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
	const field = level === 1 ? 'h1' : 'ordinal';
	const value = Number(level === 1 ? heading.h1 : heading.ordinal);
	const [previous, next] = await Promise.all([
		documents(`${baseQuery} AND ${field}:<${value}`, `${field} DESC`),
		documents(`${baseQuery} AND ${field}:>${value}`, `${field} ASC`)
	]);

	let previousHeading = previous[0] || null;
	let nextHeading = next[0] || null;
	const wrapPrevious = !previousHeading && Number(heading.h1) === 0;
	const inspectFirst = !nextHeading;
	if (wrapPrevious || inspectFirst) {
		const [last, first] = await Promise.all([
			wrapPrevious ? documents(baseQuery, `${field} DESC`) : Promise.resolve([]),
			inspectFirst ? documents(baseQuery, `${field} ASC`) : Promise.resolve([])
		]);
		if (wrapPrevious)
			previousHeading = last[0] || null;
		if (inspectFirst && Number(first[0] && first[0].h1) === 0)
			nextHeading = first[0];
	}

	heading.prev = previousHeading ? Heading.toLevel(previousHeading) : null;
	heading.next = nextHeading ? Heading.toLevel(nextHeading) : null;
	return heading;
}

module.exports = { applySameBookHeadingNavigation };
