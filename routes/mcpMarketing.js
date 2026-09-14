/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');

const router = express.Router();

router.get('/', function (req, res) {
  res.locals.req = req;
  res.locals.res = res;
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  res.render('mcp_server');
});

module.exports = router;
