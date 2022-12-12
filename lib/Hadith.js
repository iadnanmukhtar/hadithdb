/* jslint node:true, esversion:8 */
'use strict';

const Arabic = require('../lib/Arabic');
const Utils = require('./Utils');

class Hadith {

    constructor(hadithRow) {
        for (var k in hadithRow)
            this[k] = hadithRow[k];
        if (this.hId)
            this.id = this.hId;
        this.book = global.books.find(function (value) {
            return hadithRow.bookId == value.id;
        });
        if (!this.book)
            this.book = global.books[0];
        this.grade = global.grades.find(function (value) {
            return hadithRow.gradeId == value.id;
        });
        if (!this.grade)
            this.grade = global.grades[0];
        this.grader = global.graders.find(function (value) {
            return hadithRow.graderId == value.id;
        });
        if (!this.grader)
            this.grader = global.graders[0];
        this.num = hadithRow.num + '';
        this.num_ar = Arabic.toArabicDigits(this.num);
        if (!this.grade) this.grade = "No Grade";
    }

    static splitHadithText(hadithText) {
        // normalize
        if (hadithText.text) {
            hadithText.text = hadithText.text.replace(/[\:\"\'،۔ـ\-\.\,]/g, '');
            hadithText.text = hadithText.text.replaceAll('صلى الله عليه وسلم', 'ﷺ');
            hadithText.text = hadithText.text.replace(/\s+/g, ' ').trim();
        }
        var textMarked = hadithText.text + '';
        var bodyMarked = '';
        textMarked = textMarked.replace(/[ؐ-ًؕ-ٖٓ-ٟۖ-ٰٰۭ]/g, '');
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
            for (var j = 0; j < chainDelims.length; j++) {
                if (chainDelims[j].match(/(نبي|رسول)/)) {
                    bodyMarked = chainDelims.slice(j).join('~ ');
                    break;
                } else if (chainToksWordCount[j] > 7 && !chainDelims[j].match(/ (بن|ابن) /)) {
                    bodyMarked = chainDelims.slice(j).join('~ ');
                    break;
                }
            }
            if (bodyMarked == '')
                bodyMarked = chainDelims[chainDelims.length - 1];
        }
        if (bodyMarked == null) {
            process.stdout.write('ERROR on: ' + hadithText.bookId + ' ' + hadithText.num + '\n');
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
        return hadithText;
    }

    static async a_dbHadithInit(hadith) {
        if (!hadith.tags) {
            hadith.tags = [];
            var tagIds = await a_dbGetTagIds(hadith.id);
            for (var tagId in tagIds) {
                hadith.tags.push(global.books.find(function (value) {
                    return tagId == value.id;
                }));
            }
        }
        if (!hadith.chapter) {
            var heading = await a_dbGetHeading(hadith);
            hadith.chapter = heading.chapter;
            hadith.section = heading.section;
        }
        if (hadith.prevId) {
            var prev = await a_dbGetHadith(hadith.prevId);
            hadith.prev = prev;
        }
        if (hadith.nextId) {
            var next = await a_dbGetHadith(hadith.nextId);
            hadith.next = next;
        }
    }

    static async a_getRecentUpdates() {
        var results = [];
        var rows = await a_dbGetRecentUpdates();
        for (var i = 0; i < rows.length; i++) {
            var hadith = new Hadith(rows[i]);
            await Hadith.a_dbHadithInit(hadith);
            results.push(hadith);
        }
        return results;
    }

    static async a_getSimilarCandidates(id) {
        var results = [];
        var rows = await a_dbGetSimilarCandidates(id);
        for (var i = 0; i < rows.length; i++) {
            var hadith = new Hadith(rows[i]);
            await Hadith.a_dbHadithInit(hadith);
            results.push(hadith);
        }
        return results;
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

async function a_dbGetSimilarCandidates(id) {
    var hadiths = await global.query(`
        select c.rating, h.* from hadiths h, (
            select distinct * from (
                select hadithId2 as id, rating from hadith_sim_candidates
                where hadithId1=${id} and rating > 0.6
                union
                select hadithId1 as id, rating from hadith_sim_candidates
                where hadithId2=${id} and rating > 0.6
            ) as c0
        ) as c
        where h.id = c.id
        ORDER BY bookId, rating
        LIMIT 100`);
    return hadiths;
}

async function a_dbGetTagIds(id) {
    var tagIds = await global.query(`
        SELECT tagId FROM hadith_tags
        WHERE hadithId=${id}`);
    return tagIds;
}

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

async function a_dbGetRecentUpdates() {
    var rows = await global.query(
        `SELECT * FROM hadiths
        ORDER BY lastmod DESC
        LIMIT 30`);
    return rows;
}