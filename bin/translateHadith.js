require('dotenv').config();
require('../lib/Globals');
const utils = require('../lib/Utils');
const Index = require('../lib/Index');
const { Item, Library } = require('../lib/Model');

(async () => {
	global.library = await Library.init();
	var bookId = process.argv[2];
	var num0 = process.argv[3];
	if (!num0)
		num0 = '0';
	if (!bookId)
		bookId = '8';
	var items = await global.query(`SELECT * FROM v_hadiths WHERE book_id=${bookId} 
		AND (body_en IS NULL OR body_en = '') AND (body IS NOT NULL AND body != '')
		AND num0 >= ${num0}
		ORDER BY ordinal`);
	for (var item of items)
			await translate(item);
	process.exit();
})();

async function translate(item) {
	try {
		item = await Item.itemFromRef(item.hId);
		if (utils.isFalsey(item.body_en)) {
			console.log(`Translating ${item.ref}...`);
			item.body_en = await utils.openai('gpt-3.5-turbo', `Translate the following passage into English and don't include the prompt answer: ${item.body}`);
			item.body_en = utils.replacePBUH('[Machine] ' + utils.trimToEmpty(item.body_en));
			await global.query(`UPDATE hadiths SET body_en="${utils.escSQL(item.body_en)}", temp_trans=1 WHERE id=${item.hId}`);
			await Index.update(Item.INDEX, item);
		}
	} catch (e) {
		console.log(e.message);
	}
}