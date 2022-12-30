/* jslint node:true, esversion:8 */
'use strict';

const stringSimilarity = require("string-similarity");
const Arabic = require('../lib/Arabic');
const Utils = require('./Utils');

class Hadith {

    constructor(row) {

        for (var k in row)
            this[k] = row[k];
        if (this.hId)
            this.id = this.hId;

        this.num = row.num + '';
        this.num_ar = Arabic.toArabicDigits(this.num);

        if (this.book_id != null)
            row.bookId = this.bookId = this.book_id;
        this.book = global.books.find(function (value) {
            return row.bookId == value.id;
        });

        if (this.grade_id != null)
            row.gradeId = this.gradeId = this.grade_id;
        this.grade = global.grades.find(function (value) {
            return row.gradeId == value.id;
        });

        if (this.grader_id != null)
            row.graderId = this.graderId = this.grader_id;
        this.grader = global.graders.find(function (value) {
            return row.graderId == value.id;
        });

        if (this.h1_id != null) {
            this.chapter = {
                id: this.h1_id,
                h1: this.h2,
                title_en: this.h1_title_en,
                title: this.h1_title,
                intro_en: this.h1_intro_en,
                intro: this.h1_intro,
                start: this.h1_start
            };
        }

        if (this.h2_id != null) {
            this.section = {
                id: this.h2_id,
                h2: this.h2,
                title_en: this.h2_title_en,
                title: this.h2_title,
                intro_en: this.h2_intro_en,
                intro: this.h2_intro,
                start: this.h2_start
            };
        }

        if (row.prev)
            this.prev = new Hadith(row.prev);
        if (row.next)
            this.next = new Hadith(row.next);
    }

    static async a_dbHadithInit(hadith) {
        // if (!hadith.tags) {
        //     hadith.tags = [];
        //     var tagIds = await a_dbGetTagIds(hadith.id);
        //     for (var tagId in tagIds) {
        //         hadith.tags.push(global.books.find(function (value) {
        //             return tagId == value.id;
        //         }));
        //     }
        // }
        if (!hadith.chapter || !hadith.section) {
            var heading = await a_dbGetHeading(hadith);
            hadith.chapter = heading.chapter;
            hadith.section = heading.section;
        }
        if (hadith.prevId && !hadith.prev) {
            hadith.prev = new Hadith(await a_dbGetHadith(hadith.prevId));
        }
        if (hadith.nextId && !hadith.next) {
            hadith.next = new Hadith(await a_dbGetHadith(hadith.nextId));
        }
    }

    static async a_dbGetRecentUpdates() {
        var results = [];
        var rows = await global.query(
            `SELECT vh.* FROM hadiths h, v_hadiths vh
            WHERE h.highlight IS NOT NULL
              AND h.id = vh.hId
            ORDER BY vh.highlight DESC
            LIMIT 50`);
        for (var i = 0; i < rows.length; i++)
            results.push(new Hadith(rows[i]));
        return results;
    }

    static async a_dbGetAllHadithsWithTag(tagId) {
        var results = [];
        var rows = await global.query(`
            SELECT vh.* FROM hadiths_tags ht, v_hadiths vh
            WHERE ht.hadithId=vh.hId AND ht.tagId=${tagId}
            ORDER BY bookId, h1, h2`);
        for (var i = 0; i < rows.length; i++)
            results.push(new Hadith(rows[i]));
        return results;
    }

    static async a_dbGetSimilarCandidates(id) {
        var results = [];
        var rows = await global.query(`
            SELECT c.rating, vh.* FROM v_hadiths vh, (
                SELECT DISTINCT * FROM (
                    SELECT hadithId2 AS id, rating FROM hadiths_sim_candidates
                    WHERE hadithId1=${id} AND rating >= 0.5
                    UNION
                    SELECT hadithId1 AS id, rating FROM hadiths_sim_candidates
                    WHERE hadithId2=${id} AND rating >= 0.5
                ) AS c0
            ) AS c
            WHERE vh.hId = c.id
            ORDER BY rating DESC
            LIMIT 50`);
        for (var i = 0; i < rows.length; i++)
            results.push(new Hadith(rows[i]));
        return results;
    }

