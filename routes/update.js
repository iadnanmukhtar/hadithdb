/* jslint node:true, esversion:9 */
'use strict';

const { homedir } = require('os');
const debug = require('debug')('hadithdb:update');
const fs = require('fs');
const path = require('path');
const express = require('express');
const createError = require('http-errors');
const Hadith = require('../lib/Hadith');
const Arabic = require('../lib/Arabic');
const Utils = require('../lib/Utils');
const Index = require('../lib/Index');
const { Heading, Item } = require('../lib/Model');

const router = express.Router();

router.post('/:id/:prop', async function (req, res, next) {
  if (global.settings.admin.key != req.cookies.admin)
    throw createError(403, "Update unauthorized");
  var userId = req.cookies.userId;
  var status = {
    code: 405,
    message: 'Did not process',
    value: req.body.value
  };
  try {
    var ids = req.params.id.split(/,/);
    var prop = req.params.prop;
    var type = prop.split(/\./)[0];
    var col = prop.split(/\./)[1];
    if (status.value == '…')
      status.value = null;
    if (req.body.arabizi)
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
        if (curr) {
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
          var prevTOC = (await global.query(`SELECT * from v_toc WHERE tId=${prev.tocId} ORDER BY ordinal DESC LIMIT 1`))[0];
          await Index.update(Heading.INDEX, prevTOC);
          var nextTOC = (await global.query(`SELECT * from v_toc WHERE tId=${next.tocId} ORDER BY ordinal DESC LIMIT 1`))[0];
          await Index.update(Heading.INDEX, nextTOC);
        } else
          throw new Error("Hadith not found");

      } else if (col === 'tocId') {
        var before = (await global.query(`SELECT * FROM hadiths WHERE id=${ids[0]}`))[0];
        var afterTOCId = status.value;
        result = await global.query(`UPDATE hadiths SET lastmod_user='${userId}', lastfixed=CURRENT_TIMESTAMP(), tocId=${status.value} WHERE id=${ids[0]}`);
        var prevTOC = (await global.query(`SELECT * from v_toc WHERE tId=${before.tocId} ORDER BY ordinal DESC LIMIT 1`))[0];
        await Index.update(Heading.INDEX, prevTOC);
        var nextTOC = (await global.query(`SELECT * from v_toc WHERE tId=${afterTOCId} ORDER BY ordinal DESC LIMIT 1`))[0];
        await Index.update(Heading.INDEX, nextTOC);

      } else { // hadith

        result = await global.query(`UPDATE hadiths SET lastmod_user='${userId}', lastfixed=CURRENT_TIMESTAMP(), ${col}=${sql(status.value)} WHERE id=${ids[0]}`);
        var item = new Item((await global.query(`SELECT * FROM v_hadiths WHERE hId=${ids[0]}`))[0]);
        if (col === 'body_en' && Utils.isFalsey(status.value)) {
          if (Utils.isFalsey(item.body_en) && Utils.isTruthy(item.body)) {
            item.body_en = await Utils.openai('gpt-4o', `Translate the following passage into English:\n${item.body}`);
            item.body_en = '[Machine] ' + Utils.trimToEmpty(item.body_en);
            item.body_en = Utils.replacePBUH(item.body_en);
            status.value = item.body_en;
            await global.query(`UPDATE hadiths SET body_en="${Utils.escSQL(item.body_en)}" WHERE id=${item.hId}`);
          }
        } else if (col === 'title_en' && Utils.isFalsey(status.value)) {
          if (Utils.isFalsey(item.title_en) && Utils.isTruthy(item.title)) {
            item.title_en = await Utils.openai('gpt-4o', `Translate the following title or passage into English:\n${item.title}`);
            item.title_en = '[Machine] ' + Utils.trimToEmpty(item.title_en);
            item.title_en = Utils.replacePBUH(item.title_en);
            status.value = item.title_en;
            await global.query(`UPDATE hadiths SET title_en="${Utils.escSQL(item.title_en)}" WHERE id=${item.hId}`);
          }
        } else if (col === 'footnote_en' && Utils.isFalsey(status.value)) {
          if (Utils.isFalsey(item.footnote_en) && Utils.isTruthy(item.footnote)) {
            item.footnote_en = await Utils.openai('gpt-4o', `Translate the following title or passage into English:\n${item.footnote}`);
            item.footnote_en = '[Machine] ' + Utils.trimToEmpty(item.footnote_en);
            item.footnote_en = Utils.replacePBUH(item.footnote_en);
            status.value = item.footnote_en;
            await global.query(`UPDATE hadiths SET footnote_en="${Utils.escSQL(item.footnote_en)}" WHERE id=${item.hId}`);
          }
        }
      }

      status.code = 200;
      status.message = result.message;
      try {
        var item = await global.query(`SELECT * FROM v_hadiths WHERE hId=${ids[0]}`);
        await Utils.flushCacheContaining(`${item[0].book_alias}:${item[0].num}`);
        await Index.update(Item.INDEX, item[0]);
      } catch (err) {
        debug(`${err.message}:\n${err.stack}`);
      }

    } else if (type == 'tags') {
      var result = await global.query(`UPDATE tags SET ${col}=${sql(status.value)} WHERE id=${ids[0]}`);
      status.code = 200;
      status.message = result.message;
      await Hadith.a_reinit();

    } else if (type == 'toc') {
      var result = await global.query(`UPDATE toc SET lastmod_user='${userId}', lastfixed=CURRENT_TIMESTAMP(), ${col}=${sql(status.value)} WHERE id=${ids[0]}`);
      if (col === 'title_en' && Utils.isFalsey(status.value)) {
        var heading = new Heading((await global.query(`SELECT * FROM v_toc WHERE hId=${ids[0]}`))[0]);
        if (Utils.isFalsey(heading.title_en) && Utils.isTruthy(heading.title)) {
          heading.title_en = await Utils.openai('gpt-4o', `Translate the following title or passage into English:\n${heading.title}`);
          heading.title_en = '[Machine] ' + Utils.trimToEmpty(heading.title_en);
          heading.title_en = Utils.replacePBUH(heading.title_en);
          status.value = heading.title_en;
          await global.query(`UPDATE toc SET title_en="${Utils.escSQL(heading.title_en)}" WHERE id=${heading.id}`);
        }
      } else if (col === 'intro_en' && Utils.isFalsey(status.value)) {
        var heading = new Heading((await global.query(`SELECT * FROM v_toc WHERE hId=${ids[0]}`))[0]);
        if (Utils.isFalsey(heading.intro_en) && Utils.isTruthy(heading.intro)) {
          heading.intro_en = await Utils.openai('gpt-4o', `Translate the following title or passage into English:\n${heading.intro}`);
          heading.intro_en = '[Machine] ' + Utils.trimToEmpty(heading.intro_en);
          heading.intro_en = Utils.replacePBUH(heading.intro_en);
          status.value = heading.intro_en;
          await global.query(`UPDATE toc SET intro_en="${Utils.escSQL(heading.intro_en)}" WHERE id=${heading.id}`);
        }
      }
      status.code = 200;
      status.message = result.message;
      try {
        var heading = await global.query(`SELECT * from v_toc WHERE hId=${ids[0]}`);
        heading = new Heading(heading[0]);
        await Index.update(Heading.INDEX, heading);
        var items = await global.query(`SELECT * FROM v_hadiths WHERE tId=${heading.id}`);
        await Index.updateBulk(Item.INDEX, items);
      } catch (err) {
        debug(`${err.message}:\n${err.stack}`);
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
        if (curr) {
          result = await global.query(`DELETE FROM hadiths_virtual 
            WHERE bookId=${curr.bookId} AND id=${ids[0]}`);
          result = await global.query(`SET sql_safe_updates=0`);
          result = await global.query(`SET @n:=0`);
          result = await global.query(`UPDATE hadiths_virtual SET ordinal=(@n:=@n+1)
            ORDER BY bookId, num0`);
          result = await global.query(`SET @n:=0`);
          result = await global.query(`UPDATE hadiths_virtual SET numInChapter=(@n:=@n+1)
            WHERE bookId=${curr.bookId} AND h1=${curr.h1} 
            ORDER BY bookId, num0`);
        } else
          throw new Error("Hadith not found");

      } else if (col == 'add') {
        var curr = (await global.query(`SELECT * from hadiths_virtual WHERE id=${ids[0]}`))[0];
        if (curr) {
          result = await global.query(`INSERT INTO hadiths_virtual
            (bookId, tocId, numInChapter, num, num0, ref_num) VALUES
            (${curr.bookId}, ${curr.tocId}, ${curr.numInChapter + 1}, "${curr.num + 1}", ${curr.num0}, ${sql(status.value)})`);
          result = await global.query(`SET sql_safe_updates=0`);
          result = await global.query(`SET @n:=0`);
          result = await global.query(`UPDATE hadiths_virtual SET ordinal=(@n:=@n+1)
            ORDER BY bookId, num0`);
          result = await global.query(`SET @n:=0`);
          result = await global.query(`UPDATE hadiths_virtual SET numInChapter=(@n:=@n+1)
            WHERE bookId=${curr.bookId} AND h1=${curr.h1} 
            ORDER BY bookId, num0`);
        } else
          throw new Error("Hadith not found");

      } else {
        // hadith virtual
        result = await global.query(`UPDATE hadiths_virtual SET lastmod_user='${userId}', lastfixed=CURRENT_TIMESTAMP(), ${col}=${sql(status.value)} WHERE id=${ids[0]}`);
      }
      status.code = 200;
      status.message = result.message;

    } else if (type == 'hadiths_sim') {

      if (col == 'del') {
        var result = await global.query(`DELETE FROM hadiths_sim_candidates 
          WHERE (hadithId1=${ids[0]} AND hadithId2=${ids[1]}) OR (hadithId1=${ids[1]} AND hadithId2=${ids[0]})`);
        result = await global.query(`DELETE FROM hadiths_sim 
          WHERE (hadithId1=${ids[0]} AND hadithId2=${ids[1]}) OR (hadithId1=${ids[1]} AND hadithId2=${ids[0]})`);
      } else if (col == 'delall') {
        var result = await global.query(`DELETE FROM hadiths_sim_candidates 
          WHERE hadithId1=${ids[0]} OR hadithId2=${ids[0]}`);
      }
      status.code = 200;
      status.message = result.message;
    }

  } catch (err) {
    status.message = err.message;
    status.code = 500;
    debug(`${status.message}:\n${err.stack}`);
  } finally {
    debug(`update status:${status.code}, id:${ids}, prop:${prop}, value:${(status.value + '').trim().substring(0, 20)}`);
    debug(status.message);
  }

  // uncache
  // findAndDeleteFilesWithText(`${homedir}/.hadithdb/cache`, '');

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

function findAndDeleteFilesWithText(dir, s) {
  fs.readdir(dir, (err, files) => {
    if (err) {
      console.error('Error reading directory:', err);
      return;
    }
    files.forEach(file => {
      const filePath = path.join(dir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error('Error stating file:', err);
          return;
        }
        if (stats.isFile()) {
          fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
              console.error('Error reading file:', err);
              return;
            }
            if (data.includes(s)) {
              console.log('Deleting file:', filePath);
              fs.unlink(filePath, (err) => {
                if (err) {
                  console.error('Error deleting file:', err);
                  return;
                }
                console.log('File deleted:', filePath);
              });
            }
          });
        } else if (stats.isDirectory()) {
          findAndDeleteFilesWithText(filePath, s);
        }
      });
    });
  });
}


module.exports = router;
