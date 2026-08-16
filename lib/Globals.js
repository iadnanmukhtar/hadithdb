// @ts-check
'use strict';

require('dotenv').config();
const debug = require('./Debug')('hadithdb:SQL');
const HomeDir = require('os').homedir();
const MySQL = require('mysql');
const { MongoClient } = require('mongodb');
const util = require('util');
const { Book, Grade, Grader } = require('./Model');
const QuranTocSubdivisions = require('./QuranTocSubdivisions');

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
 * @property {object} [mongodb]
 * @property {object} [mongodb.connection]
 * @property {string} [mongodb.connection.host]
 * @property {number} [mongodb.connection.port]
 * @property {string} [mongodb.connection.user]
 * @property {string} [mongodb.connection.password]
 * @property {string} [mongodb.connection.database]
 * @property {string} [mongodb.connection.authSource]
 * @property {object} search
 * @property {string} search.domain
 * @property {string} search.itemsPerPage [100]
 * @property {string} search.reindex [true]
 * @property {string} search.findSimilar [false]
 * @property {object} [quran]
 * @property {object} [quran.recitationFeedback]
 * @property {boolean} [quran.recitationFeedback.enabled]
 * @property {string} [quran.recitationFeedback.endpoint]
 * @property {string} [quran.recitationFeedback.model]
 * @property {string} [quran.recitationFeedback.token]
 */

/**
 * @type Settings
 */
global.settings = require(HomeDir + '/.hadithdb/settings.json');
global.settings.cache = Object.assign({ maxAgeDays: 3 }, global.settings.cache || {});
['site', 'blog'].forEach(function (groupName) {
	const group = global.settings[groupName];
	if (!group)
		return;
	['logo', 'logo32', 'logoVector'].forEach(function (property) {
		group[property] = global.utils.staticAssetUrl(group[property]);
	});
});
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
configureMongo();

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

function mongoUriFromConnection(connection) {
  if (!connection || typeof connection !== 'object')
    return null;
  if (connection.uri)
    return connection.uri;
  if (!connection.host)
    return null;

  const user = connection.user ? encodeURIComponent(connection.user) : '';
  const password = connection.password ? encodeURIComponent(connection.password) : '';
  const auth = user ? `${user}${password ? `:${password}` : ''}@` : '';
  const host = connection.host;
  const port = connection.port ? `:${connection.port}` : '';
  const database = connection.database ? `/${encodeURIComponent(connection.database)}` : '';
  const params = new URLSearchParams();
  if (connection.authSource)
    params.set('authSource', connection.authSource);
  return `mongodb://${auth}${host}${port}${database}${params.toString() ? `?${params.toString()}` : ''}`;
}

function configureMongo() {
  const mongoConfig = global.settings.mongodb || {};
  const mongoConnectionConfig = mongoConfig.connection || {};
  const mongoUri = mongoUriFromConnection(mongoConnectionConfig);

  global.mongoClient = null;
  global.mongoDb = null;
  global.mongoConnect = async () => null;

  if (!mongoUri)
    return;

  const client = new MongoClient(mongoUri, Object.assign({
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000
  }, mongoConfig.options || {}));
  let connectPromise = null;

  global.mongoClient = client;
  global.mongoConnect = async () => {
    if (!connectPromise) {
      connectPromise = client.connect()
        .then(() => {
          const dbName = mongoConnectionConfig.database || mongoConfig.database;
          global.mongoDb = dbName ? client.db(dbName) : client.db();
          debug('mongodb connected');
          return global.mongoDb;
        })
        .catch(err => {
          connectPromise = null;
          debug.error(`mongodb connection failed: ${err.message}\n${err.stack || ''}`);
          throw err;
        });
    }
    return connectPromise;
  };
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

QuranTocSubdivisions.preload()
  .then(function () {
    debug('quran toc subdivisions preloaded');
  })
  .catch(function (err) {
    debug.error(`failed to preload Quran toc subdivisions: ${err && err.message ? err.message : err}`);
  });