    static async a_dbGetSimilarCandidateBooks(id) {
        var books = await global.query(`
            SELECT DISTINCT b.* 
            FROM hadiths h, books b, (
                SELECT DISTINCT * FROM (
                    SELECT hadithId2 AS id, rating FROM hadiths_sim_candidates
                    WHERE hadithId1=${id}
                    UNION
                    SELECT hadithId1 AS id, rating FROM hadiths_sim_candidates
                    WHERE hadithId2=${id}
                ) AS c0
            ) AS c
            WHERE h.id = c.id AND h.bookId = b.id
            ORDER BY b.id
            LIMIT 50`);
        return books;
    }

    static async a_recordSimilarMatches(deHadith, deDB) {
        await global.query(`DELETE FROM hadiths_sim_candidates WHERE hadithId1=${deHadith.id} OR hadithId2=${deHadith.id}`);
        if (!deDB)
            deDB = await Hadith.a_dbGetDisemvoweledHadiths();
        if (deHadith.body && deHadith.body.length < 100 && (
            deHadith.body.match(/مثله/) ||
            deHadith.body.match(/نحوه/) ||
            deHadith.body.match(/الإسناد/) ||
            deHadith.back_ref
        )) {
            deDB = null;
            return;
        }
        for (var i = 0; i < deDB.length; i++) {
            if (deHadith.id === deDB[i].id) continue;
            if (Utils.emptyIfNull(deDB[i].body) == '') continue;
            try {
                var match = Hadith.findBestMatch(deHadith, deDB[i]);
                if (match.isMatch) {
                    console.log(`${deHadith.bookId}:${deHadith.num0} ~ ${deDB[i].bookId}:${deDB[i].num0}\t${deHadith.body.substring(0, 50)}\t${deDB[i].body.substring(0, 50)}`);
                    await global.query(`
						INSERT INTO hadiths_sim_candidates
						VALUES (${deHadith.id}, ${deDB[i].id}, ${match.bestMatch.rating})`);
                }
            } catch (err) {
                console.error(`${deHadith.bookId}:${deHadith.num0} ~ ${deDB[i].bookId}:${deDB[i].num0}\t${err}`);
            }
        }
        deDB = null;
    }

    static findBestMatch(hadith1, hadith2) {
        var source = (hadith1.body.length >= hadith2.body.length) ? hadith2.body : hadith1.body;
        var target = (hadith1.body.length >= hadith2.body.length) ? hadith1.body : hadith2.body;
        var sourceCnt = Utils.wordCount(source);
        var targetCnt = Utils.wordCount(target);
        var match = null;
        if (sourceCnt > 5 && (targetCnt / sourceCnt >= 2)) {
            // var splitLength = Math.floor(target.length / (target.length / source.length));
            // var matches = [];
            // for (var n = 0; n < target.length; n += 30) {
            //     match = stringSimilarity.findBestMatch(source, [target.substring(n, splitLength)]);
            //     matches.push(match);
            // }
            // var best = 0;
            // var bestNdx = 0;
            // for (var i = 0; i < matches.length; i++) {
            //     if (matches[i].bestMatch.rating > best) {
            //         best = matches[i].bestMatch.rating;
            //         bestNdx = i;
            //     }
            // }
            // match = matches[bestNdx];
            // if (match.bestMatch.rating >= 0.55)
            //     match.isMatch = true;
            // else
            //     match.isMatch = false;
            match = stringSimilarity.findBestMatch(source, [target]);
            if (match.bestMatch.rating >= 0.55)
                match.isMatch = true;
            else
                match.isMatch = false;
        } else {
            match = stringSimilarity.findBestMatch(source, [target]);
            if (match.bestMatch.rating >= 0.60)
                match.isMatch = true;
            else
                match.isMatch = false;
        }
        return match;
    }

