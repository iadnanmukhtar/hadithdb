require('dotenv').config();
const axios = require('axios');
require('../lib/Globals');
const utils = require('../lib/Utils');
const Index = require('../lib/Index');
const { Item, Heading } = require('../lib/Model');

const BATCH_SIZE = 2;

(async () => {
	var bookId = process.argv[2];
	if (!bookId)
		bookId = '8';
	var items = await global.query(`SELECT * FROM v_hadiths WHERE book_id=${bookId} AND (body_en IS NULL OR body_en = '') AND (body IS NOT NULL AND body != '') ORDER BY ordinal`);
	var prompts = [];
	var itemIds = [];
	for (var item of items) {
		console.log(`translating ${item.book_id}:${item.num} ${item.body.substring(0, 50)}...`);
		item = (await global.query(`SELECT * FROM v_hadiths WHERE hId=${item.hId}`))[0];
		prompts.push(`Translate the following into English: ${item.body}`);
		itemIds.push(item.hId);
		if (prompts.length == BATCH_SIZE) {
			await translate(itemIds, prompts);
			prompts = [];
		}
	}
	if (prompts.length > 0)
	await translate(itemIds, prompts);
process.exit();
})();

async function translate(itemIds, prompts) {
	try {
		const res = await utils.openai('gpt-3.5-turbo', prompts);
		// item.body_en = utils.replacePBUH('[Machine] ' + utils.trimToEmpty(item.body_en));
		// await global.query(`UPDATE hadiths SET body_en="${utils.escSQL(item.body_en)}", temp_trans=1 WHERE id=${item.hId}`);
		// await Index.update(Item.INDEX, item);
	} catch (e) {
		console.log(e.message);
	}
}