/* jslint node:true, esversion:6 */
'use strict';

class Hadith {

    constructor(hadithRow, noLinks) {
        for (var k in hadithRow)
            this[k] = hadithRow[k];
        this.book = global.books.find(function (value) {
            return hadithRow.bookId == value.id;
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

    static toArabicDigits(s) {
        s = s.replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
        s = s.replace('a', ' أ').replace('b', ' ب').replace('c', ' ج').replace('d', ' د').replace('e', ' ه').replace('f', ' و').replace('g', ' ز');
        return s;
    }

}

module.exports = Hadith;