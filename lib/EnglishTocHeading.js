'use strict';

function normalizeExistingEnglishTocHeading(title) {
	if (title === null || title === undefined)
		return title;
	const original = String(title);
	const marker = original.match(/^✧\s*/u)?.[0] || '';
	let value = marker ? original.slice(marker.length) : original;
	let previous;
	do {
		previous = value;
		value = value
			.replace(/^And\s+/i, '')
			.replace(/^(?:the\s+)?Hadiths?\s+of\s+/i, '')
			.replace(/^(?:the\s+)?Book\s+of\s*/i, '')
			.replace(/^(?:the\s+)?Musnad(?:\s+of)?\s+/i, '');
	} while (value !== previous);
	value = value
		.replace(/^bt\.\s+/i, 'Bint ')
		.replace(/^b\.\s+/i, 'Ibn ');
	const leadingKinshipName = value.match(/^(?:Ibn|Bint)\b/i)?.[0] || '';
	const remainder = leadingKinshipName ? value.slice(leadingKinshipName.length) : value;
	return marker + leadingKinshipName + remainder
		.replace(/\bAl-/g, 'al-')
		.replace(/ؓ/g, 'ᴿᴬ')
		.replace(/\bbint\b/gi, 'bt.')
		.replace(/\bibn\b/gi, 'b.');
}

module.exports = { normalizeExistingEnglishTocHeading };
