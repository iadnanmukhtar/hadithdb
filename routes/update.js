/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:update');
const fs = require('fs');
const express = require('express');
const createError = require('http-errors');
const MySQL = require('mysql');
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
  if (!req.admin)
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
    debug(`update start id:${ids}, prop:${prop}`);
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

    } else if (type == 'commentary') {
      var commentaryColumns = ['text', 'text_en', 'footnotes', 'footnotes_en'];
      if (!commentaryColumns.includes(col))
        throw createError(400, `Invalid commentary field '${col}'`);
      var commentaryId = ids[0] === 'new-commentary'
        ? await createLocalCommentaryPassage(ids, col, status.value)
        : parseInt(ids[0], 10);
      if (!Number.isInteger(commentaryId) || commentaryId <= 0)
        throw createError(400, 'Invalid commentary passage id');
      var commentary = await commentaryIndexRowById(commentaryId);
      if (!commentary)
        throw createError(404, 'Local commentary passage not found');
      var result = ids[0] === 'new-commentary'
        ? { message: 'Created local commentary passage' }
        : await global.query(`UPDATE hadiths_commentary
          SET ${col}=${sql(status.value)}, lastmod=CURRENT_TIMESTAMP()
          WHERE id=${commentaryId}`);
      commentary = await commentaryIndexRowById(commentaryId);
      await Index.update('commentaries', commentary);
      await Index.refresh('commentaries');
      status.code = 200;
      status.message = result.message;
      status.id = commentaryId;

    } else if (type == 'toc') {
      var result;
      var shouldRunDefaultHeadingTasks = true;
      if (col === 'passageRange') {
        result = await updateQuranPassageRange(ids[0], status.value, userId);
        status.value = result.value;
        shouldRunDefaultHeadingTasks = false;
      } else if (col === 'sectionAdd') {
        result = await addQuranSection(ids[0], status.value, userId);
        status.value = result.value;
        shouldRunDefaultHeadingTasks = false;
      } else if (col === 'subsectionAdd') {
        result = await addQuranSubsection(ids[0], status.value, userId);
        status.value = result.value;
        shouldRunDefaultHeadingTasks = false;
      } else if (col === 'subsectionRange') {
        result = await updateQuranSubsectionRange(ids[0], status.value, userId);
        status.value = result.value;
        shouldRunDefaultHeadingTasks = false;
      } else if (col === 'subsectionDelete') {
        result = await deleteQuranSubsection(ids[0]);
        status.value = result.value;
        shouldRunDefaultHeadingTasks = false;
      } else if (col === 'subsectionPromote') {
        result = await promoteQuranSubsection(ids[0], userId);
        status.value = result.value;
        shouldRunDefaultHeadingTasks = false;
      } else if (col === 'sectionDelete') {
        result = await deleteQuranSection(ids[0]);
        status.value = result.value;
        shouldRunDefaultHeadingTasks = false;
      } else {
        result = await global.query(`UPDATE toc SET lastmod_user='${userId}', lastfixed=CURRENT_TIMESTAMP(), ${col}=${sql(status.value)} WHERE id=${ids[0]}`);
      }
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
        if (shouldRunDefaultHeadingTasks) {
          await reindexHeadingSubtreeByHeadingId(ids[0]);
          await invalidateHeadingCachesByHeadingId(ids[0]);
        }
      } catch (err) {
        debug(`${err.message}:\n${err.stack}`);
      }

    } else if (type == 'book') {
      var beforeBook = (await global.query(`SELECT * FROM books WHERE id=${ids[0]} LIMIT 1`))[0];
      var bookValueSql = (col === 'description') ? sqlPreserveWhitespace(status.value) : sql(status.value);
      var result = await global.query(`UPDATE books SET ${col}=${bookValueSql} WHERE id=${ids[0]}`);
      if (!result || result.affectedRows < 1)
        throw createError(404, 'Book not found');
      status.code = 200;
      status.message = result.message;
      await Library.reloadBooks();
      try {
        var afterBook = (await global.query(`SELECT * FROM books WHERE id=${ids[0]} LIMIT 1`))[0];
        var bookAliases = new Set();
        if (beforeBook && beforeBook.alias)
          bookAliases.add(beforeBook.alias);
        if (afterBook && afterBook.alias)
          bookAliases.add(afterBook.alias);
        await flushBookCaches(bookAliases);
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
        var simPairs = similarPairsFromIds(ids);
        var result = await global.query(`INSERT IGNORE INTO hadiths_sim
          (hadithId1, hadithId2) VALUES ${simPairs.map(pair => `(${pair[0]}, ${pair[1]})`).join(',')}`);
        for (const pair of simPairs) {
          result = await global.query(`DELETE FROM hadiths_sim_candidates
            WHERE (hadithId1=${pair[0]} AND hadithId2=${pair[1]}) OR (hadithId1=${pair[1]} AND hadithId2=${pair[0]})`);
        }
        status.value = 'Added';
      } else if (col == 'demote') {
        var simPairs = similarPairsFromIds(ids);
        var result = await global.query(`INSERT IGNORE INTO hadiths_sim_candidates
          (hadithId1, hadithId2, rating) VALUES ${simPairs.map(pair => `(${pair[0]}, ${pair[1]}, 1)`).join(',')}`);
        for (const pair of simPairs) {
          result = await global.query(`DELETE FROM hadiths_sim
            WHERE (hadithId1=${pair[0]} AND hadithId2=${pair[1]}) OR (hadithId1=${pair[1]} AND hadithId2=${pair[0]})`);
        }
        status.value = 'Moved';
      } else if (col == 'del') {
        var simPairs = similarPairsFromIds(ids);
        var result = null;
        result = await Hadith.a_suppressSimilarCandidate(simPairs[0][0], simPairs[0][1]);
        for (const pair of simPairs) {
          result = await global.query(`DELETE FROM hadiths_sim_candidates
            WHERE (hadithId1=${pair[0]} AND hadithId2=${pair[1]}) OR (hadithId1=${pair[1]} AND hadithId2=${pair[0]})`);
          result = await global.query(`DELETE FROM hadiths_sim
            WHERE (hadithId1=${pair[0]} AND hadithId2=${pair[1]}) OR (hadithId1=${pair[1]} AND hadithId2=${pair[0]})`);
        }
      } else if (col == 'delall') {
        result = await suppressAllVisibleSimilarCandidates(ids[0]);
        result = await global.query(`DELETE FROM hadiths_sim_candidates
          WHERE hadithId1=${ids[0]} OR hadithId2=${ids[0]}`);
      }
      status.code = 200;
      status.message = result.message;
    }

  } catch (err) {
    status.message = updateErrorMessage(err);
    status.code = updateErrorStatus(err);
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

function sqlPreserveWhitespace(s) {
  if (s === undefined || s === null || s === '…')
    return null;
  s = (s + '').replace(/\u200f/g, '');
  return MySQL.escape(s);
}

async function flushBookCaches(bookAliases) {
  var cacheDir = `${homedir()}/.hadithdb/cache`;
  var aliases = Array.from(bookAliases || []).filter(Boolean);
  for (const bookAlias of aliases)
    await Utils.flushCacheContaining(bookAlias);
  await Utils.flushCachedFile(`${cacheDir}/_books.html`);
  if (!fs.existsSync(cacheDir))
    return;
  for (const filename of fs.readdirSync(cacheDir)) {
    if (filename === '_books' || filename === '_books.html') {
      await Utils.flushCachedFile(`${cacheDir}/${filename}`);
      continue;
    }
    for (const bookAlias of aliases) {
      if (filename === `_${bookAlias}`
        || filename === `_${bookAlias}.html`
        || filename.startsWith(`_${bookAlias}_`)
        || filename.startsWith(`_${bookAlias}?`)) {
        await Utils.flushCachedFile(`${cacheDir}/${filename}`);
        break;
      }
    }
  }
}

async function commentaryIndexRowById(id) {
  return (await global.query(`
    SELECT
      hc.id,
      hc.id AS hId,
      'commentary' AS doctype,
      0 AS book_id,
      0 AS book_ordinal,
      'quran' AS book_alias,
      bc.ordinal AS ordinal,
      bc.id AS bookCommentaryId,
      bc.alias AS commentary_alias,
      bc.shortName AS commentary_shortName,
      bc.shortName_en AS commentary_shortName_en,
      bc.name AS commentary_name,
      bc.name_en AS commentary_name_en,
      bc.author AS commentary_author,
      bc.author_en AS commentary_author_en,
      bc.death AS commentary_author_death,
      bc.lang,
      bc.source,
      bc.format,
      hc.hadithId,
      hc.surah,
      hc.ayahFrom,
      hc.ayahTo,
      hc.passageNum,
      q.h1,
      q.h2,
      q.h2_id,
      q.h2_title_en,
      q.h2_title,
      q.path AS section_path,
      CONCAT('quran:', hc.surah, ':', hc.ayahFrom,
        IF(hc.ayahTo > hc.ayahFrom, CONCAT('-', hc.ayahTo), '')) AS ref,
      CONCAT('quran:', hc.surah, ':', hc.ayahFrom,
        IF(hc.ayahTo > hc.ayahFrom, CONCAT('-', hc.ayahTo), '')) AS path,
      hc.text,
      hc.text_en,
      hc.footnotes,
      hc.footnotes_en,
      hc.created,
      hc.lastmod
    FROM books_commentaries bc
    JOIN hadiths_commentary hc ON hc.bookCommentaryId=bc.id
    JOIN v_hadiths q ON q.id=hc.hadithId
    WHERE hc.id=${parseInt(id, 10)}
      AND bc.source='local'
      AND bc.hidden=0
    LIMIT 1`))[0];
}

async function createLocalCommentaryPassage(ids, col, value) {
  if (ids.length !== 5)
    throw createError(400, 'Invalid new commentary passage id');
  var alias = (ids[1] || '').toString();
  var surah = parseInt(ids[2], 10);
  var ayahFrom = parseInt(ids[3], 10);
  var ayahTo = parseInt(ids[4], 10);
  if (!/^[A-Za-z0-9_-]+$/.test(alias) ||
      !Number.isInteger(surah) || surah < 1 || surah > 114 ||
      !Number.isInteger(ayahFrom) || ayahFrom < 0 ||
      !Number.isInteger(ayahTo) || ayahTo < ayahFrom)
    throw createError(400, 'Invalid new commentary passage id');

  var book = (await global.query(`
    SELECT id
    FROM books_commentaries
    WHERE alias=${MySQL.escape(alias)}
      AND source='local'
      AND hidden=0
    LIMIT 1`))[0];
  if (!book)
    throw createError(404, 'Local commentary book not found');

  var quranAyah = (await global.query(`
    SELECT id
    FROM v_hadiths
    WHERE book_alias='quran'
      AND h1=${surah}
      AND num=${MySQL.escape(`${surah}:${ayahFrom}`)}
    LIMIT 1`))[0];
  if (!quranAyah)
    throw createError(404, `Quran ayah not found: ${surah}:${ayahFrom}`);

  await global.query(`
    INSERT INTO hadiths_commentary
      (bookCommentaryId, hadithId, surah, ayahFrom, ayahTo, passageNum, ${col})
    VALUES
      (${parseInt(book.id, 10)}, ${parseInt(quranAyah.id, 10)}, ${surah}, ${ayahFrom}, ${ayahTo}, ${ayahFrom}, ${sql(value)})
    ON DUPLICATE KEY UPDATE
      hadithId=VALUES(hadithId),
      passageNum=VALUES(passageNum),
      ${col}=VALUES(${col}),
      lastmod=CURRENT_TIMESTAMP()`);

  var row = (await global.query(`
    SELECT id
    FROM hadiths_commentary
    WHERE bookCommentaryId=${parseInt(book.id, 10)}
      AND surah=${surah}
      AND ayahFrom=${ayahFrom}
      AND ayahTo=${ayahTo}
    LIMIT 1`))[0];
  if (!row)
    throw createError(500, 'Unable to create local commentary passage');
  return parseInt(row.id, 10);
}

async function updateQuranPassageRange(headingId, value, userId) {
  headingId = parseInt(headingId, 10);
  if (!Number.isInteger(headingId) || headingId <= 0)
    throw createError(400, 'Invalid heading id');
  var payload = parsePassageRangeValue(value);
  var heading = (await global.query(`SELECT * FROM v_toc WHERE hId=${headingId} LIMIT 1`))[0];
  if (!heading)
    throw createError(404, 'Heading not found');
  if (heading.book_alias !== 'quran')
    throw createError(400, 'Passage ranges can only be set for Quran headings');
  if (parseInt(heading.level, 10) !== 2)
    throw createError(400, 'Passage ranges can only be set for Quran section headings');
  var surah = parseInt(heading.h1, 10);
  validateAyahRange(payload.startAyah, payload.endAyah, surah);
  var rangeRows = await global.query(`SELECT COUNT(*) AS count
    FROM hadiths
    WHERE bookId=${parseInt(heading.book_id, 10)} AND h1=${surah} AND numInChapter BETWEEN ${payload.startAyah} AND ${payload.endAyah}`);
  if (!rangeRows[0] || Number(rangeRows[0].count) !== (payload.endAyah - payload.startAyah + 1))
    throw createError(400, `Ayah range ${surah}:${payload.startAyah}-${payload.endAyah} is outside this surah`);
  var startRef = `${surah}:${payload.startAyah}`;
  var start0 = quranNum0(surah, payload.startAyah);
  var endRef = `${surah}:${payload.endAyah}`;
  var end0 = quranNum0(surah, payload.endAyah);
  var count = payload.endAyah - payload.startAyah + 1;
  var updateResult = await global.query(`UPDATE toc
    SET lastmod_user='${userId}', lastfixed=CURRENT_TIMESTAMP(), start=${sql(startRef)}, end=${sql(endRef)}, start0=${start0}, end0=${end0}, count=${count}
    WHERE id=${heading.tId || heading.id}`);
  await reindexChapterSearchScope(heading.book_id, surah, { syncKnowledge: false, refresh: true });
  await invalidateQuranSurahCaches(surah);
  return {
    message: updateResult.message,
    value: {
      startAyah: payload.startAyah,
      endAyah: payload.endAyah,
      start: startRef,
      start0: start0,
      count: count
    }
  };
}

async function addQuranSection(anchorHeadingId, value, userId) {
  anchorHeadingId = parseInt(anchorHeadingId, 10);
  if (!Number.isInteger(anchorHeadingId) || anchorHeadingId <= 0)
    throw createError(400, 'Invalid section heading id');
  var payload = parseSectionValue(value);
  var anchor = (await global.query(`SELECT * FROM v_toc WHERE hId=${anchorHeadingId} LIMIT 1`))[0];
  if (!anchor)
    throw createError(404, 'Section heading not found');
  if (anchor.book_alias !== 'quran')
    throw createError(400, 'Sections can only be added here for Quran headings');
  if (parseInt(anchor.level, 10) !== 2)
    throw createError(400, 'Sections can only be added from a level 2 Quran heading');
  var bookId = parseInt(anchor.book_id, 10);
  var surah = parseInt(anchor.h1, 10);
  validateAyahRange(payload.startAyah, payload.endAyah, surah);
  var insertH2 = Number(anchor.h2) + (payload.position === 'before' ? 0 : 1);
  if (!Number.isInteger(insertH2) || insertH2 < 1)
    throw createError(400, 'Invalid section position');
  var insertOrdinal = await quranSectionInsertOrdinal(anchor, payload.position);
  await global.query(`UPDATE toc
    SET ordinal=ordinal+1
    WHERE bookId=${bookId} AND ordinal>=${insertOrdinal}`);
  await global.query(`UPDATE toc
    SET h2=h2+1
    WHERE bookId=${bookId} AND h1=${surah} AND h2>=${insertH2} AND level IN (2, 3)`);
  var startRef = `${surah}:${payload.startAyah}`;
  var start0 = quranNum0(surah, payload.startAyah);
  var endRef = `${surah}:${payload.endAyah}`;
  var end0 = quranNum0(surah, payload.endAyah);
  var count = payload.endAyah - payload.startAyah + 1;
  var insertResult = await global.query(`INSERT INTO toc
    (ordinal, bookId, level, h1, h2, h3, title_en, title, intro_en, intro, start, end, start0, end0, count, lastmod_user, lastfixed)
    VALUES
    (${insertOrdinal}, ${bookId}, 2, ${surah}, ${insertH2}, NULL, ${sql(payload.title_en)}, ${sql(payload.title)}, NULL, NULL, ${sql(startRef)}, ${sql(endRef)}, ${start0}, ${end0}, ${count}, '${userId}', CURRENT_TIMESTAMP())`);
  await relinkQuranAyahRangeToSection(bookId, surah, insertResult.insertId, insertH2, payload.startAyah, payload.endAyah);
  await syncQuranSurahHadithHeadingNumbers(bookId, surah);
  await reindexChapterSearchScope(bookId, surah, { syncKnowledge: false, refresh: true });
  await invalidateQuranSurahCaches(surah);
  return {
    message: insertResult.message,
    value: {
      id: insertResult.insertId,
      h1: surah,
      h2: insertH2,
      path: `quran/${surah}/${insertH2}`,
      start: startRef,
      startAyah: payload.startAyah,
      endAyah: payload.endAyah,
      count: count
    }
  };
}

async function addQuranSubsection(sectionHeadingId, value, userId) {
  sectionHeadingId = parseInt(sectionHeadingId, 10);
  if (!Number.isInteger(sectionHeadingId) || sectionHeadingId <= 0)
    throw createError(400, 'Invalid section heading id');
  var payload = parseSubsectionValue(value);
  var section = (await global.query(`SELECT * FROM v_toc WHERE hId=${sectionHeadingId} LIMIT 1`))[0];
  if (!section)
    throw createError(404, 'Section heading not found');
  if (section.book_alias !== 'quran')
    throw createError(400, 'Subsections can only be added here for Quran headings');
  if (parseInt(section.level, 10) !== 2)
    throw createError(400, 'Subsections can only be added within a level 2 section');
  var surah = parseInt(section.h1, 10);
  validateAyahRange(payload.startAyah, payload.endAyah, surah);
  validateSubsectionWithinSection(payload, section);
  var h3 = await nextQuranSubsectionNumber(section.book_id, surah, section.h2);
  var startRef = `${surah}:${payload.startAyah}`;
  var start0 = quranNum0(surah, payload.startAyah);
  var endRef = `${surah}:${payload.endAyah}`;
  var end0 = quranNum0(surah, payload.endAyah);
  var count = payload.endAyah - payload.startAyah + 1;
  var insertOrdinal = parseInt(section.ordinal, 10);
  if (!Number.isInteger(insertOrdinal))
    insertOrdinal = 0;
  var insertResult = await global.query(`INSERT INTO toc
    (ordinal, bookId, level, h1, h2, h3, title_en, title, intro_en, intro, start, end, start0, end0, count, lastmod_user, lastfixed)
    VALUES
    (${insertOrdinal}, ${parseInt(section.book_id, 10)}, 3, ${surah}, ${Number(section.h2)}, ${h3}, ${sql(payload.title_en)}, ${sql(payload.title)}, NULL, NULL, ${sql(startRef)}, ${sql(endRef)}, ${start0}, ${end0}, ${count}, '${userId}', CURRENT_TIMESTAMP())`);
  await reindexChapterSearchScope(section.book_id, surah, { syncKnowledge: false, refresh: true });
  await invalidateQuranSurahCaches(surah);
  return {
    message: insertResult.message,
    value: {
      id: insertResult.insertId,
      h1: surah,
      h2: Number(section.h2),
      h3: h3,
      path: `quran/${surah}/${Number(section.h2)}/${h3}`,
      start: startRef,
      startAyah: payload.startAyah,
      endAyah: payload.endAyah,
      count: count
    }
  };
}

async function updateQuranSubsectionRange(subsectionHeadingId, value, userId) {
  subsectionHeadingId = parseInt(subsectionHeadingId, 10);
  if (!Number.isInteger(subsectionHeadingId) || subsectionHeadingId <= 0)
    throw createError(400, 'Invalid subsection heading id');
  var payload = parseSubsectionValue(value);
  var subsection = (await global.query(`SELECT * FROM v_toc WHERE hId=${subsectionHeadingId} LIMIT 1`))[0];
  if (!subsection)
    throw createError(404, 'Subsection heading not found');
  if (subsection.book_alias !== 'quran')
    throw createError(400, 'Subsection ranges can only be adjusted here for Quran headings');
  if (parseInt(subsection.level, 10) !== 3)
    throw createError(400, 'Only level 3 subsection ranges can be adjusted here');
  var section = (await global.query(`SELECT * FROM v_toc
    WHERE book_id=${parseInt(subsection.book_id, 10)} AND level=2 AND h1=${Number(subsection.h1)} AND h2=${Number(subsection.h2)}
    LIMIT 1`))[0];
  if (!section)
    throw createError(404, 'Parent section heading not found');
  var surah = parseInt(subsection.h1, 10);
  validateAyahRange(payload.startAyah, payload.endAyah, surah);
  validateSubsectionWithinSection(payload, section);
  var startRef = `${surah}:${payload.startAyah}`;
  var start0 = quranNum0(surah, payload.startAyah);
  var endRef = `${surah}:${payload.endAyah}`;
  var end0 = quranNum0(surah, payload.endAyah);
  var count = payload.endAyah - payload.startAyah + 1;
  var updateResult = await global.query(`UPDATE toc
    SET lastmod_user='${userId}', lastfixed=CURRENT_TIMESTAMP(), start=${sql(startRef)}, end=${sql(endRef)}, start0=${start0}, end0=${end0}, count=${count}
    WHERE id=${subsection.tId || subsection.id}`);
  await reindexChapterSearchScope(subsection.book_id, surah, { syncKnowledge: false, refresh: true });
  await invalidateQuranSurahCaches(surah);
  return {
    message: updateResult.message,
    value: {
      id: subsection.tId || subsection.id,
      h1: surah,
      h2: Number(subsection.h2),
      h3: Number(subsection.h3),
      path: `quran/${surah}/${Number(subsection.h2)}/${Number(subsection.h3)}`,
      start: startRef,
      startAyah: payload.startAyah,
      endAyah: payload.endAyah,
      count: count
    }
  };
}

async function deleteQuranSubsection(subsectionHeadingId) {
  subsectionHeadingId = parseInt(subsectionHeadingId, 10);
  if (!Number.isInteger(subsectionHeadingId) || subsectionHeadingId <= 0)
    throw createError(400, 'Invalid subsection heading id');
  var subsection = (await global.query(`SELECT * FROM v_toc WHERE hId=${subsectionHeadingId} LIMIT 1`))[0];
  if (!subsection)
    throw createError(404, 'Subsection heading not found');
  if (subsection.book_alias !== 'quran')
    throw createError(400, 'Subsections can only be removed here for Quran headings');
  if (parseInt(subsection.level, 10) !== 3)
    throw createError(400, 'Only level 3 subsection headings can be removed here');
  var deleteResult = await global.query(`DELETE FROM toc WHERE id=${subsection.tId || subsection.id}`);
  await Index.delete(Heading.INDEX, subsection.hId || subsection.tId || subsection.id);
  await reindexChapterSearchScope(subsection.book_id, subsection.h1, { syncKnowledge: false, refresh: true });
  await invalidateQuranSurahCaches(subsection.h1);
  return {
    message: deleteResult.message,
    value: {
      id: subsection.tId || subsection.id,
      h1: Number(subsection.h1),
      h2: Number(subsection.h2),
      h3: Number(subsection.h3),
      deleted: true
    }
  };
}

async function promoteQuranSubsection(subsectionHeadingId, userId) {
  subsectionHeadingId = parseInt(subsectionHeadingId, 10);
  if (!Number.isInteger(subsectionHeadingId) || subsectionHeadingId <= 0)
    throw createError(400, 'Invalid subsection heading id');
  var subsection = (await global.query(`SELECT * FROM v_toc WHERE hId=${subsectionHeadingId} LIMIT 1`))[0];
  if (!subsection)
    throw createError(404, 'Subsection heading not found');
  if (subsection.book_alias !== 'quran')
    throw createError(400, 'Subsections can only be promoted here for Quran headings');
  if (parseInt(subsection.level, 10) !== 3)
    throw createError(400, 'Only level 3 subsection headings can be promoted here');
  var bookId = parseInt(subsection.book_id, 10);
  var surah = Number(subsection.h1);
  var sourceH2 = Number(subsection.h2);
  var insertH2 = sourceH2 + 1;
  var section = (await global.query(`SELECT * FROM v_toc
    WHERE book_id=${bookId} AND level=2 AND h1=${surah} AND h2=${sourceH2}
    LIMIT 1`))[0];
  if (!section)
    throw createError(404, 'Parent section heading not found');
  var sectionStart = quranAyahFromHeadingStart(section.start || section.h2_start);
  var sectionCount = parseInt(section.count || section.h2_count, 10);
  var splitAyah = quranAyahFromHeadingStart(subsection.start || subsection.h3_start);
  if (!Number.isInteger(sectionStart) || !Number.isInteger(sectionCount) || sectionCount < 1 || !Number.isInteger(splitAyah))
    throw createError(400, 'The section range is incomplete');
  var sectionEnd = sectionStart + sectionCount - 1;
  if (splitAyah <= sectionStart || splitAyah > sectionEnd)
    throw createError(400, 'Choose a subsection that starts after the first ayah of its parent section');
  var sourceEnd = splitAyah - 1;
  var sourceCount = sourceEnd - sectionStart + 1;
  var promotedCount = sectionEnd - splitAyah + 1;
  var insertOrdinal = await quranSectionInsertOrdinal(section, 'after');
  var movedSubsections = await global.query(`SELECT id
    FROM toc
    WHERE bookId=${bookId} AND level=3 AND h1=${surah} AND h2=${sourceH2}
      AND CAST(SUBSTRING_INDEX(start, ':', -1) AS UNSIGNED) >= ${splitAyah}
    ORDER BY start0, h3`);
  await global.query(`UPDATE toc
    SET ordinal=ordinal+1
    WHERE bookId=${bookId} AND ordinal>=${insertOrdinal}`);
  await global.query(`UPDATE toc
    SET h2=h2+1
    WHERE bookId=${bookId} AND h1=${surah} AND h2>=${insertH2} AND level IN (2, 3)`);
  await global.query(`UPDATE toc
    SET lastmod_user='${userId}', lastfixed=CURRENT_TIMESTAMP(),
      end=${sql(`${surah}:${sourceEnd}`)}, end0=${quranNum0(surah, sourceEnd)}, count=${sourceCount}
    WHERE id=${section.tId || section.id}`);
  var insertResult = await global.query(`INSERT INTO toc
    (ordinal, bookId, level, h1, h2, h3, title_en, title, intro_en, intro, start, end, start0, end0, count, lastmod_user, lastfixed)
    VALUES
    (${insertOrdinal}, ${bookId}, 2, ${surah}, ${insertH2}, NULL, ${sql(subsection.title_en || 'Section')}, ${sql(subsection.title)}, ${sql(subsection.intro_en)}, ${sql(subsection.intro)}, ${sql(`${surah}:${splitAyah}`)}, ${sql(`${surah}:${sectionEnd}`)}, ${quranNum0(surah, splitAyah)}, ${quranNum0(surah, sectionEnd)}, ${promotedCount}, '${userId}', CURRENT_TIMESTAMP())`);
  var movedSubsectionIds = movedSubsections
    .map(row => Number(row.id))
    .filter(id => Number.isInteger(id));
  if (movedSubsectionIds.length > 0) {
    await timedUpdateStep(`quran ${surah} promote subsection ${subsectionHeadingId}: move ${movedSubsectionIds.length} subsection headings`, async () => {
      await global.query(`UPDATE toc
        SET ordinal=${insertOrdinal}, h2=${insertH2}
        WHERE id IN (${movedSubsectionIds.join(',')})`);
      await renumberQuranSubsections(bookId, surah, insertH2);
    });
  }
  await timedUpdateStep(`quran ${surah} promote subsection ${subsectionHeadingId}: relink ayahs ${splitAyah}-${sectionEnd}`, async () => {
    await relinkQuranAyahRangeToSection(bookId, surah, insertResult.insertId, insertH2, splitAyah, sectionEnd);
  });
  await timedUpdateStep(`quran ${surah} promote subsection ${subsectionHeadingId}: sync heading numbers`, async () => {
    await syncQuranSurahHadithHeadingNumbers(bookId, surah);
  });
  await timedUpdateStep(`quran ${surah} promote subsection ${subsectionHeadingId}: reindex search scope`, async () => {
    await reindexChapterSearchScope(bookId, surah, { syncKnowledge: false, refresh: true });
  });
  await timedUpdateStep(`quran ${surah} promote subsection ${subsectionHeadingId}: invalidate cache`, async () => {
    await invalidateQuranSurahCaches(surah);
  });
  return {
    message: insertResult.message,
    value: {
      id: insertResult.insertId,
      h1: surah,
      h2: insertH2,
      path: `quran/${surah}/${insertH2}`,
      start: `${surah}:${splitAyah}`,
      startAyah: splitAyah,
      endAyah: sectionEnd,
      count: promotedCount
    }
  };
}

async function deleteQuranSection(sectionHeadingId) {
  sectionHeadingId = parseInt(sectionHeadingId, 10);
  if (!Number.isInteger(sectionHeadingId) || sectionHeadingId <= 0)
    throw createError(400, 'Invalid section heading id');
  var section = (await global.query(`SELECT * FROM v_toc WHERE hId=${sectionHeadingId} LIMIT 1`))[0];
  if (!section)
    throw createError(404, 'Section heading not found');
  if (section.book_alias !== 'quran')
    throw createError(400, 'Sections can only be removed here for Quran headings');
  if (parseInt(section.level, 10) !== 2)
    throw createError(400, 'Only level 2 section headings can be removed here');
  var bookId = parseInt(section.book_id, 10);
  var surah = Number(section.h1);
  var h2 = Number(section.h2);
  var destination = (await global.query(`SELECT id, h2
    FROM toc
    WHERE bookId=${bookId} AND level=2 AND h1=${surah} AND h2<>${h2}
    ORDER BY CASE WHEN h2<${h2} THEN 0 ELSE 1 END, ABS(h2-${h2})
    LIMIT 1`))[0];
  if (!destination)
    throw createError(400, 'The only Quran section in a surah cannot be removed');
  var deletedHeadings = await global.query(`SELECT hId
    FROM v_toc
    WHERE book_id=${bookId} AND h1=${surah} AND h2=${h2} AND level IN (2, 3)`);
  await global.query(`UPDATE hadiths
    SET tocId=${destination.id}, h1=${surah}, h2=${destination.h2}, h3=NULL
    WHERE bookId=${bookId} AND tocId=${section.tId || section.id}`);
  var deleteResult = await global.query(`DELETE FROM toc
    WHERE bookId=${bookId} AND h1=${surah} AND h2=${h2} AND level IN (2, 3)`);
  await global.query(`UPDATE toc
    SET h2=h2-1
    WHERE bookId=${bookId} AND h1=${surah} AND h2>${h2} AND level IN (2, 3)`);
  await syncQuranSurahHadithHeadingNumbers(bookId, surah);
  for (const heading of deletedHeadings)
    await Index.delete(Heading.INDEX, heading.hId);
  await reindexChapterSearchScope(bookId, surah, { syncKnowledge: false, refresh: true });
  await invalidateQuranSurahCaches(surah);
  return {
    message: deleteResult.message,
    value: {
      id: section.tId || section.id,
      h1: surah,
      h2: h2,
      deleted: true,
      redirectPath: `/quran/${surah}`
    }
  };
}

function parseSubsectionValue(value) {
  var payload = parsePassageRangeValue(value);
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (err) {
      value = {};
    }
  }
  value = value || {};
  payload.title_en = Utils.trimToEmpty(value.title_en || value.title || 'Subsection');
  payload.title = Utils.trimToEmpty(value.title_ar || value.titleArabic || '');
  return payload;
}

