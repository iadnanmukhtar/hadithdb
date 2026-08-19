'use strict';

const createError = require('http-errors');

function notSatisfiable(unit, length, message) {
	length = Number(length);
	const safeLength = Number.isSafeInteger(length) && length >= 0 ? length : 0;
	const error = createError(416, message || 'Requested range is not satisfiable');
	error.headers = {
		'Accept-Ranges': unit,
		'Content-Range': `${unit} */${safeLength}`
	};
	return error;
}

function parseOffset(value) {
	if (value === undefined || value === null || value === '')
		return 0;
	if (Array.isArray(value) || !/^-?\d+$/.test(value.toString()))
		throw createError(400, `Invalid query parameter 'o=${value}': offset must be an integer`);
	const offset = Number(value);
	if (!Number.isSafeInteger(offset))
		throw createError(400, `Invalid query parameter 'o=${value}': offset must be a safe integer`);
	return offset;
}

function itemOffsetNotSatisfiable(offset, length, label) {
	const numericLength = Number(length);
	const knownLength = Number.isSafeInteger(numericLength) && numericLength >= 0;
	if (offset >= 0 && (!knownLength || offset === 0 || offset < numericLength))
		return null;
	return notSatisfiable('items', knownLength ? numericLength : 0,
		`${label || 'Content'} does not have content at offset ${offset}`);
}

module.exports = { notSatisfiable, parseOffset, itemOffsetNotSatisfiable };
