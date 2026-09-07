#!/usr/bin/env node
'use strict';
require('dotenv').config();
require('../lib/Globals');
(async () => {
	try { console.log(await require('../lib/SharhBooks').sync()); }
	catch (error) { console.error(error); process.exitCode = 1; }
	finally { global.dbPool.end(); }
})();