function parseSectionValue(value) {
  var payload = parsePassageRangeValue(value);
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (err) {
      value = {};
    }
  }
  value = value || {};
  payload.title_en = Utils.trimToEmpty(value.title_en || value.title || 'Section');
  payload.title = Utils.trimToEmpty(value.title_ar || value.titleArabic || '');
  payload.position = Utils.trimToEmpty(value.position).toLowerCase() === 'before' ? 'before' : 'after';
  return payload;
}

async function quranSectionInsertOrdinal(anchor, position) {
  var bookId = parseInt(anchor.book_id, 10);
  var surah = Number(anchor.h1);
  var h2 = Number(anchor.h2);
  if (position === 'before')
    return Number(anchor.ordinal);
  var rows = await global.query(`SELECT COALESCE(MAX(ordinal), ${Number(anchor.ordinal)}) + 1 AS ordinal
    FROM v_toc
    WHERE book_id=${bookId} AND h1=${surah} AND h2=${h2} AND level IN (2, 3)`);
  return Number(rows[0].ordinal);
}

function validateSubsectionWithinSection(payload, section) {
  var sectionStart = quranAyahFromHeadingStart(section.start || section.h2_start);
  var sectionCount = parseInt(section.count || section.h2_count, 10);
  if (!Number.isInteger(sectionStart) || !Number.isInteger(sectionCount) || sectionCount < 1)
    return;
  var sectionEnd = sectionStart + sectionCount - 1;
  if (payload.startAyah < sectionStart || payload.endAyah > sectionEnd)
    throw createError(400, `Subsection range must be within ${section.h1}:${sectionStart}-${sectionEnd}`);
}

