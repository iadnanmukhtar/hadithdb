/* jslint node:true, esversion:8 */
'use strict';

const HomeDir = require('os').homedir();
const MySQL = require('mysql');
const Util = require('util');
const Arabic = require('../lib/Arabic');

class Hadith {

    constructor(hadithRow, noLinks) {
        for (var k in hadithRow)
            this[k] = hadithRow[k];
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
        if (!noLinks && this.rowNum >= 0) {
            if (this.rowNum > 0)
                this.prev = new Hadith(global.hadiths[this.rowNum - 1], true);
            if (this.rowNum < (global.hadiths.length - 1))
                this.next = new Hadith(global.hadiths[this.rowNum + 1], true);
        }
    }

    static async a_dbHadithInit(hadith) {
        hadith.tags = [];
        var tagIds = await a_dbGetTagIds(hadith.id);
        for (var tagId in tagIds) {
            hadith.tags.push(global.books.find(function (value) {
                return tagId == value.id;
            }));
        }
        hadith.heading = await a_dbGetHeading(hadith);
    }

    static async a_getRecentUpdates() {
        var results = [];
        var rows = await a_dbGetRecentUpdates();
        for (var i = 0; i < rows.length; i++) {
            var hadith = new Hadith(rows[i], false);
            await Hadith.a_dbHadithInit(hadith);
            results.push(hadith);
        }
        return results;
    }

    static reinit() {
        console.log('reloading hadith data');
        a_dbInitApp();
    }

}

module.exports = Hadith;

async function a_dbGetTagIds(id) {
    var tagIds = await global.query(`
        SELECT tagId FROM hadith_tags
        WHERE hadithId=${id}`);
    return tagIds;
}

async function a_dbGetHeading(hadith) {
    var sql = `
        SELECT * FROM toc
        WHERE bookId=${hadith.bookId} AND level=2 AND ${hadith.num0} >= start0 AND ${hadith.num0} <= end0
        UNION
        SELECT * FROM toc
        WHERE bookId=${hadith.bookId} AND level=1 AND ${hadith.num0} >= start0 AND ${hadith.num0} <= end0
        ORDER BY level DESC, h1,h2,h3 ASC`;
    var heading = await global.query(sql);
    if (heading.length > 0)
        return heading[0];
    else
        return null;
}

async function a_dbGetRecentUpdates() {
    var rows = await global.query(
        `SELECT 
            id,bookId,num,num0,lastmod,gradeId,graderId,chain_en,body_en,footnote_en,chain,body,footnote
        FROM
            hadiths
        ORDER BY
            lastmod DESC
        LIMIT 25`);
    return rows;
}

// initialize data load
global.MySQLConfig = require(HomeDir + '/.hadithdb/store.json');
global.books = [{
    id: -1,
    alias: 'none',
    shortName_en: 'Loading...',
    shortName: "",
    name_en: 'Loading...',
    name: '',
}];
global.grades = [{
    id: -1,
    hadithId: -1,
    grade_en: 'N/A',
    grade: '',
}];
global.graders = [{
    id: -1,
    shortName_en: 'N/A',
    shortName: '',
    name_en: '',
    name: '',
}];
global.hadiths = [{
    id: -1,
    bookId: -1,
    num: '0',
    gradeId: -1,
    graderId: -1,
    body_en: 'Please wait while data is loading...',
    body: 'إنتظر لو سمحت',
    search_chain: 'إنتظر لو سمحت',
    search_body: 'إنتظر لو سمحت',
    book: global.books[0],
}];
global.toc = [];
global.tags = [];

global.connection = MySQL.createConnection(global.MySQLConfig.connection);
global.query = Util.promisify(global.connection.query).bind(global.connection);
async function a_dbInitApp() {
    global.hadiths = await global.query(
        `SELECT 
            id,bookId,num,num0,lastmod,gradeId,graderId,chain_en,body_en,footnote_en,chain,body,footnote
        FROM
            hadiths
        ORDER BY
            bookId, CAST(num as unsigned)`);
    global.books = await global.query('SELECT * FROM books ORDER BY id ASC');
    global.toc = await global.query('SELECT * FROM toc');
    global.tags = await global.query('SELECT * FROM tags');
    global.grades = await global.query('SELECT * FROM grades');
    global.graders = await global.query('SELECT * FROM graders');
    console.log('loaded hadith data');
    for (var i = 0; i < global.hadiths.length; i++) {
        var hadith = global.hadiths[i];
        hadith.rowNum = i;
        hadith.num = (hadith.num + '').replace(/ /g, '');
        hadith.search_chain = Arabic.removeArabicDiacritics(hadith.chain);
        hadith.search_body = Arabic.removeArabicDiacritics(hadith.body);
    }
}
a_dbInitApp();