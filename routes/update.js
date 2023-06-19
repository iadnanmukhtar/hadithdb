/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const createError = require('http-errors');
const asyncify = require('express-asyncify');
const Hadith = require('../lib/Hadith');

const router = asyncify(express.Router());

router.post('/:id/:prop', async function (req, res, next) {
  if (global.admin.key != req.cookies.admin)
    throw createError(403, "Update unauthorized");
  var status = {
    code: 405,
    message: 'Method Not Allowed',
  };
  try {
    var prop = req.params.prop;
    var type = prop.split(/\./)[0]; 
    var col = prop.split(/\./)[1];
    console.log(`updating ${req.params.id} ${prop}: ${(req.body.value + '').trim().substring(0, 20)}`);

    if (type == 'hadith') {
      var result = "";

      if (col == 'tags') {
        var tags = req.body.value.split(/[,; \t\n]/);
        tags.map(t => {
          return t.replace(/^#/, '');
        });
        tags = tags.filter(t => {
          return t.trim().length > 0;
        });
        var vals = '';
        for (var i = 0; i < tags.length; i++) {
          if (vals.length > 0) vals += ', '
          vals += `("${tags[i]}")`;
        }
        if (tags.length > 0)
          result = await global.query(`INSERT IGNORE INTO tags (text_en) VALUES ${vals}`);
          await global.query(`UPDATE hadiths SET tags=NULL WHERE id=${req.params.id}`);
          await global.query(`DELETE FROM hadiths_tags WHERE hadithId=${req.params.id}`);
        for (var i = 0; i < tags.length; i++) {
          var tag = await global.query(`SELECT * FROM tags WHERE text_en="${tags[i]}"`);
          await global.query(`INSERT IGNORE INTO hadiths_tags (hadithId, tagId) VALUES (${req.params.id}, ${tag[0].id})`);
        }
        await Hadith.a_reinit();

      } else { // hadith
        result = await global.query(`UPDATE hadiths SET lastmod_user='admin', ${col}=${sql(req.body.value)} WHERE id=${req.params.id}`);
      }
      status.code = 200;
      status.message = result.message;
      try {
        await Hadith.a_ReindexHadith(req.params.id);
      } catch (err) {
        console.log(`${err.message}:\n${err.stack}`);
      }

    } else if (type == 'tags') {
      var result = await global.query(`UPDATE tags SET ${col}=${sql(req.body.value)} WHERE id=${req.params.id}`);
      status.code = 200;
      status.message = result.message;
      await Hadith.a_reinit();

    } else if (type == 'toc') {
      var result = await global.query(`UPDATE toc SET lastmod_user='admin', ${col}=${sql(req.body.value)} WHERE id=${req.params.id}`);
      status.code = 200;
      status.message = result.message;

    } else if (type == 'book') {
      var result = await global.query(`UPDATE books SET ${col}=${sql(req.body.value)} WHERE id=${req.params.id}`);
      status.code = 200;
      status.message = result.message;
      await Hadith.a_reinit();
    }

  } catch (err) {
    status.message = err.message;
    status.code = 500;
    console.log(`${status.message}:\n${err.stack}`);
  }
  res.status(status.code);
  res.end(JSON.stringify(status));
});

function sql(s) {
  if (s) {
    s = s + '';
    s = s.replace(/\u200f/g, '').trim();
    s = s.replace(/\"/g, '\\"').replace(/\'/g, "\\'").replace(/‘/g, "\\‘");
    return '"' + s + '"';
  }
  return null;
}

module.exports = router;