async function nextQuranSubsectionNumber(bookId, h1, h2) {
  var rows = await global.query(`SELECT COALESCE(MAX(h3), 0) + 1 AS h3
    FROM toc
    WHERE bookId=${parseInt(bookId, 10)} AND level=3 AND h1=${Number(h1)} AND h2=${Number(h2)}`);
  return Number(rows[0].h3);
}

async function renumberQuranSubsections(bookId, h1, h2) {
  var rows = await global.query(`SELECT id
    FROM toc
    WHERE bookId=${parseInt(bookId, 10)} AND level=3 AND h1=${Number(h1)} AND h2=${Number(h2)}
    ORDER BY start0, h3, id`);
  for (var i = 0; i < rows.length; i++) {
    await global.query(`UPDATE toc SET h3=${i + 1} WHERE id=${Number(rows[i].id)}`);
  }
}

function parsePassageRangeValue(value) {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (err) {
      var match = value.match(/^\s*(\d+)\s*[-:]\s*(\d+)\s*$/);
      if (match)
        value = { startAyah: match[1], endAyah: match[2] };
    }
  }
  value = value || {};
  var startAyah = parseInt(Arabic.toLatinDigits(value.startAyah || value.start || value.ayah1), 10);
  var endAyah = parseInt(Arabic.toLatinDigits(value.endAyah || value.end || value.ayah2), 10);
  return { startAyah, endAyah };
}

