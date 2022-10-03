/* jslint node:true, esversion:8 */
'use strict';

const HomeDir = require('os').homedir();
const MySQL = require('mysql');
const { loadavg } = require('os');
const Util = require('util');

class Hadith {

    constructor(hadithRow, noLinks) {
        for (var k in hadithRow)
            this[k] = hadithRow[k];
        this.book = global.books.find(function (value) {
            return hadithRow.bookId == value.id;
        });
        this.grade = global.grades.find(function (value) {
            return hadithRow.gradeId == value.id;
        });
        this.grader = global.graders.find(function (value) {
            return hadithRow.graderId == value.id;
        });
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
        init();
    }

}

module.exports = Hadith;

async function getTagIds(id) {
    global.connection.connect();
    var tagIds = await global.query(`SELECT tagId FROM hadith_tags WHERE hadithId=${id}`);
    global.connection.end();
    return tagIds;
}

global.MySQLConfig = require(HomeDir + '/.hadithdb/store.json');

// initialize data load
async function init() {
    global.connection = MySQL.createConnection(global.MySQLConfig.connection);
    global.query = Util.promisify(global.connection.query).bind(global.connection);
    global.connection.connect();
	global.books = await global.query('SELECT * FROM books');
    global.toc = await global.query('SELECT * FROM toc');
    global.tags = await global.query('SELECT * FROM tag_path');
	global.grades = await global.query('SELECT * FROM grades');
	global.graders = await global.query('SELECT * FROM graders');
    global.hadiths = await global.query(`
        SELECT 
            id,bookId,num,lastmod,gradeId,graderId,chain_en,body_en,footnote_en,chain,body,footnote
        FROM
            hadiths
        ORDER BY
            bookId, CAST(num as unsigned)
        LIMIT 10`);
	console.log('loaded hadith data');
	global.connection.end();
	for (var i = 0; i < global.hadiths.length; i++) {
		var hadith = global.hadiths[i];
		hadith.rowNum = i;
		hadith.num = (hadith.num + '').replace(/ /g, '');
		hadith.search_chain = Hadith.removeDiacritics(hadith.chain);
		hadith.search_body = Hadith.removeDiacritics(hadith.body);
	}
}
init();
