/* jslint node:true, esversion:8 */
'use strict';

const HomeDir = require('os').homedir();
const MySQL = require('mysql');
const Util = require('util');

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
        this.num_ar = Hadith.toArabicDigits(this.num);
        if (!this.grade) this.grade = "No Grade";
        if (!noLinks && this.rowNum >= 0) {
            if (this.rowNum > 0)
                this.prev = new Hadith(global.hadiths[this.rowNum - 1], true);
            if (this.rowNum < (global.hadiths.length - 1))
                this.next = new Hadith(global.hadiths[this.rowNum + 1], true);
        }
    }

    get tags() {
        var tags = [];
        var tagIds = getTagIds(this.id);
        for (var tagId in tagIds) {
            tags.push(global.books.find(function (value) {
                return tagId == value.id;
            }));
        }
        return tags;
    }

    static async getRecentUpdates() {
        var results = [];
        var rows = await dbGetRecentUpdates();
        for (var i = 0; i < rows.length; i++) {
            results.push(await new Hadith(rows[i], false));
        }
        return results;
    }

	static removeDiacritics(s) {
		return s.replace(/[\u064B\u064C\u064D\u064E\u064F\u0650\u0651\u0652\u0670]+/g, '');
	}

    static toArabicDigits(s) {
        s = s.replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
        s = s.replace('a', ' أ').replace('b', ' ب').replace('c', ' ج').replace('d', ' د').replace('e', ' ه').replace('f', ' و').replace('g', ' ز');
        return s;
    }

    static reinit() {
        console.log('reloading hadith data');
        dbInit();
    }

}

module.exports = Hadith;

async function getTagIds(id) {
    var tagIds = await global.query(`SELECT tagId FROM hadith_tags WHERE hadithId=${id}`);
    return tagIds;
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
async function dbInit() {
    global.hadiths = await global.query(
        `SELECT 
            id,bookId,num,lastmod,gradeId,graderId,chain_en,body_en,footnote_en,chain,body,footnote
        FROM
            hadiths
        ORDER BY
            bookId, CAST(num as unsigned)`);
    global.books = await global.query('SELECT * FROM books');
    global.toc = await global.query('SELECT * FROM toc');
    global.tags = await global.query('SELECT * FROM tag_path');
    global.grades = await global.query('SELECT * FROM grades');
    global.graders = await global.query('SELECT * FROM graders');
    console.log('loaded hadith data');
	for (var i = 0; i < global.hadiths.length; i++) {
		var hadith = global.hadiths[i];
		hadith.rowNum = i;
		hadith.num = (hadith.num + '').replace(/ /g, '');
		hadith.search_chain = Hadith.removeDiacritics(hadith.chain);
		hadith.search_body = Hadith.removeDiacritics(hadith.body);
	}
}
dbInit();

async function dbGetRecentUpdates() {
    var rows = await global.query(
        `SELECT 
            id,bookId,num,lastmod,gradeId,graderId,chain_en,body_en,footnote_en,chain,body,footnote
        FROM
            hadiths
        ORDER BY
            lastmod DESC
        LIMIT 25`);
    return rows;
}
