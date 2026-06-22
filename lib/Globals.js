// @ts-check
'use strict';

require('dotenv').config();
const debug = require('./Debug')('hadithdb:SQL');
const HomeDir = require('os').homedir();
const MySQL = require('mysql');
const util = require('util');
const { Book, Grade, Grader } = require('./Model');

global.qs = require('qs');
global.utils = require("./Utils");
global.arabic = require('./Arabic');
global.quranCorpus = require('./QuranCorpus');
// Surah metadata now lives in the `toc` table; the in-memory cache is populated
// by Surahs.load() (called from Library.init / reloadBooks and buildSearchIndex).
global.surahs = [];

/**
 * @typedef {object} Settings
 * @property {object} site
 * @property {string} site.name,
 * @property {string} site.shortName
 * @property {string} site.url
 * @property {string} site.urlLocal
 * @property {string} site.urlOld
 * @property {string} site.quranUrl
 * @property {string} site.quranUrlLocal
 * @property {string} site.logo
 * @property {string} site.logoVector
 * @property {string} site.desc
 * @property {string} site.owner
 * @property {string} site.email
 * @property {string} site.lang
 * @property {object} admin
 * @property {string} admin.key
 * @property {object} mysql
 * @property {object} mysql.connection
 * @property {string} mysql.connection.host
 * @property {string} mysql.connection.user
 * @property {string} mysql.connection.password
 * @property {string} mysql.connection.database
 * @property {object} search
 * @property {string} search.domain
 * @property {string} search.itemsPerPage [100]
 * @property {string} search.reindex [true]
 * @property {string} search.findSimilar [false]
 */

/**
 * @type Settings
 */
global.settings = require(HomeDir + '/.hadithdb/settings.json');
global.admin = global.settings.admin;

var MySQLConfig = global.settings.mysql;
var mysqlConnectionConfig = Object.assign({
  connectTimeout: 5000,
  acquireTimeout: 5000
}, MySQLConfig.connection);
global.dbPool = MySQL.createPool(mysqlConnectionConfig);
var awaitquery = util.promisify(global.dbPool.query).bind(global.dbPool);
var mysqlKeepAliveMs = Number(MySQLConfig.keepAliveMs !== undefined
  ? MySQLConfig.keepAliveMs
  : (process.env.HADITHDB_MYSQL_KEEPALIVE_MS !== undefined ? process.env.HADITHDB_MYSQL_KEEPALIVE_MS : (5 * 60 * 1000)));

startMysqlKeepAlive();

/**
 * @param {string} sql 
 * @returns {Promise<*[]>}
 */
global.query = async (sql) => {
  const t0 = new Date().getTime();
  const statement = sql.trim();
  debug(`mysql query start ${statement}`);
  try {
    const result = await awaitquery(sql);
    const elapsedMs = Date.now() - t0;
    const rowCount = Array.isArray(result) ? result.length : (result && result.affectedRows !== undefined ? result.affectedRows : 'n/a');
    debug(`mysql query done ${(elapsedMs/1000).toFixed(3)} secs rows=${rowCount} ${statement}`);
    debug.slow('mysql query', elapsedMs, `rows=${rowCount} ${statement}`);
    return result;
  } catch (err) {
    debug.error(`mysql query failed ${((Date.now() - t0)/1000).toFixed(3)} secs ${err.message}\n${err.stack || ''}\n${statement}`);
    throw err;
  }
}

function startMysqlKeepAlive() {
  if (!Number.isFinite(mysqlKeepAliveMs) || mysqlKeepAliveMs <= 0)
    return;
  const timer = setInterval(async () => {
    try {
      await awaitquery('SELECT 1 AS keepalive');
    } catch (err) {
      debug.error(`mysql keepalive failed: ${err.message}\n${err.stack || ''}`);
    }
  }, mysqlKeepAliveMs);
  if (typeof timer.unref === 'function')
    timer.unref();
}

/**
 * @type Book[]
 */
global.books = [{
  id: -1,
  ordinal: -1,
  alias: 'none',
  shortName_en: 'Loading...',
  shortName: "",
  name_en: 'Loading...',
  name: '',
}];

/**
 * @type Grade[]
 */
global.grades = [{
  id: -1,
  hadithId: -1,
  grade_en: 'N/A',
  grade: '',
}];

/**
 * @type Grader[]
 */
global.graders = [{
  id: -1,
  shortName_en: 'N/A',
  shortName: '',
  name_en: '',
  name: '',
}];
global.tags = [];
global.bookCatalog = [];
global.booksByModel = new Map();
global.commentaries = [];
global.commentariesByAlias = new Map();
global.tafsirAppAliases = new Set();
global.tafsirCarouselBooks = null;
global.tafsirFirstPassages = null;
