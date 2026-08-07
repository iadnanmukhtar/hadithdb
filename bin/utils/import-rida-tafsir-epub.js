#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

const { run } = require('./import-tafsir-epub');

run(['--preset', 'rida', ...process.argv.slice(2)]);
