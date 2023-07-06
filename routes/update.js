/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const createError = require('http-errors');
const asyncify = require('express-asyncify');
const Hadith = require('../lib/Hadith');
const Arabic = require('../lib/Arabic');
const Utils = require('../lib/Utils');

const router = asyncify(express.Router());

router.post('/:id/:prop', async function (req, res, next) {
  if (global.admin.key != req.cookies.admin)
    throw createError(403, "Update unauthorized");
  var status = {
    code: 405,
    message: 'Method Not Allowed',
    value: req.body.value
  };
  try {
    var ids = req.params.id.split(/,/);
    var prop = req.params.prop;
    var type = prop.split(/\./)[0];
    var col = prop.split(/\./)[1];
    if (status.value == '…')
      status.value = null;
    status.value = Utils.emptyIfNull(Arabic.arabizi2ALALC(status.value)).trim();

    if (type == 'hadith') {
      var result = "";

      if (col == 'tags') {
        var tags = status.value.split(/[,; \t\n]/);
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
        await global.query(`UPDATE hadiths SET tags=NULL WHERE id=${ids[0]}`);
        await global.query(`DELETE FROM hadiths_tags WHERE hadithId=${ids[0]}`);
        for (var i = 0; i < tags.length; i++) {
          var tag = await global.query(`SELECT * FROM tags WHERE text_en="${tags[i]}"`);
          await global.query(`INSERT IGNORE INTO hadiths_tags (hadithId, tagId) VALUES (${ids[0]}, ${tag[0].id})`);
        }
        await Hadith.a_reinit();

      } else if (col == 'moveup' || col == 'movedn') {
        var curr = (await global.query(`SELECT * from hadiths WHERE id=${ids[0]}`))[0];
        var prev = (await global.query(`SELECT * from hadiths WHERE ordinal < ${curr.ordinal} ORDER BY ordinal DESC LIMIT 1`))[0];
        var next = (await global.query(`SELECT * from hadiths WHERE ordinal > ${curr.ordinal} ORDER BY ordinal ASC LIMIT 1`))[0];
        var repl = null;
        if (col == 'moveup')
          repl = prev;
        else if (col == 'moveup')
          repl = next;
        if (repl != null) {
          result = await global.query(`UPDATE hadiths 
            SET
              tocId=${repl.tocId},
              h1=${repl.h1},
              h2=${repl.h2},
              h3=${repl.h3}
            WHERE id=${curr.id} AND bookId=${curr.bookId}`);
          await global.query(`SET @n:=0`);
          await global.query(`UPDATE hadiths SET numInChapter=(@n:=@n+1)
            WHERE bookId=${curr.bookId} AND h1=${repl.h1} ORDER by bookId, h1, ordinal`);
    
        } else
          throw new Error("Invalid command");
        
      } else { // hadith
        result = await global.query(`UPDATE hadiths SET lastmod_user='admin', ${col}=${sql(status.value)} WHERE id=${ids[0]}`);
      }

      status.code = 200;
      status.message = result.message;
      try {
        await Hadith.a_ReindexHadith(ids[0]);
      } catch (err) {
        console.log(`${err.message}:\n${err.stack}`);
      }

    } else if (type == 'tags') {
      var result = await global.query(`UPDATE tags SET ${col}=${sql(status.value)} WHERE id=${ids[0]}`);
      status.code = 200;
      status.message = result.message;
      await Hadith.a_reinit();

    } else if (type == 'toc') {
      var result = await global.query(`UPDATE toc SET lastmod_user='admin', ${col}=${sql(status.value)} WHERE id=${ids[0]}`);
      status.code = 200;
      status.message = result.message;
      try {
        await Hadith.a_ReindexTOC(ids[0]);
      } catch (err) {
        console.log(`${err.message}:\n${err.stack}`);
      }

    } else if (type == 'book') {
      var result = await global.query(`UPDATE books SET ${col}=${sql(status.value)} WHERE id=${ids[0]}`);
      status.code = 200;
      status.message = result.message;
      await Hadith.a_reinit();

    } else if (type == 'hadith_virtual') {
      var result = "";

      if (col == 'del') {
        var curr = (await global.query(`SELECT * from hadiths_virtual WHERE id=${ids[0]}`))[0];
        result = await global.query(`DELETE FROM hadiths_virtual 
          WHERE bookId=${curr.bookId} AND id=${ids[0]}`);
        await global.query(`SET @n:=0`);
        await global.query(`UPDATE hadiths_virtual SET numInChapter=(@n:=@n+1)
          WHERE bookId=${curr.bookId} AND h1=${curr.h1} ORDER by bookId, h1, num0`);
        await global.query(`SET @n:=0`);
        await global.query(`UPDATE hadiths_virtual SET ordinal=(@n:=@n+1)
          ORDER by bookId, h1, num0`);
        
      } else if (col == 'add') {
        var curr = (await global.query(`SELECT * from hadiths_virtual WHERE id=${ids[0]}`))[0];
        result = await global.query(`SET @n:=${curr.numInChapter+1}`);
        result = await global.query(`UPDATE hadiths_virtual SET numInChapter=(@n:=@n+1)
          WHERE bookId=${curr.bookId} AND h1=${curr.h1} AND numInChapter > ${curr.numInChapter}`);
        result = await global.query(`INSERT INTO hadiths_virtual
          (bookId, tocId, numInChapter, num, num0, ref_num) VALUES
          (${curr.bookId}, ${curr.tocId}, ${curr.numInChapter + 1}, "${curr.num + 1}", ${curr.num0}, ${sql(status.value)})`);

      } else {
        // hadith virtual
        result = await global.query(`UPDATE hadiths_virtual SET lastmod_user='admin', ${col}=${sql(status.value)} WHERE hadithId=${ids[0]}`);
      }
      status.code = 200;
      status.message = result.message;

    } else if (type == 'hadiths_sim') {

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
    console.log(`update status:${status.code}, id:${ids}, prop:${prop}, value:${(status.value + '').trim().substring(0, 20)}`);
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
