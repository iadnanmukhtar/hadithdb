/* jslint node:true, esversion:6 */

"use strict";
const fs = require('fs');

var books = JSON.parse(fs.readFileSync(__dirname + '/../data/books.json'));

class Hadith {

    constructor(record) {
        var toks = record.split(/\t/);
        var bid = this.bookId = toks[0];
        this.book = books.find(function (value) {
            return bid == value.id; 
        });
        this.num = toks[1];
        this.grade = toks[2];
        this.trans = toks[3];
        this.text = toks[4];
        this.chain = toks[5];
        this.body = toks[6];
        if (!this.trans) this.trans = "Untranslated";
        if (!this.grade) this.grade = "Ungraded";
    }

}

module.exports = Hadith;