function validateAyahRange(startAyah, endAyah, surah) {
  if (!Number.isInteger(startAyah) || !Number.isInteger(endAyah) || startAyah < 1 || endAyah < startAyah)
    throw createError(400, 'Invalid ayah range');
  var surahInfo = global.surahs.find(item => Number(item.num) === Number(surah));
  if (surahInfo && surahInfo.ayat && endAyah > Number(surahInfo.ayat))
    throw createError(400, `Surah ${surah} only has ${surahInfo.ayat} ayahs`);
}

function quranNum0(surah, ayah) {
  return Number(surah) + (Number(ayah) / 1000);
}

async function relinkQuranAyahRangeToSection(bookId, surah, tocId, h2, startAyah, endAyah) {
  var started = Date.now();
  debug(`quran ${surah} relink ayahs ${startAyah}-${endAyah} to section ${h2}: start`);
  var result = await global.query(`UPDATE hadiths
    SET tocId=${parseInt(tocId, 10)}, h1=${Number(surah)}, h2=${Number(h2)}, h3=NULL
    WHERE bookId=${parseInt(bookId, 10)} AND h1=${Number(surah)}
      AND numInChapter BETWEEN ${Number(startAyah)} AND ${Number(endAyah)}`);
  debug(`quran ${surah} relink ayahs ${startAyah}-${endAyah} to section ${h2}: done in ${Date.now() - started}ms (${result?.affectedRows ?? 'unknown'} rows)`);
}

