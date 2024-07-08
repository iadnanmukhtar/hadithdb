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
    var resource;
    var text;
    var headers = req.headers;
    headers.host = 'localhost';
    console.log(headers);
    try {
      resource = await fetch(req.params.url, { method: 'GET', headers: headers, agent: agent });
      text = await resource.text();
    } catch (e) {
      console.log(e);
    }
    console.log(text);
    res.send(text);
    res.end();
    return;
    // fetch(req.params.url, { method: 'GET', headers: req.headers, agent: agent })
    //    .then(resource => resource.json())
    //    .then(resource => {
    //      res.send(resource);
    //      res.end();
    //      return;
    //    })
    //    .catch(error => {
    //      console.log(error);
    //      res.status(500).send(error);
    //      res.end();
    //    });
  } catch (e) {
    console.log(`Proxy: ${req.params.url} ${e}`);
    throw new ReferenceError(`Proxy: ${req.params.url} ${e}`);
  }
});

module.exports = router;

