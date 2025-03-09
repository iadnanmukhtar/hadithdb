require('dotenv').config();
require('../lib/Globals');
const utils = require('../lib/Utils');
const Index = require('../lib/Index');
const { Item, Library, Heading } = require('../lib/Model');

(async () => {
	global.library = await Library.init();
	var bookId = process.argv[2];
	var level = process.argv[3];
	if (!level)
		level = '2';
	if (!bookId)
		bookId = '3';
	var headings = await global.query(`SELECT * FROM v_toc WHERE book_id=${bookId} 
		AND (h${level}_title_en IS NULL OR h${level}_title_en = '') AND (h${level}_title IS NOT NULL AND h${level}_title != '' AND h${level}_title != 'باب')
		AND level=${level}
		ORDER BY ordinal`);
	for (var heading of headings)
		await translate(heading);
	process.exit();
})();

async function translate(heading) {
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
			heading[`h${level}_title_en`] = await utils.openai('gpt-4o', `Translate the following heading into English and don't include the prompt answer: ${title}`);
			console.log(`Fix ${heading.ref}...`);
			heading[`h${level}_title_en`] = heading[`h${level}_title_en`].replace(/^"/, '');
			heading[`h${level}_title_en`] = heading[`h${level}_title_en`].replace(/"$/, '');
			heading[`h${level}_title_en`] = utils.replacePBUH('[Machine] ' + utils.trimToEmpty(heading['h' + level + '_title_en']));
			console.log(`Update ${heading.ref}...`);
			await global.query(`UPDATE toc SET title_en="${utils.escSQL(heading['h' + level + '_title_en'])}" WHERE id=${heading.tId}`);
			await Index.update(Heading.INDEX, heading);
		}
	} catch (e) {
		console.log(e.message);
	}
}