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
    if (req.body.value == '…')
      req.body.value = null;

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
      try {
        await Hadith.a_ReindexTOC(req.params.id);
      } catch (err) {
        console.log(`${err.message}:\n${err.stack}`);
      }

    } else if (type == 'book') {
      var result = await global.query(`UPDATE books SET ${col}=${sql(req.body.value)} WHERE id=${req.params.id}`);
      status.code = 200;
      status.message = result.message;
      await Hadith.a_reinit();

    } else if (type == 'hadith_virtual') {
      var result = "";
      var ids = req.params.id.split(/,/);

      if (col == 'del') {
        var curr = await global.query(`SELECT * from hadiths_virtual WHERE id=${ids[0]}`);
        curr = curr[0];
        result = await global.query(`DELETE FROM hadiths_virtual 
          WHERE bookId=${curr.bookId} AND id=${ids[0]}`);
        await global.query(`SET @n:=0`);
        await global.query(`UPDATE hadiths_virtual SET numInChapter=(@n:=@n+1)
          WHERE bookId=${curr.bookId} AND h1=${curr.h1} ORDER by numInChapter`);
        await global.query(`SET @n:=0`);
        await global.query(`UPDATE hadiths_virtual SET ordinal=(@n:=@n+1)
          ORDER by bookId, h1, numInChapter`);
        
      } else if (col == 'add') {
        var prev = await global.query(`SELECT * from hadiths_virtual WHERE id=${ids[0]}`);
        prev = prev[0];
        result = await global.query(`SET @n:=${prev.numInChapter+1}`);
        result = await global.query(`UPDATE hadiths_virtual SET numInChapter=(@n:=@n+1)
          WHERE bookId=${prev.bookId} AND h1=${prev.h1} AND numInChapter > ${prev.numInChapter}`);
        result = await global.query(`INSERT INTO hadiths_virtual
          (bookId, tocId, numInChapter, num, num0, ref_num) VALUES
          (${prev.bookId}, ${prev.tocId}, ${prev.numInChapter + 1}, "${prev.num + 1}", ${prev.num0}, ${sql(req.body.value)})`);
      } else {
        // hadith virtual
        result = await global.query(`UPDATE hadiths_virtual SET lastmod_user='admin', ${col}=${sql(req.body.value)} WHERE hadithId=${ids[0]}`);
      }
      status.code = 200;
      status.message = result.message;

    } else if (type == 'hadiths_sim') {
      var ids = req.params.id.split(/,/);

      if (col == 'del') {
        var result = await global.query(`DELETE FROM hadiths_sim_candidates 
          WHERE (hadithId1=${ids[0]} AND hadithId2=${ids[1]}) OR (hadithId1=${ids[1]} AND hadithId2=${ids[0]})`);
        result = await global.query(`DELETE FROM hadiths_sim 
          WHERE (hadithId1=${ids[0]} AND hadithId2=${ids[1]}) OR (hadithId1=${ids[1]} AND hadithId2=${ids[0]})`);
      }
      status.code = 200;
      status.message = result.message;
    }

  } catch (err) {
    status.message = err.message;
    status.code = 500;
    console.log(`${status.message}:\n${err.stack}`);
  } finally {
    console.log(`update status:${status.code}, id:${req.params.id}, prop:${prop}, value:${(req.body.value + '').trim().substring(0, 20)}`);
    console.log(status.message);
  }
  res.status(status.code);
  res.end(JSON.stringify(status));
});

function sql(s) {
  if (s) {
    if (s == '…') return null;
    s = s + '';
    s = s.replace(/\u200f/g, '').trim();
    s = s.replace(/\"/g, '\\"').replace(/\'/g, "\\'").replace(/‘/g, "\\‘");
    return '"' + s + '"';
  }
  return null;
}

module.exports = router;