    static async a_dbGetDisemvoweledHadiths() {
        var rows = await global.query(`
            SELECT id, bookId, num0, body, back_ref FROM hadiths 
            ORDER BY bookId, h1, num0`);
        rows = rows.map((row) => {
            return Hadith.disemvoweledHadith(row);
        });
        return rows;
    }

    static disemvoweledHadith(hadith) {
        if (hadith.body) {
            hadith.body = hadith.body.replace(/ًا/gu, '');
            hadith.body = hadith.body.replace(/[^\p{L} ]/gu, '');
            hadith.body = hadith.body.replace(/[\u0621\u0671]/gu, 'ا');
            hadith.body = hadith.body.replace(/[\u0623-\u0626\u0672-\u0678]/gu, 'ء');
            hadith.body = hadith.body.replace(/[^\u0621-\u064a ]/gu, '');
            if (hadith.bookId > 0) {
                hadith.body = hadith.body.replace(/رسول الله /gu, '');
                hadith.body = hadith.body.replace(/(النبي |نبي)/gu, '');
                hadith.body = hadith.body.replace(/رضي الله عن.+? /gu, '');
                hadith.body = hadith.body.replace(/صل الله علي.+? /gu, '');
            }
            hadith.body = hadith.body.replace(/( |^)ال([^\s]{3,})( |$)/gu, '$1$2$3');
            hadith.body = hadith.body.replace(/( |^)([^\s]{2,})(ات|ان|ين|ون)( |$)/gu, '$1$2$4');
            hadith.body = hadith.body.replace(/[ايوى]/g, '');
            hadith.body = hadith.body.replace(/[ة]/g, 'ت');
            hadith.body = hadith.body.replace(/[ؤئأإ]/g, 'ء');
            hadith.body = hadith.body.replace(/ +/gu, ' ');
            hadith.body = hadith.body.trim();
        }
        return hadith;
    }

    static hadithNumtoDecimal(num) {
        if (num.startsWith('i')) {
            num = '0-' + num.substring(1);
        }
        var n = parseInt(Utils.regexExtract(num, /^([0-9]+)/) || -1);
        var d = 0;
        var suffix = Utils.regexExtract(num, /([a-z]+)/);
        if (suffix)
            d = parseInt(Utils.lettersToNumber(suffix)) / 1000.;
        else {
            suffix = Utils.regexExtract(num, /[\-/](\d+)/);
            if (suffix)
                d = parseInt(suffix) / 1000.;
        }
        return n + d;
    }

