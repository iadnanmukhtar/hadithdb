'use strict';

const fs = require('fs');
const path = require('path');

test('places the default Tafsir first only in the English Tafsir tab on /books', () => {
	const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'books.ejs'), 'utf8');

	expect(template).toContain("if (group.lang === 'en' && Tafsir.isDefaultTafsir(a) !== Tafsir.isDefaultTafsir(b))");
	expect(template).toContain('return Tafsir.isDefaultTafsir(a) ? -1 : 1;');
	expect(template.indexOf("group.lang === 'en'")).toBeLessThan(template.indexOf('var aDeath = tafsirDeathYear(a);'));
});
