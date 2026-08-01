#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('../lib/Globals');
const QuranAyahMemorization = require('../lib/QuranAyahMemorization');

async function main() {
  const apply = process.argv.includes('--apply');
  if (apply && process.argv.includes('--dry-run'))
    throw new Error('Choose either --apply or --dry-run, not both.');
  const report = await QuranAyahMemorization.optimizeSchema({ apply });
  console.log(JSON.stringify(report, null, 2));
  if (!apply)
    console.log('Dry run only. Re-run with --apply to optimize the memorization schema.');
}

main().catch(function (err) {
  console.error(err && err.stack || err);
  process.exitCode = 1;
}).finally(function () {
  if (global.dbPool && typeof global.dbPool.end === 'function')
    global.dbPool.end();
});
