#!/usr/bin/env node
'use strict';
require('dotenv').config();
const app = require('../app');
(async () => {
  await app.locals.startupPromise;
  const result = await require('../lib/CommunityMail').deliverBatch();
  console.log(JSON.stringify(result));
})().catch(err => { console.error(err.message); process.exitCode = 1; }).finally(() => {
  if (global.dbPool) global.dbPool.end(() => process.exit(process.exitCode || 0));
});
