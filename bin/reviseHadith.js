require('dotenv').config();
require('../lib/Globals');

const { Library } = require('../lib/Model');
const HadithRevision = require('../lib/HadithRevision');

(async () => {
	global.library = await Library.init();

	var num0 = process.argv[2] || '0';
	var limit = parseInt(process.argv[3] || '0', 10);

	var sql =
`SELECT * FROM v_hadiths
WHERE book_id BETWEEN 8 AND 15
	AND (body_en LIKE '[Machine]%' OR body_en LIKE '[AI]%')
	AND body IS NOT NULL AND body != ''
	AND num0 >= ${parseInt(num0, 10)}
ORDER BY ordinal`;
	if (Number.isInteger(limit) && limit > 0)
		sql += ` LIMIT ${limit}`;

	var items = await global.query(sql);
	console.log(`Found ${items.length} hadith(s) to revise in books 8-15.`);

	for (var item of items)
		await translate(item);

	process.exit();
})().catch((e) => {
	console.log(e.message);
	process.exit(1);
});

async function translate(item) {
	try {
		console.log(`Revising ${item.ref}...`);
		await HadithRevision.reviseHadith(item);
		console.log(`Updated ${item.ref}`);
	} catch (e) {
		console.log(`${item.ref}: ${e.message}`);
	}
}
