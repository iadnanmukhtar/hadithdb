'use strict';

const debug = require('debug')('hadithdb:proxy');
const express = require('express');
const axios = require('axios');
const https = require('https')

const router = express.Router();

router.get('/tafsir', async function (req, res) {
  const src = (req.query.src || '').toString();
  const surah = Number(req.query.s);
  const ayah = Number(req.query.a);
  const version = Number(req.query.ver || 1);
  const tafsir = global.tafsirs.find(function (item) {
    return item.alias === src;
  });

  if (!tafsir || !Number.isInteger(surah) || surah < 1 || surah > 114 ||
      !Number.isInteger(ayah) || ayah < 1 || !Number.isInteger(version) || version < 1) {
    res.status(400).json({ error: 'Invalid tafsir request.' });
    return;
  }

  const response = await axios.get('https://tafsir.app/get.php', {
    params: {
      src: src,
      s: surah,
      a: ayah,
      ver: version
    },
    timeout: 10000
  });
  res.setHeader('Cache-Control', 'public, max-age=14400');
  res.json(response.data);
});

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
    var url = new URL(req.params.url);
    headers.host = url.host;
    try {
      resource = await fetch(url.toString(), { method: 'GET', headers: headers, agent: agent });
      text = await resource.text();
    } catch (e) {
      console.log(e);
    }
    res.send(text);
    res.end();
    return;
  } catch (e) {
    console.log(`Proxy: ${req.params.url} ${e}`);
    throw new ReferenceError(`Proxy: ${req.params.url} ${e}`);
  }
});

module.exports = router;
