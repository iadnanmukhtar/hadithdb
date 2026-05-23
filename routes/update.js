/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:update');
const fs = require('fs');
const express = require('express');
const createError = require('http-errors');
const path = require('path');
const { spawn } = require('child_process');
const { homedir } = require('os');
const Hadith = require('../lib/Hadith');
const HadithKnowledge = require('../lib/HadithKnowledge');
const HadithRevision = require('../lib/HadithRevision');
const Arabic = require('../lib/Arabic');
const Utils = require('../lib/Utils');
const Index = require('../lib/Index');
const { Heading, Item, Library } = require('../lib/Model');

const router = express.Router();

router.post('/:id/:prop', async function (req, res, next) {
  if (global.settings.admin.key != req.cookies.admin)
    return next(createError(403, "Update unauthorized"));
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
          var prev = (await global.query(`SELECT * from hadiths WHERE bookId=${curr.bookId} AND ordinal < ${curr.ordinal} ORDER BY ordinal DESC LIMIT 1`))[0];
          var next = (await global.query(`SELECT * from hadiths WHERE bookId=${curr.bookId} AND ordinal > ${curr.ordinal} ORDER BY ordinal ASC LIMIT 1`))[0];
          var repl = null;
          if (col == 'moveup')
            repl = prev;
          else if (col == 'movedn')
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
            await reindexChapterSearchScope(curr.bookId, curr.h1);
            if (Number(curr.h1) !== Number(repl.h1))
              await reindexChapterSearchScope(curr.bookId, repl.h1);
          } else
            throw new Error("Invalid command");
        } else
          throw new Error("Hadith not found");

      } else if (col === 'tocId') {
        var before = (await global.query(`SELECT * FROM hadiths WHERE id=${ids[0]}`))[0];
        var afterTOCId = status.value;
        result = await global.query(`UPDATE hadiths SET lastmod_user='${userId}', lastfixed=CURRENT_TIMESTAMP(), tocId=${status.value} WHERE id=${ids[0]}`);
        var prevTOC = (await global.query(`SELECT * from v_toc WHERE tId=${before.tocId} ORDER BY ordinal DESC LIMIT 1`))[0];
        var nextTOC = (await global.query(`SELECT * from v_toc WHERE tId=${afterTOCId} ORDER BY ordinal DESC LIMIT 1`))[0];
        await reindexChapterSearchScope(before.bookId, before.h1);
        if (nextTOC && (Number(before.h1) !== Number(nextTOC.h1) || Number(before.bookId) !== Number(nextTOC.book_id)))
          await reindexChapterSearchScope(nextTOC.book_id, nextTOC.h1);

      } else if (col === 'add') {

        var curr = (await global.query(`SELECT * from hadiths WHERE id=${ids[0]}`))[0];
        if (curr) {
          result = await global.query(`INSERT IGNORE INTO hadiths_sim
            (hadithId1, ref_num) VALUES (${ids[0]}, ${sql(status.value)})`);
        }

      } else { // hadith

        if (col === 'verified')
          status.value = (status.value && status.value !== '') ? 1 : 0;

        if (col === 'revise') {
          var revised = await HadithRevision.reviseHadithById(ids[0], { userId: userId });
          result = { message: 'AI revision complete' };
          status.value = 'Revised';
          status.revised = {
            title_en: revised.item.title_en,
            chain: revised.item.chain,
            body: revised.item.body,
            chain_en: revised.item.chain_en,
            body_en: revised.item.body_en,
            footnote_en: revised.item.footnote_en
          };
        } else if (col === 'similar') {
          var child = await startSimilarHadithProcess(ids[0]);
          result = { message: `Similar-hadith scan started as pid ${child.pid}` };
          status.value = 'Queued';
        } else {
          result = await global.query(`UPDATE hadiths SET lastmod_user='${userId}', lastfixed=CURRENT_TIMESTAMP(), ${col}=${sql(status.value)} WHERE id=${ids[0]}`);
          var item = new Item((await global.query(`SELECT * FROM v_hadiths WHERE hId=${ids[0]}`))[0]);
          if (col === 'body_en' && Utils.isFalsey(status.value)) {
          if (Utils.isFalsey(item.body_en) && Utils.isTruthy(item.body)) {
            item.body_en = await Utils.openai(`Translate the following passage into English. Return only the translation:\n${item.body}`);
            item.body_en = '[AI] ' + Utils.trimToEmpty(item.body_en);
            item.body_en = Utils.replacePBUH(item.body_en);
            status.value = item.body_en;
            await global.query(`UPDATE hadiths SET body_en="${Utils.escSQL(item.body_en)}" WHERE id=${item.hId}`);
          }
          } else if (col === 'title_en' && Utils.isFalsey(status.value)) {
          if (Utils.isFalsey(item.title_en) && Utils.isTruthy(item.title)) {
            item.title_en = await Utils.openai(`Generate a concise English title using sentence case for the following Arabic title. Return only the title:\n${item.title}`);
            item.title_en = '[AI] ' + Utils.trimToEmpty(item.title_en);
            item.title_en = Utils.replacePBUH(item.title_en);
            status.value = item.title_en;
            await global.query(`UPDATE hadiths SET title_en="${Utils.escSQL(item.title_en)}" WHERE id=${item.hId}`);
          } else if (Utils.isFalsey(item.title_en)) {
            var sourceBody = Utils.isTruthy(item.body) ? item.body : item.body_en;
            if (Utils.isTruthy(sourceBody)) {
              item.title_en = await Utils.openai(`Generate a concise English title using sentence case for the following hadith body. Return only the title:\n${sourceBody}`);
              item.title_en = '[AI] ' + Utils.trimToEmpty(item.title_en);
              item.title_en = Utils.replacePBUH(item.title_en);
              status.value = item.title_en;
              await global.query(`UPDATE hadiths SET title_en="${Utils.escSQL(item.title_en)}" WHERE id=${item.hId}`);
            }
          }
          } else if (col === 'footnote_en' && Utils.isFalsey(status.value)) {
          if (Utils.isFalsey(item.footnote_en) && Utils.isTruthy(item.footnote)) {
            item.footnote_en = await Utils.openai(buildHadithContextTranslationPrompt(item, 'Arabic footnote', item.footnote));
            item.footnote_en = '[AI] ' + Utils.trimToEmpty(item.footnote_en);
            item.footnote_en = Utils.replacePBUH(item.footnote_en);
            status.value = item.footnote_en;
            await global.query(`UPDATE hadiths SET footnote_en="${Utils.escSQL(item.footnote_en)}" WHERE id=${item.hId}`);
          }
          } else if (col === 'chain_en' && Utils.isFalsey(status.value)) {
          if (Utils.isFalsey(item.chain_en) && Utils.isTruthy(item.chain)) {
            item.chain_en = await Utils.openai(`Extract the narrators from this chain, transliterate them using ALA-LC, and separate them using the "greator than" symbol. Instead of ibn or bint, use "bt.":\n${item.chain}`);
            item.chain_en = Utils.trimToEmpty(item.chain_en);
            item.chain_en = Utils.replacePBUH(item.chain_en);
            status.value = item.chain_en;
            await global.query(`UPDATE hadiths SET chain_en="${Utils.escSQL(item.chain_en)}" WHERE id=${item.hId}`);
          }
        }
        }

      }

      status.code = 200;
      status.message = result.message;
      if (col !== 'similar') {
        runHadithPostUpdateTasks(ids[0], {
          forceKnowledge: isArabicKnowledgeSourceColumn(col)
        });
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
          heading.title_en = await Utils.openai(`Translate the following title or passage into English. Return only the translation:\n${heading.title}`);
          heading.title_en = '[AI] ' + Utils.trimToEmpty(heading.title_en);
          heading.title_en = Utils.replacePBUH(heading.title_en);
          status.value = heading.title_en;
          await global.query(`UPDATE toc SET title_en="${Utils.escSQL(heading.title_en)}" WHERE id=${heading.id}`);
        }
      } else if (col === 'intro_en' && Utils.isFalsey(status.value)) {
        var heading = new Heading((await global.query(`SELECT * FROM v_toc WHERE hId=${ids[0]}`))[0]);
        if (Utils.isFalsey(heading.intro_en) && Utils.isTruthy(heading.intro)) {
          heading.intro_en = await Utils.openai(`Translate the following title or passage into English. Return only the translation:\n${heading.intro}`);
          heading.intro_en = '[AI] ' + Utils.trimToEmpty(heading.intro_en);
          heading.intro_en = Utils.replacePBUH(heading.intro_en);
          status.value = heading.intro_en;
          await global.query(`UPDATE toc SET intro_en="${Utils.escSQL(heading.intro_en)}" WHERE id=${heading.id}`);
        }
      }
      status.code = 200;
      status.message = result.message;
      try {
        await reindexHeadingSubtreeByHeadingId(ids[0]);
        await invalidateHeadingCachesByHeadingId(ids[0]);
      } catch (err) {
        debug(`${err.message}:\n${err.stack}`);
      }

    } else if (type == 'book') {
      var beforeBook = (await global.query(`SELECT * FROM books WHERE id=${ids[0]} LIMIT 1`))[0];
      var result = await global.query(`UPDATE books SET ${col}=${sql(status.value)} WHERE id=${ids[0]}`);
      status.code = 200;
      status.message = result.message;
      await Library.reloadBooks();
      try {
        var afterBook = (await global.query(`SELECT * FROM books WHERE id=${ids[0]} LIMIT 1`))[0];
        var cacheDir = `${homedir()}/.hadithdb/cache`;
        var bookAliases = new Set();
        if (beforeBook && beforeBook.alias)
          bookAliases.add(beforeBook.alias);
        if (afterBook && afterBook.alias)
          bookAliases.add(afterBook.alias);
        for (const filename of fs.readdirSync(cacheDir)) {
          for (const bookAlias of bookAliases) {
            if (filename === `_${bookAlias}` || filename.startsWith(`_${bookAlias}_`) || filename.startsWith(`_${bookAlias}?`)) {
              await Utils.flushCachedFile(`${cacheDir}/${filename}`);
              break;
            }
          }
        }
      } catch (err) {
        debug(`${err.message}:\n${err.stack}`);
      }

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

        if (col === 'note_en' && Utils.isFalsey(status.value)) {
          item = new Item((await global.query(`SELECT * FROM v_hadiths_virtual WHERE hId=${ids[0]}`))[0]);
          if (Utils.isFalsey(item.note_en) && Utils.isTruthy(item.note)) {
            item.note_en = await Utils.openai(buildHadithContextTranslationPrompt(item, 'Arabic virtual hadith note', item.note));
            item.note_en = '[AI] ' + Utils.trimToEmpty(item.note_en);
            item.note_en = Utils.replacePBUH(item.note_en);
            status.value = item.note_en;
            await global.query(`UPDATE hadiths_virtual SET note_en="${Utils.escSQL(item.note_en)}" WHERE id=${item.hId}`);
          }
        }

      }
      status.code = 200;
      status.message = result.message;

    } else if (type == 'hadiths_sim') {

      if (col == 'add') {
        var result = await global.query(`INSERT IGNORE INTO hadiths_sim
          (hadithId1, hadithId2) VALUES (${ids[0]}, ${ids[1]})`);
        result = await global.query(`DELETE FROM hadiths_sim_candidates
          WHERE (hadithId1=${ids[0]} AND hadithId2=${ids[1]}) OR (hadithId1=${ids[1]} AND hadithId2=${ids[0]})`);
        status.value = 'Added';
      } else if (col == 'demote') {
        var result = await global.query(`INSERT IGNORE INTO hadiths_sim_candidates
          (hadithId1, hadithId2, rating) VALUES (${ids[0]}, ${ids[1]}, 1)`);
        result = await global.query(`DELETE FROM hadiths_sim
          WHERE (hadithId1=${ids[0]} AND hadithId2=${ids[1]}) OR (hadithId1=${ids[1]} AND hadithId2=${ids[0]})`);
        status.value = 'Moved';
      } else if (col == 'del') {
        var result = await global.query(`DELETE FROM hadiths_sim_candidates 
          WHERE (hadithId1=${ids[0]} AND hadithId2=${ids[1]}) OR (hadithId1=${ids[1]} AND hadithId2=${ids[0]})`);
        result = await global.query(`DELETE FROM hadiths_sim 
          WHERE (hadithId1=${ids[0]} AND hadithId2=${ids[1]}) OR (hadithId1=${ids[1]} AND hadithId2=${ids[0]})`);
      } else if (col == 'delall') {
        var result = await global.query(`DELETE FROM hadiths_sim_candidates 
          WHERE hadithId1=${ids[0]} OR hadithId2=${ids[0]}`);
        result = await global.query(`DELETE FROM hadiths_sim
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

async function startSimilarHadithProcess(hadithId) {
  hadithId = parseInt(hadithId, 10);
  if (!Number.isInteger(hadithId) || hadithId <= 0)
    throw new Error(`Invalid hadith id: ${hadithId}`);

  var item = (await global.query(`SELECT id FROM hadiths WHERE id=${hadithId} LIMIT 1`))[0];
  if (!item)
    throw new Error(`Hadith not found: ${hadithId}`);

  var rootDir = path.resolve(__dirname, '..');
  var logDir = path.join(homedir(), '.hadithdb', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  var logPath = path.join(logDir, 'findSimilar.log');
  var out = fs.openSync(logPath, 'a');
  var err = fs.openSync(logPath, 'a');
  var child = null;
  try {
    child = spawn(process.execPath, ['bin/findSimilarByBook.js', '--id', String(hadithId)], {
      cwd: rootDir,
      detached: true,
      stdio: ['ignore', out, err]
    });
  } finally {
    fs.closeSync(out);
    fs.closeSync(err);
  }
  child.unref();
  debug(`started similar-hadith scan pid=${child.pid} id=${hadithId} log=${logPath}`);
  return child;
}

function buildHadithContextTranslationPrompt(item, sourceLabel, sourceText) {
  var lines = [
    'Translate the requested Arabic text into clear English.',
    'Use the Arabic hadith body below only as context for meaning, pronouns, references, and terminology.',
    'Return only the translation of the requested text, not the hadith body or any explanation.',
    '',
    'Arabic hadith body context:',
    Utils.trimToEmpty(item.body)
  ];
  lines.push(
    '',
    `${sourceLabel} to translate:`,
    Utils.trimToEmpty(sourceText)
  );
  return lines.join('\n');
}

async function reindexHeadingSubtreeByHeadingId(headingId) {
  headingId = parseInt(headingId, 10);
  if (!Number.isInteger(headingId) || headingId <= 0)
    return;
  var heading = (await global.query(`SELECT * FROM v_toc WHERE hId=${headingId} LIMIT 1`))[0];
  if (!heading)
    return;
  await reindexSearchScope(buildHeadingScopeWhere(heading));
}

async function reindexChapterSearchScope(bookId, h1) {
  bookId = parseInt(bookId, 10);
  h1 = Number(h1);
  if (!Number.isInteger(bookId) || bookId <= 0 || !Number.isFinite(h1))
    return;
  await reindexSearchScope(`book_id=${bookId} AND h1=${h1}`);
}

async function invalidateHeadingCachesByHeadingId(headingId) {
  headingId = parseInt(headingId, 10);
  if (!Number.isInteger(headingId) || headingId <= 0)
    return;
  var heading = (await global.query(`SELECT * FROM v_toc WHERE hId=${headingId} LIMIT 1`))[0];
  if (!heading)
    return;
  invalidateBookChapterCache(heading);
  await flushHeadingPathCaches(heading);
}

function invalidateBookChapterCache(heading) {
  try {
    var book = Library.instance.findBook(heading.book_id ?? heading.book_alias);
    if (book)
      book.chapters = undefined;
  } catch (error) {
    debug(`unable to invalidate in-memory chapter cache for heading ${heading.hId}: ${error.message}`);
  }
}

async function flushHeadingPathCaches(heading) {
  var cacheDir = `${homedir()}/.hadithdb/cache`;
  if (!fs.existsSync(cacheDir))
    return;
  var prefixes = buildHeadingCachePrefixes(heading);
  if (prefixes.length < 1)
    return;
  for (const filename of fs.readdirSync(cacheDir)) {
    for (const prefix of prefixes) {
      var normalized = `_${prefix.replace(/\//g, '_')}`;
      if (filename === `${normalized}.html` || filename.startsWith(`${normalized}_`) || filename.startsWith(`${normalized}?`)) {
        await Utils.flushCachedFile(`${cacheDir}/${filename}`);
        break;
      }
    }
  }
}

function buildHeadingCachePrefixes(heading) {
  var bookAlias = Utils.trimToEmpty(heading.book_alias);
  var h1 = normalizeHeadingNumber(heading.h1);
  var h2 = normalizeHeadingNumber(heading.h2);
  var prefixes = [];
  if (bookAlias && h1) {
    prefixes.push(`${bookAlias}/${h1}`);
    if (parseInt(heading.level, 10) >= 2 && h2)
      prefixes.push(`${bookAlias}/${h1}/${h2}`);
  }
  return prefixes;
}

function normalizeHeadingNumber(value) {
  if (value === undefined || value === null || value === '')
    return '';
  var numeric = Number(value);
  if (!Number.isFinite(numeric))
    return `${value}`.trim();
  if (numeric === Math.floor(numeric))
    return `${numeric}`;
  return `${numeric}`.replace(/\.0+$/, '');
}

async function reindexSearchScope(whereClause) {
  var headings = await global.query(`SELECT * FROM v_toc WHERE ${whereClause} ORDER BY ordinal`);
  if (headings.length > 0) {
    try {
      await Index.updateBulk(Heading.INDEX, headings);
    } catch (err) {
      debug(`unable to reindex headings for search scope ${whereClause}: ${err.message}\n${err.stack}`);
    }
  }
  var items = await global.query(`SELECT * FROM v_hadiths WHERE ${whereClause} ORDER BY ordinal`);
  if (items.length > 0) {
    try {
      await Index.updateBulk(Item.INDEX, items);
    } catch (err) {
      debug(`unable to reindex hadiths for search scope ${whereClause}: ${err.message}\n${err.stack}`);
    }
    await HadithKnowledge.syncForHadithRows(items);
  }
}

function runHadithPostUpdateTasks(hadithId, options) {
  options = options || {};
  (async () => {
    var rows = await global.query(`SELECT * FROM v_hadiths WHERE hId=${parseInt(hadithId, 10)}`);
    var item = rows[0];
    if (!item)
      return;
    await safeBackground(`flushing cache for ${item.ref}`, async () => {
      await Utils.flushCacheContaining(`${item.book_alias}:${item.num}`);
    });
    await safeBackground(`reindexing hadith ${item.ref}`, async () => {
      await Index.update(Item.INDEX, item);
    });
    await safeBackground(`syncing chatbot knowledge for ${item.ref}`, async () => {
      await HadithKnowledge.syncForHadith(item, { force: options.forceKnowledge });
    });
  })().catch((err) => {
    debug(`background hadith post-update failed for ${hadithId}: ${err.message}\n${err.stack}`);
  });
}

async function safeBackground(label, fn) {
  try {
    await fn();
  } catch (err) {
    debug(`${label} failed: ${err.message}\n${err.stack}`);
  }
}

function isArabicKnowledgeSourceColumn(col) {
  return ['title', 'chain', 'body', 'footnote'].includes(col);
}

function buildHeadingScopeWhere(heading) {
  var parts = [
    `book_id=${parseInt(heading.book_id, 10)}`,
    `h1=${Number(heading.h1)}`
  ];
  if (parseInt(heading.level, 10) >= 2)
    parts.push(`h2=${Number(heading.h2)}`);
  if (parseInt(heading.level, 10) >= 3)
    parts.push(`h3=${Number(heading.h3)}`);
  return parts.join(' AND ');
}

module.exports = router;
