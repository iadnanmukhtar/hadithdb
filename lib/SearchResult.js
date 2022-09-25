/* jslint node:true, esversion:6 */
'use strict';

const Hadith = require('../lib/Hadith');
const Search = require('../lib/Search');

class SearchResult extends Hadith {

    constructor(hadithRow, matches) {
        super(hadithRow);
        if (matches) {
            for (var o of matches)
                for (var k in o)
                    this[k] = o[k];
        }
        if (this.num == '183a')
            var x = 0;
        // TODO: Shorten remainining text
        if (this.chain_en && this.chain_en.indexOf('<i>') < 0)
            this.chain_en = '…' + this.chain_en.substring(this.chain_en.length - (global.SURROUND_LENGTH * 2));
        if (this.body_en && this.body_en.indexOf('<i>') < 0)
            this.body_en = this.body_en.substring(0, global.SURROUND_LENGTH * 2) + '…';
        if (this.chain && this.chain.indexOf('<i>') < 0)
            this.chain = '…' + this.chain.substring(this.chain.length - (global.SURROUND_LENGTH * 4 * 0.75));
        if (this.body && this.body.indexOf('<i>') < 0)
            this.body = this.body.substring(0, global.SURROUND_LENGTH * 4 * 0.75) + '…';
    }

}

module.exports = SearchResult;