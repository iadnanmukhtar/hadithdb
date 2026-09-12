#!/usr/bin/env node
require('dotenv').config();
require('../lib/Globals');
const utils = require('../lib/Utils');
const BulkTranslations = require('../lib/BulkTranslations');
const Index = require('../lib/Index');
const { Item, Library } = require('../lib/Model');

(async () => {
	global.library = await Library.init();
	const options = BulkTranslations.readOptions(process.argv.slice(2));
	var bookId = options.positional[0];
	var num0 = options.positional[1];
	if (!num0)
		num0 = '0';
	if (!bookId)
		bookId = '8';
	var items = await global.query(`SELECT * FROM v_hadiths WHERE book_id=${bookId} 
		AND (body_en IS NULL OR body_en = '') AND (body IS NOT NULL AND body != '')
		AND num0 >= ${num0}
		ORDER BY ordinal`);
	for (var item of items)
		await translate(item, options);
	process.exit();
})();

async function translate(item, options) {
	try {
		item = await Item.itemFromRef(item.hId);
		if (utils.isFalsey(item.body_en)) {
			console.log(`Translating ${item.ref}...`);
			item.body_en = await BulkTranslations.translate(`Treat this as a hadith matn from classical Islamic hadith literature.\nContent type: hadith matn.\nHadith collection: ${item.book_name_en || item.book_shortName_en || item.book_name || item.book_shortName || item.book_alias || ''}.\nReference: ${item.ref || ''}.\nChapter context: ${item.h1_title_en || item.h2_title_en || item.h3_title_en || item.h1_title || item.h2_title || item.h3_title || ''}.\nTranslate the following matn into clear English using its collection and chapter context. In personal names, render ibn/bin as "b." and bint as "bt.". Return only the translation:\n${item.body}`, {
				targetLanguage: 'en',
				provider: options.provider,
				model: options.model
			});
			item.body_en = utils.replacePBUH('✧ ' + utils.trimToEmpty(item.body_en));
			await global.query(`UPDATE hadiths SET body_en="${utils.escSQL(item.body_en)}", temp_trans=1 WHERE id=${item.hId}`);
			await Index.update(Item.INDEX, item);
		}
	} catch (e) {
		console.log(e.message);
	}
}