async function syncQuranSurahHadithHeadingNumbers(bookId, surah) {
  var started = Date.now();
  debug(`quran ${surah} sync hadith heading numbers: start`);
  var sections = await global.query(`SELECT id, h1, h2
    FROM toc
    WHERE bookId=${parseInt(bookId, 10)} AND level=2 AND h1=${Number(surah)}
    ORDER BY h2`);
  var affectedRows = 0;
  for (const section of sections) {
    var result = await global.query(`UPDATE hadiths
      SET h1=${Number(section.h1)}, h2=${Number(section.h2)}, h3=NULL
      WHERE bookId=${parseInt(bookId, 10)} AND tocId=${Number(section.id)}
        AND NOT (h1<=>${Number(section.h1)} AND h2<=>${Number(section.h2)} AND h3<=>NULL)`);
    affectedRows += Number(result?.affectedRows) || 0;
  }
  debug(`quran ${surah} sync hadith heading numbers: done in ${Date.now() - started}ms (${sections.length} sections, ${affectedRows} rows)`);
}

function quranAyahFromHeadingStart(start) {
  var parts = Utils.trimToEmpty(start).split(/:/);
  return parseInt(Arabic.toLatinDigits(parts[parts.length - 1] || ''), 10);
}

async function invalidateQuranSurahCaches(surah) {
  var cacheDir = `${homedir()}/.hadithdb/cache`;
  if (!fs.existsSync(cacheDir)) {
    debug(`quran ${surah} cache invalidation skipped: ${cacheDir} does not exist`);
    return;
  }
  var prefixes = [`_quran_${surah}`, `_passage:${surah}:`];
  var filenames = fs.readdirSync(cacheDir);
  var matched = 0;
  var deleted = 0;
  for (const filename of filenames) {
    if (prefixes.some(prefix => filename === `${prefix}.html` || filename.startsWith(prefix) || filename.startsWith(`${prefix}?`))) {
      matched++;
      if (await Utils.flushCachedFile(`${cacheDir}/${filename}`))
        deleted++;
    }
  }
  debug(`quran ${surah} cache invalidation scanned ${filenames.length}, matched ${matched}, deleted ${deleted}`);
}

