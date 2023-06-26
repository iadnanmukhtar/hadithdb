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
        // // Shorten remainining text
        // if (this.chain_en && this.chain_en.indexOf('<i>') < 0)
        //     this.chain_en = '…' + this.chain_en.substring(this.chain_en.length - (global.SURROUND_LENGTH * 2));
        // if (this.body_en && this.body_en.indexOf('<i>') < 0)
        //     this.body_en = this.body_en.substring(0, global.SURROUND_LENGTH * 2) + '…';
        // if (this.footnote_en && this.footnote_en.indexOf('<i>') < 0)
        //     this.footnote_en = this.footnote_en.substring(0, global.SURROUND_LENGTH * 4 * 0.75) + '…';
        // if (this.chain && this.chain.indexOf('<i>') < 0)
        //     this.chain = '…' + this.chain.substring(this.chain.length - (global.SURROUND_LENGTH * 4 * 0.75));
        // if (this.body && this.body.indexOf('<i>') < 0)
        //     this.body = this.body.substring(0, global.SURROUND_LENGTH * 4 * 0.75) + '…';
        // if (this.footnote && this.footnote.indexOf('<i>') < 0)
        //     this.footnote = this.footnote.substring(0, global.SURROUND_LENGTH * 4 * 0.75) + '…';
    }

}

module.exports = SearchResult;