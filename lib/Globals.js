// @ts-check
'user strict';

require('dotenv').config();
const debug = require('debug')('hadithdb:sql');
const HomeDir = require('os').homedir();
const MySQL = require('mysql');
const util = require('util');

// eslint-disable-next-line no-unused-vars
const { Book, Grade, Grader } = require('./Model');

global.qs = require('qs');
global.utils = require("./Utils");
global.arabic = require('./Arabic');
// @ts-ignore
global.surahs = require('./Surahs.json');

/**
 * @typedef {object} Settings
 * @property {object} site
 * @property {string} site.name,
 * @property {string} site.shortName
 * @property {string} site.url
 * @property {string} site.urlOld
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
global.dbPool = MySQL.createPool(MySQLConfig.connection);
var awaitquery = util.promisify(global.dbPool.query).bind(global.dbPool);

/**
 * @param {string} sql 
 * @returns {Promise<*[]>}
 */
global.query = async (sql) => {
  var t0 = new Date().getTime();
  var result = await awaitquery(sql);
  var t = new Date().getTime();
  debug(`${((t-t0)/1000).toFixed(3)} secs  ${sql.trim()}`);
  return result;
}

/**
 * @type Book[]
 */
global.books = [{
  id: -1,
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
