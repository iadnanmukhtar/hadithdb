'use strict';

const QuranMushaf = require('./QuranMushaf');
const QuranTocSubdivisions = require('./QuranTocSubdivisions');
const Tafsir = require('./Tafsir');

function invalidateQuranMemoryCaches(options) {
	options = options || {};
	Tafsir.invalidateMemoryCaches(options.commentaryAlias);
	QuranTocSubdivisions.invalidateAll();
	if (Number.isInteger(Number(options.mushafPage))) {
		QuranMushaf.invalidatePage(Number(options.mushafPage));
		QuranMushaf.invalidateMappings();
	} else if (options.allMushaf) {
		QuranMushaf.invalidateAll();
	} else {
		QuranMushaf.invalidateMappings();
	}

	try {
		const quranBook = global.library && typeof global.library.findBook === 'function'
			? global.library.findBook('quran')
			: null;
		if (quranBook)
			quranBook.chapters = undefined;
	} catch (_error) {
		// A flush must still clear the independent caches if the library is loading.
	}
}

module.exports = {
	invalidateQuranMemoryCaches
};
