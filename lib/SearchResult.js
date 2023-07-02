/* jslint node:true, esversion:9 */
'use strict';

const Hadith = require('./Hadith');

class SearchResult extends Hadith {

    constructor(row, matches) {
        super(row);
        if (matches) {
            for (var o of matches)
                for (var m in o)
                    this[m] = o[m];
        }
        this.matchType = 'si';
    }

}

module.exports = SearchResult;