function updateErrorStatus(err) {
  var code = err?.status || err?.statusCode || err?.response?.status || 500;
  code = parseInt(code, 10);
  if (!Number.isInteger(code) || code < 400 || code > 599)
    return 500;
  return code;
}

function updateErrorMessage(err) {
  var upstreamMessage = err?.response?.data?.error?.message || err?.response?.data?.message;
  if (upstreamMessage)
    return upstreamMessage;
  if (err?.response?.status === 429)
    return 'OpenAI rate limit exceeded. Wait a bit and retry.';
  return err?.message || 'Unable to process update';
}

async function timedUpdateStep(label, fn) {
  var started = Date.now();
  debug(`${label}: start`);
  try {
    var result = await fn();
    debug(`${label}: done in ${Date.now() - started}ms`);
    return result;
  } catch (err) {
    debug(`${label}: failed after ${Date.now() - started}ms: ${err.message}`);
    throw err;
  }
}

function similarPairsFromIds(ids) {
  var pairs = [];
  for (var i = 0; i + 1 < ids.length; i += 2) {
    var id1 = parseInt(ids[i], 10);
    var id2 = parseInt(ids[i + 1], 10);
    if (!Number.isInteger(id1) || id1 <= 0 || !Number.isInteger(id2) || id2 <= 0)
      throw new Error(`Invalid similar hadith pair: ${ids[i]},${ids[i + 1]}`);
    if (id1 !== id2)
      pairs.push([id1, id2]);
  }
  if (pairs.length < 1)
    throw new Error('No similar hadith pair provided');
  return pairs;
}

