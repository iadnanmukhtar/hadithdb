#!/usr/bin/env node
'use strict';
require('dotenv').config();
require('../lib/Globals');
const axios = require('axios');
const SearchHttp = require('../lib/SearchHttp');
const SharhIndex = require('../lib/HadithSharhIndex');
(async () => {
	try {
		console.log(await require('../lib/SharhBooks').sync());
		await SharhIndex.ensureIndex();
		let afterId = Number(process.env.SHARH_AFTER_ID) || 0;
		let count = 0;
		while (true) {
			const batch = await SharhIndex.documents(`hs.id > ${afterId}`);
			if (!batch.length) break;
			await SharhIndex.writeBatch(batch);
			afterId = Number(batch[batch.length - 1].id);
			count += batch.length;
			if (count % 5000 === 0) console.log(`Indexed ${count} Sharh entries (after ID ${afterId})`);
		}
		await axios.post(`${global.settings.search.domain}/sharhs/_refresh`, null, SearchHttp.axiosConfig());
		console.log(`Indexed ${count} Sharh entries`);
	} catch (error) { console.error(error.message); process.exitCode = 1; }
	finally { global.dbPool.end(); }
})();
