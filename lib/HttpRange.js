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

module.exports = { notSatisfiable };