    static splitHadithText(hadithText) {
        try {
            // normalize
            if (hadithText.text) {
                hadithText.text = hadithText.text.replace(/[\:\"\'،۔ـ\-\.\,]/g, '');
                hadithText.text = hadithText.text.replaceAll('صلى الله عليه وسلم', 'ﷺ');
                hadithText.text = hadithText.text.replace(/\s+/g, ' ').trim();
            }
            var textMarked = hadithText.text + '';
            var bodyMarked = '';
            textMarked = Arabic.removeArabicDiacritics(textMarked);
            textMarked = textMarked.replace(/و?(حدثنا|حدثني|حدثناه|حدثه|ثنا) /g, '~ ');
            textMarked = textMarked.replace(/و?(أخبرنا|أخبرناه|أخبرني|أخبره|آنا) /g, '~ ');
            textMarked = textMarked.replace(/و?(أنبأنا|أنبأناه|أنبأني|أنبأه|آنبأ) /g, '~ ');
            textMarked = textMarked.replace(/و?(سمعت|سمعنا|سمعناه|سمع) /g, '~ ');
            textMarked = textMarked.replace(/(عن) /g, '~ ');
            textMarked = textMarked.replace(/(يبلغ به) /g, '~~ ');
            textMarked = textMarked.replace(/(أنه|أن|أنها) /g, '~ ');
            textMarked = textMarked.replace(/(قال|قالت) /g, '~ ');
            textMarked = textMarked.replace(/\s+/g, ' ').trim();
            // extract body
            var chainDelims = textMarked.split(/~/);
            if (chainDelims) {
                var chainToksWordCount = [];
                for (var tok of chainDelims)
                    chainToksWordCount.push(wordCount(tok));
                var maxLen = Math.floor(Math.max(...chainToksWordCount) * .25);
                if (maxLen < 10) maxLen = 10;
                for (var j = 0; j < chainDelims.length; j++) {
                    if (chainDelims[j].match(/(النبي|رسول)/)) {
                        bodyMarked = chainDelims.slice(j).join('~ ');
                        break;
                    } else if (chainToksWordCount[j] > maxLen && !chainDelims[j].match(/ (بن|ابن) /)) {
                        bodyMarked = chainDelims.slice(j).join('~ ');
                        break;
                    }
                }
                if (bodyMarked == '')
                    bodyMarked = chainDelims[chainDelims.length - 1];
            }
            if (bodyMarked == null) {
                console.log('ERROR on: ' + hadithText.bookId + ' ' + hadithText.num + '\n');
                return;
            }
            bodyMarked = bodyMarked.replace(/\s+/g, ' ').trim();
            // extract chain and body
            var textToks = hadithText.text.split(/ /);
            var textMarkedToks = textMarked.split(/ /);
            var bodyMarkedToks = bodyMarked.split(/ /);
            hadithText.body = '';
            if (!textToks || !bodyMarkedToks || textToks.length == bodyMarkedToks.length)
                hadithText.body = hadithText.text;
            else {
                var diff = textToks.length - bodyMarkedToks.length;
                for (var j = (diff - 1); j >= 0; j--) {
                    if (textMarkedToks[j].endsWith('~'))
                        diff--;
                    else
                        break;
                }
                hadithText.chain = textToks.slice(0, diff).join(' ').trim();
                hadithText.body = textToks.slice(diff).join(' ').trim();
            }
        } catch (err) {
            console.log(`ERROR on: ${hadithText.bookId}:${hadithText.num}: ${err}\n${err.stack}`);
        }
        return hadithText;
    }

    static async reinit() {
        console.log('stubbed out');
    }

}

module.exports = Hadith;

function wordCount(s) {
    return s.split(' ').length;
}

async function a_dbGetHadith(id) {
    var hadith = await global.query(`
        SELECT * FROM v_hadiths
        WHERE hId=${id}`);
    return hadith;
}

// async function a_dbGetTagIds(id) {
//     var tagIds = await global.query(`
//         SELECT tagId FROM hadiths_tags
//         WHERE hadithId=${id}`);
//     return tagIds;
// }

async function a_dbGetHeading(hadith) {
    var heading = {};
    if (hadith.h1 != undefined) {
        var sql = Utils.sql(`
        SELECT * FROM toc
        WHERE bookId=${hadith.bookId} AND level=1 AND h1=${hadith.h1}
        ORDER BY h1,h2,h3 ASC
        LIMIT 1`);
        var results = await global.query(sql);
        heading.chapter = results.find(function (row) {
            if (row.level == 1)
                return true;
        });
    }
    if (hadith.h1 != undefined && hadith.h2 != undefined) {
        var sql = Utils.sql(`
        SELECT * FROM toc
        WHERE bookId=${hadith.bookId} AND level=2 AND h1=${hadith.h1} AND h2=${hadith.h2}
        ORDER BY h1,h2,h3 ASC
        LIMIT 1`);
        var results = await global.query(sql);
        heading.section = results.find(function (row) {
            if (row.level == 2)
                return true;
        });
    }
    return heading;
}

