'use strict';

const debug = require('debug')('hadithdb:proxy');
const express = require('express');
const asyncify = require('express-asyncify').default;
const axios = require('axios');
const https = require('https')

const router = asyncify(express.Router());

router.get('/:url', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  debug(`Proxy: ${req.params.url}`);
  try {
    const agent = new https.Agent({
      rejectUnauthorized: false
    });
    fetch(req.params.url, { method: 'GET', headers: req.headers, agent: agent })
       .then(resource => resource.json())
       .then(resource => {
         res.end(resource);
         return;
       })
       .catch(error => {
         console.log(error);
         res.status(500).send(error);
       });
  } catch (e) {
    console.log(`Proxy: ${req.params.url} ${e}`);
    throw new ReferenceError(`Proxy: ${req.params.url} ${e}`);
  }
});

module.exports = router;

