/* jslint node:true, esversion:8 */
'use strict';

const path = require('path');
const HomeDir = require('os').homedir();
const createError = require('http-errors');
const express = require('express');
const asyncify = require('express-asyncify');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser')
const ExpressAdmin = require('express-admin');
const MySQL = require('mysql');
const Util = require('util');
const Arabic = require('./lib/Arabic');
const Utils = require('./lib/Utils');

global.utils = Utils;
global.arabic = Arabic;

var app = asyncify(express());

var ExpressAdminConfig = {
  dpath: './express-admin/',
  config: require(`${HomeDir}/.hadithdb/express-admin/config.json`),
  settings: require('./express-admin/settings.json'),
  custom: require(`${HomeDir}/.hadithdb/express-admin/custom.json`),
  users: require(`${HomeDir}/.hadithdb/express-admin/users.json`)
};

ExpressAdmin.init(ExpressAdminConfig, function (err, admin) {
  if (err) return console.log(err);

  app.use('/admin', admin);

  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');

  //app.use(logger('dev'));
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());
  app.use(cookieParser());
  app.use('/', express.static(path.join(__dirname, 'public')));

  const toolsRouter = require('./routes/tools');
  const recentRouter = require('./routes/recent');
  const booksRouter = require('./routes/books');
  const indexRouter = require('./routes/index');
  app.use('/tools', toolsRouter);
  app.use('/recent', recentRouter);
  app.use('/books', booksRouter);
  app.use('/', indexRouter);

  app.use(function (req, res, next) {
    next(createError(404));
  });

  app.use(function (err, req, res, next) {
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};
    res.status(err.status || 500);
    res.render('error');
  });

});

// initialize data load
global.MySQLConfig = require(HomeDir + '/.hadithdb/store.json');
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

global.connection = MySQL.createConnection(global.MySQLConfig.connection);
global.query = Util.promisify(global.connection.query).bind(global.connection);
async function a_dbInitApp() {
  console.log('loading books...');
  global.books = await global.query('SELECT * FROM books ORDER BY id ASC');
  console.log('loading tags...');
  global.tags = await global.query('SELECT * FROM tags');
  console.log('loading grades...');
  global.grades = await global.query('SELECT * FROM grades');
  console.log('loading graders...');
  global.graders = await global.query('SELECT * FROM graders');
  console.log('done loading hadith data');

  // console.log('fix hadith decimal numbers');
  // var rows = await global.query(`SELECT * FROM hadiths WHERE num REGEXP "[^0-9]" ORDER BY bookId`);
  // console.log(`fixing ${rows.length} numbers`);
  // for (var i = 0; i < rows.length; i++) {
  //   var numDec = Hadith.hadithNumtoDecimal(rows[i].num);
  //   console.log(`fixing ${rows[i].bookId}:${rows[i].num} to ${numDec}`);
  //   await global.query(`
  //     UPDATE hadiths SET num0="${numDec}"
  //     WHERE id=${rows[i].id}
  //   `);
  // }
  
  

}
a_dbInitApp();

module.exports = a_dbInitApp;
module.exports = app;