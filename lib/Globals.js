// @ts-check
'user strict';

const debug = require('debug')('hadithdb:sql');
const HomeDir = require('os').homedir();
const MySQL = require('mysql');
const util = require('util');
const Arabic = require('./Arabic');
const Utils = require("./Utils");

// @ts-ignore
global.surahs = require('./Surahs.json');

global.utils = Utils;
global.arabic = Arabic;
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

global.books = [{
  id: -1,
  alias: 'none',
  shortName_en: 'Loading...',
  shortName: "",
  name_en: 'Loading...',
  name: '',
}];
global.grades = [{
  id: -1,
  hadithId: -1,
  grade_en: 'N/A',
  grade: '',
}];
global.graders = [{
  id: -1,
  shortName_en: 'N/A',
  shortName: '',
  name_en: '',
  name: '',
}];
global.tags = [];
