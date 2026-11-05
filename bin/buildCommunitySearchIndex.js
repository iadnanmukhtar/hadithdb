#!/usr/bin/env node
'use strict';
require('dotenv').config();
require('../lib/Globals');
(async () => {
  try {
    console.log(`Synchronized ${await require('../lib/CommunitySearchIndex').rebuild(count => console.log('Processed ' + count + ' source posts'))} community posts with Elasticsearch.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { global.dbPool.end(); }
})();