async function suppressAllVisibleSimilarCandidates(parentId) {
  parentId = parseInt(parentId, 10);
  if (!Number.isInteger(parentId) || parentId <= 0)
    return null;
  var item = (await global.query(`SELECT * FROM v_hadiths WHERE hId=${parentId} LIMIT 1`))[0];
  if (!item)
    return null;
  var candidates = await Hadith.a_dbGetSimilarCandidates(new Item(item));
  var ids = candidates
    .filter(candidate => candidate.similarCandidate)
    .map(candidate => parseInt(candidate.actual ? candidate.actual.id : candidate.id, 10))
    .filter(id => Number.isInteger(id) && id > 0);
  return await Hadith.a_suppressSimilarCandidates(parentId, ids);
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

async function reindexChapterSearchScope(bookId, h1, options) {
  bookId = parseInt(bookId, 10);
  h1 = Number(h1);
  if (!Number.isInteger(bookId) || bookId < 0 || !Number.isFinite(h1))
    return;
  await reindexSearchScope(`book_id=${bookId} AND h1=${h1}`, options);
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

async function reindexSearchScope(whereClause, options) {
  options = options || {};
  var started = Date.now();
  debug(`reindex search scope start: ${whereClause}`);
  var headings = await global.query(`SELECT * FROM v_toc WHERE ${whereClause} ORDER BY ordinal`);
  debug(`reindex search scope headings query returned ${headings.length} rows in ${Date.now() - started}ms: ${whereClause}`);
  if (headings.length > 0) {
    var headingStarted = Date.now();
    try {
      await Index.updateBulk(Heading.INDEX, headings);
      debug(`reindex search scope headings indexed ${headings.length} rows in ${Date.now() - headingStarted}ms: ${whereClause}`);
    } catch (err) {
      debug(`unable to reindex headings for search scope ${whereClause}: ${err.message}\n${err.stack}`);
    }
  }
  var itemsStarted = Date.now();
  debug(`reindex search scope items query start: ${whereClause}`);
  var items = await getHadithSearchRowsWithAdjacentRefs(whereClause);
  debug(`reindex search scope items query returned ${items.length} rows in ${Date.now() - itemsStarted}ms: ${whereClause}`);
  if (items.length > 0) {
    var itemIndexStarted = Date.now();
    try {
      await Index.updateBulk(Item.INDEX, items, true);
      debug(`reindex search scope items indexed ${items.length} rows in ${Date.now() - itemIndexStarted}ms: ${whereClause}`);
    } catch (err) {
      debug(`unable to reindex hadiths for search scope ${whereClause}: ${err.message}\n${err.stack}`);
    }
    if (options.syncKnowledge !== false)
      await HadithKnowledge.syncForHadithRows(items);
  }
  if (options.refresh) {
    var refreshStarted = Date.now();
    await Index.refresh(Heading.INDEX);
    await Index.refresh(Item.INDEX);
    debug(`reindex search scope refreshed indexes in ${Date.now() - refreshStarted}ms: ${whereClause}`);
  }
  debug(`reindex search scope done in ${Date.now() - started}ms: ${whereClause}`);
}

function runHadithPostUpdateTasks(hadithId, options) {
  options = options || {};
  (async () => {
    var rows = await getHadithSearchRowsWithAdjacentRefs(`hId=${parseInt(hadithId, 10)}`);
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

async function getHadithSearchRowsWithAdjacentRefs(whereClause) {
  var started = Date.now();
  if (/\bbook_id\s*=\s*0\b/.test(whereClause)) {
    debug(`hadith item rows using quran fast query: ${whereClause}`);
    var quranRows = await getQuranHadithSearchRows(whereClause);
    debug(`hadith item rows quran fast query returned ${quranRows.length} rows in ${Date.now() - started}ms: ${whereClause}`);
    return quranRows;
  }
  debug(`hadith item rows using v_hadiths query: ${whereClause}`);
  var rows = await global.query(`
    SELECT *
    FROM v_hadiths
    WHERE ${whereClause}
    ORDER BY ordinal`);
  debug(`hadith item rows v_hadiths query returned ${rows.length} rows in ${Date.now() - started}ms: ${whereClause}`);
  return rows;
}

async function getQuranHadithSearchRows(whereClause) {
  var hadithWhereClause = whereClause
    .replace(/\bhId\b/g, 'h.id')
    .replace(/\bbook_id\b/g, 'h.bookId')
    .replace(/\bh1\b/g, 'h.h1')
    .replace(/\bh2\b/g, 'h.h2')
    .replace(/\bh3\b/g, 'h.h3');
  debug(`quran hadith item SQL where: ${hadithWhereClause}`);
  return await global.query(`
    SELECT h.id, h.id AS hId, h.tocId AS tId, 'hadith' AS doctype,
      CONCAT(b.alias, '/', h.h1, '/', h.h2) AS path,
      CONCAT(b.alias, ':', h.num) AS ref,
      b.id AS book_id, b.ordinal AS book_ordinal, b.alias AS book_alias,
      b.shortName_en AS book_shortName_en, b.shortName AS book_shortName,
      b.name_en AS book_name_en, b.name AS book_name,
      b.author AS book_author, b.virtual AS book_virtual,
      sec.level AS level,
      ch.id AS h1_id, h.h1, ch.title_en AS h1_title_en, ch.title AS h1_title, ch.intro_en AS h1_intro_en, ch.intro AS h1_intro, ch.start AS h1_start, ch.count AS h1_count,
      sec.id AS h2_id, h.h2, sec.title_en AS h2_title_en, sec.title AS h2_title, sec.intro_en AS h2_intro_en, sec.intro AS h2_intro, sec.start AS h2_start, sec.count AS h2_count,
      sub.id AS h3_id, h.h3, sub.title_en AS h3_title_en, sub.title AS h3_title, sub.intro_en AS h3_intro_en, sub.intro AS h3_intro, sub.start AS h3_start, sub.count AS h3_count,
      h.ordinal, h.numInChapter,
      g.id AS grade_id, g.grade_en AS grade_grade_en, g.grade AS grade_grade,
      p.id AS grader_id, p.shortName_en AS grader_shortName_en, p.shortName AS grader_shortName,
      p.name_en AS grader_name_en, p.name AS grader_name,
      NULL AS grade_grade_ids, NULL AS grade_grades,
      h.verified, h.remark, h.numActual, h.num, h.num0, h.title_en, h.title, h.part_en, h.part,
      h.chain_en, h.body_en, h.footnote_en, h.chain, h.body, h.footnote, h.text_en AS text, h.text AS text_en,
      h.tags, h.books, h.lastmod, h.lastfixed, h.highlight, h.commented
    FROM hadiths h
    JOIN books b ON b.id=h.bookId
    JOIN grades g ON g.id=h.gradeId
    JOIN graders p ON p.id=h.graderId
    LEFT JOIN toc ch ON ch.bookId=h.bookId AND ch.level=1 AND ch.h1=h.h1
    LEFT JOIN toc sec ON sec.id=h.tocId
    LEFT JOIN toc sub ON sub.bookId=h.bookId AND sub.level=3 AND sub.h1=h.h1 AND sub.h2=h.h2 AND sub.h3=h.h3
    WHERE ${hadithWhereClause}
    ORDER BY h.ordinal`);
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
