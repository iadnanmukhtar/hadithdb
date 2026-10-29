#!/usr/bin/env node
'use strict';
require('dotenv').config();
const app = require('../app');
(async()=>{
  await app.locals.startupPromise;
  console.log(JSON.stringify(await require('../lib/ActivityPubWorker').run()));
})().catch(err=>{console.error(err.message);process.exitCode=1;}).finally(()=>{
  if (global.dbPool) global.dbPool.end(()=>process.exit(process.exitCode||0));
});
