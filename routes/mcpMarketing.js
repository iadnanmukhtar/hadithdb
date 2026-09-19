/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const HadithMcp = require('../lib/HadithMcp');

const router = express.Router();

router.get('/schema.json', function (req, res) {
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type('application/json').send(JSON.stringify({
    serverInfo: { name: HadithMcp.SERVER_NAME, version: HadithMcp.SERVER_VERSION },
    protocolVersion: HadithMcp.PROTOCOL_VERSION,
    tools: HadithMcp.TOOLS
  }, null, 2) + '\n');
});

router.get('/', function (req, res) {
  res.locals.req = req;
  res.locals.res = res;
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  res.render('mcp_server');
});

module.exports = router;
