#!/usr/bin/env node
require('dotenv').config();
require('../lib/Globals');
const utils = require('../lib/Utils');
const BulkTranslations = require('../lib/BulkTranslations');
const Index = require('../lib/Index');
const { Item, Library, Heading } = require('../lib/Model');

(async () => {
	global.library = await Library.init();
	const options = BulkTranslations.readOptions(process.argv.slice(2));
	var bookId = options.positional[0];
	var level = options.positional[1];
	if (!level)
		level = '2';
	if (!bookId)
		bookId = '3';
	var headings = await global.query(`SELECT * FROM v_toc WHERE book_id=${bookId} 
		AND (h${level}_title_en IS NULL OR h${level}_title_en = '') AND (h${level}_title IS NOT NULL AND h${level}_title != '' AND h${level}_title != 'باب')
		AND level=${level}
		ORDER BY ordinal`);
	for (var heading of headings)
		await translate(heading, options);
	process.exit();
})();

async function translate(heading, options) {
	try {
		const level = heading.level;
		heading = await Heading.headingFromRef(heading.path);
		if (utils.isFalsey(heading[`h${level}_title_en`])) {
			console.log(`Translating ${heading.ref}...`);
			var title = heading['h' + level + '_title'];
			title = title.replace(/^كتاب[ :]/, '');
			title = title.replace(/^باب[ :]/, '');
			title = title.replace(/^حديث[ :]/, '');
			title = title.replace(/^ذكر[ :]/, '');
			title = title.replace(/^كِتَابُ[ :]/, '');
			title = title.replace(/^كِتَابٌ[ :]/, '');
			title = title.replace(/^بَابُ[ :]/, '');
			title = title.replace(/^بَابٌ[ :]/, '');
			title = title.replace(/^حديث[ :]/, '');
			title = title.replace(/^ذكر /, '');
			heading[`h${level}_title_en`] = await BulkTranslations.translate(`Treat this as a heading from a classical Islamic hadith book.\nContent type: hadith book heading.\nBook: ${heading.book_name_en || heading.book_shortName_en || heading.book_name || heading.book_shortName || heading.book_alias || ''}.\nReference: ${heading.ref || heading.path || ''}.\nParent heading context: ${heading.h1_title_en || heading.h1_title || ''} / ${heading.h2_title_en || heading.h2_title || ''}.\nTranslate the following heading into clear English. In personal names, render ibn/bin as "b." and bint as "bt.". Return only the heading:\n${title}`, {
				targetLanguage: 'en',
				provider: options.provider,
				model: options.model
			});
			console.log(`Fix ${heading.ref}...`);
			heading[`h${level}_title_en`] = heading[`h${level}_title_en`].replace(/^"/, '');
			heading[`h${level}_title_en`] = heading[`h${level}_title_en`].replace(/"$/, '');
			heading[`h${level}_title_en`] = utils.replacePBUH('✧ ' + utils.trimToEmpty(heading['h' + level + '_title_en']));
			console.log(`Update ${heading.ref}...`);
			await global.query(`UPDATE toc SET title_en="${utils.escSQL(heading['h' + level + '_title_en'])}" WHERE id=${heading.tId}`);
			await Index.update(Heading.INDEX, heading);
		}
	} catch (e) {
		console.log(e.message);
	}
}
