#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('../lib/Globals');
const QuranAyahMemorization = require('../lib/QuranAyahMemorization');
const UserSettings = require('../lib/UserSettings');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!dryRun) await QuranAyahMemorization.ensureTables();
  const settings = await UserSettings.initializeMemorizationSettings({ dryRun });
  const assessedStates = dryRun ? null
    : await QuranAyahMemorization.initializeAssessedStates(UserSettings.defaultMemorizationSettings().fsrs);
  console.log(JSON.stringify({
    dry_run: dryRun,
    schema_initialized: !dryRun,
    memorization_settings: UserSettings.defaultMemorizationSettings(),
    users_found: settings.users,
    users_updated: settings.updated,
    assessed_states_initialized: assessedStates
  }, null, 2));
}

main().catch(function (err) {
  console.error(err && err.stack || err);
  process.exitCode = 1;
}).finally(async function () {
  // Globals starts a small set of Quran metadata preloads at process startup.
  // Let them release their connections before closing the one-shot CLI pool.
  await new Promise(resolve => setTimeout(resolve, 1500));
  if (global.dbPool && typeof global.dbPool.end === 'function') global.dbPool.end();
});
