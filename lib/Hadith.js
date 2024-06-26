/* jslint node:true, esversion:9 */
'use strict';

const debug = require('debug')('hadithdb:Hadith');
const stringSimilarity = require("string-similarity");
const Arabic = require('./Arabic');
const Utils = require('./Utils');
const { Library } = require('./Model');
const Index = require('./Index');
const { Item } = require('./Model');

class Hadith {

    static async a_dbGetRecentUpdates(size) {
        if (!size)
            size = global.settings.search.itemsPerPage;
        var results = [];
        var rows = await global.query(
            `SELECT vh.* FROM hadiths h, v_hadiths vh
            WHERE h.highlight IS NOT NULL
              AND h.id = vh.hId
            ORDER BY vh.highlight DESC
            LIMIT ${size}`);
        for (var i = 0; i < rows.length; i++)
            results.push(new Item(rows[i]));
        return results;
    }

    static async a_parseNarrators(hadith) {
        debug(`updating narrators for ${hadith.bookId}:${hadith.num0}`);
        await global.query(`DELETE FROM hadiths_narrs WHERE hadithId=${hadith.id}`);
        var chains_en = Hadith.translateNarrators(hadith.chain).narrators;
        var chains = Hadith.parseNarrators(hadith.chain);
        var inserts = '';
        for (var j = 0; j < chains.length; j++) {
            if (j > 0) inserts += ' , ';
            var narrs_en = [].concat(chains_en[j]).reverse();
            var narrs = [].concat(chains[j]).reverse();
            if (narrs_en.length != narrs.length)
                throw new Error(`ERROR: ${hadith.bookId}:${hadith.num0} has dissimilar narrators`);
            for (var k = 0; k < narrs.length; k++) {
                if (k > 0) inserts += ' , ';
                inserts += ` ( ${hadith.id}, ${j + 1}, ${k + 1}, '${narrs_en[k]}', '${narrs[k]}' )`;
            }
        }
        inserts = inserts.trim();
        var trans = '';
        for (j = 0; j < chains.length; j++) {
            if (j > 0)
                trans += ' ';
            if (chains.length > 1)
                trans += `[Chain ${j + 1}] `;
            narrs_en = chains_en[j];
            for (var k = 0; k < narrs_en.length; k++) {
                if (k > 0) trans += ' > ';
                trans += narrs_en[k];
            }
        }
        trans = trans.trim();
        if (trans.length > 0)
            await global.query(`UPDATE hadiths SET chain_en='${Utils.escSQL(trans)}' WHERE id=${hadith.id}`);
        if (inserts.length > 0)
            await global.query(`INSERT INTO hadiths_narrs (hadithId, chainNum, ordinal, name_en, name) VALUES ${inserts}`);
    }

    static async a_dbGetSimilarCandidates(hadith) {
        var results = [];
        var rows = await global.query(`
            SELECT DISTINCT * FROM (
                SELECT id, 1 AS rating, bookId, ordinal, part FROM hadiths
                WHERE part = "${Utils.escSQL(Utils.sql(hadith.part))}"
                UNION
                SELECT hadithId2 AS id, 1 AS rating, h.bookId, h.ordinal, h.part FROM hadiths_sim, hadiths h
                WHERE hadithId1 = ${hadith.id} AND hadithId2=h.id
                UNION
                SELECT hadithId1 AS id, 1 AS rating, h.bookId, h.ordinal, h.part FROM hadiths_sim, hadiths h
                WHERE hadithId2 = ${hadith.id} AND hadithId1=h.id
                UNION
                SELECT hadithId2 AS id, rating, h.bookId, h.ordinal, h.part FROM hadiths_sim_candidates, hadiths h
                WHERE hadithId1 = ${hadith.id} AND rating >= 0.6 AND hadithId2=h.id
                UNION
                SELECT hadithId1 AS id, rating, h.bookId, h.ordinal, h.part FROM hadiths_sim_candidates, hadiths h
                WHERE hadithId2 = ${hadith.id} AND rating >= 0.6 AND hadithId1=h.id
            ) x
            WHERE id != ${hadith.id}
            ORDER BY rating DESC, ordinal`);
        results = await Index.docsFromObjectArray('hadiths', rows, 'id');
        results = results.map(item => { return new Item(item) });
        results.sort((a, b) => {
            if (a.rating != b.rating)
                return a.rating - b.rating;
            return a.bookId - b.bookId;
        });
        return results;
    }

    static async a_recordSimilarMatches(deHadith, deDB, simTableName) {
        if (!simTableName)
            simTableName = 'hadiths_sim_candidates';
        await global.query(`DELETE FROM ${simTableName} WHERE hadithId1=${deHadith.id} OR hadithId2=${deHadith.id}`);
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
        var inserts = '';
        var matchCnt = 0;
        for (var i = 0; i < deDB.length; i++) {
            if (deHadith.id == deDB[i].id) continue;
            if (Utils.emptyIfNull(deDB[i].body) == '') continue;
            try {
                var match = Hadith.findBestMatch(deHadith, deDB[i]);
                if (match.isMatch) {
                    debug(`${deHadith.bookId}:${deHadith.num0} ~ ${deDB[i].bookId}:${deDB[i].num0}`);
                    inserts += `${(matchCnt > 0) ? ',' : ''} (${deHadith.id}, ${deDB[i].id}, ${match.bestMatch.rating})`;
                    matchCnt++;
                }
            } catch (err) {
                debug(`${deHadith.bookId}:${deHadith.num0} ~ ${deDB[i].bookId}:${deDB[i].num0}\t${err}`);
            }
        }
        if (matchCnt > 0)
            await global.query(`INSERT INTO ${simTableName} (hadithId1, hadithId2, rating) VALUES ${inserts}`);
        deDB = null;
    }

    static findBestMatch(hadith1, hadith2) {
        if (Utils.isFalsey(hadith1.body) || Utils.isFalsey(hadith2.body))
            return {
                isMatch: false,
                bestMatch: {
                    rating: 0
                }
            }
        var source = (hadith1.body.length >= hadith2.body.length) ? hadith2.body : hadith1.body;
        source = Arabic.removeDelimeters(source);
        var target = (hadith1.body.length >= hadith2.body.length) ? hadith1.body : hadith2.body;
        target = Arabic.removeDelimeters(target);
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
        if (!match.isMatch || match.bestMatch.rating < 0.55) {
            if (Utils.isTruthy(hadith1.part) && hadith1.part === hadith2.part)
                match = {
                    isMatch: true,
                    bestMatch: {
                        rating: 0.8
                    }
                }
        }
        return match;
    }

    static async a_dbGetDisemvoweledHadiths(sql) {
        if (!sql)
            sql = `SELECT id, bookId, num0, body, back_ref, lastmod FROM hadiths ORDER BY bookId, h1, num0`;
        var rows = await global.query(sql);
        rows = rows.map((row) => {
            return Hadith.disemvoweledHadith(row);
        });
        return rows;
    }

    static async a_reinit() {
        console.info('loading library...');
        global.library = await Library.init();
        console.info('loading tags...');
        global.tags = await global.query('SELECT * FROM tags');
        console.info('done loading hadith data');
        console.info('initializing search index');
    }

    static disemvoweledHadith(hadith) {
        if (hadith.body)
            hadith.body = Arabic.disemvowelArabic(hadith.body);
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

    static translateNarrators(chain_ar) {
        chain_ar = Arabic.removeDelimeters(chain_ar);
        var chain_en = [];
        var narrators = [];
        var chains = chain_ar.split(/ ح /);
        for (var i = 0; i < chains.length; i++) {
            var ch = Arabic.toALALC(chains[i]);
            if (chains.length > 1)
                ch = '[Chain] ' + ch;
            ch = ch.replace(/(^| )(wa)?ḥaddathanāh /g, ' {$1he-narrated-it-us} ');
            ch = ch.replace(/(^| )(wa)?ḥaddathanā /g, ' {$1he-narrated-us} ');
            ch = ch.replace(/(^| )(wa)?ḥaddathanī /g, ' {$1he-narrated-me} ');
            ch = ch.replace(/(^| )(wa)?ḥaddathahā /g, ' {$1he-narrated-her} ');
            ch = ch.replace(/(^| )(wa)?ḥaddathahum /g, ' {$1he-narrated-them} ');
            ch = ch.replace(/(^| )(wa)?ḥaddathah /g, ' {$1he-narrated-him} ');
            ch = ch.replace(/(^| )(wa)?(thnā|thanā) /g, ' {$1he-narrated-us} ');
            ch = ch.replace(/(^| )(waʾ)?akhbaranāh /g, ' {$1he-told-it-us} ');
            ch = ch.replace(/(^| )(waʾ)?akhbaranā /g, ' {$1he-told-us} ');
            ch = ch.replace(/(^| )(waʾ)?akhbaranī /g, ' {$1he-told-me} ');
            ch = ch.replace(/(^| )(waʾ)?akhbarahā /g, ' {$1he-told-her} ');
            ch = ch.replace(/(^| )(waʾ)?akhbarahum /g, ' {$1he-told-them} ');
            ch = ch.replace(/(^| )(waʾ)?akhbarah /g, ' {$1he-told-him} ');
            ch = ch.replace(/(^| )(waʾ)?anbaʾanāh /g, ' {$1he-informed-it-us} ');
            ch = ch.replace(/(^| )(waʾ)?anbaʾanā /g, ' {$1he-informed-us} ');
            ch = ch.replace(/(^| )(waʾ)?anbaʾanī /g, ' {$1he-informed-me} ');
            ch = ch.replace(/(^| )(waʾ)?anbaʾahā /g, ' {$1he-informed-her} ');
            ch = ch.replace(/(^| )(waʾ)?anbaʾahum /g, ' {$1he-informed-them} ');
            ch = ch.replace(/(^| )(waʾ)?anbaʾah /g, ' {$1he-informed-him} ');
            ch = ch.replace(/(^| )(wa)?nbʾ /g, ' {$1he-informed} ');
            ch = ch.replace(/(^| )(waʾ)?anā /g, ' {$1he-informed} ');
            ch = ch.replace(/(^| )(waʾ)?nā /g, ' {$1he-informed} ');
            ch = ch.replace(/(^| )(wa)?nā /g, ' {$1he-informed} ');

            ch = ch.replace(/(^| )(wa)?ḥaddathatnāh /g, ' {$1she-narrated-it-us} ');
            ch = ch.replace(/(^| )(wa)?ḥaddathatnā /g, ' {$1she-narrated-us} ');
            ch = ch.replace(/(^| )(wa)?ḥaddathatnī /g, ' {$1she-narrated-me} ');
            ch = ch.replace(/(^| )(wa)?ḥaddathatha /g, ' {$1she-narrated-her} ');
            ch = ch.replace(/(^| )(wa)?ḥaddathath /g, ' {$1she-narrated-him} ');
            ch = ch.replace(/(^| )(waʾ)?akhbaratnāh /g, ' {$1she-told-it-us} ');
            ch = ch.replace(/(^| )(waʾ)?akhbaratnā /g, ' {$1she-told-us} ');
            ch = ch.replace(/(^| )(waʾ)?akhbaratnī /g, ' {$1she-told-me} ');
            ch = ch.replace(/(^| )(waʾ)?akhbarathā /g, ' {$1she-told-her} ');
            ch = ch.replace(/(^| )(waʾ)?akhbarath /g, ' {$1she-told-him} ');
            ch = ch.replace(/(^| )(waʾ)?anbaʾatnāh /g, ' {$1she-informed-itus} ');
            ch = ch.replace(/(^| )(waʾ)?anbaʾatnā /g, ' {$1she-informed-us} ');
            ch = ch.replace(/(^| )(waʾ)?anbaʾatnī /g, ' {$1she-informed-me} ');
            ch = ch.replace(/(^| )(waʾ)?anbaʾathā /g, ' {$1she-informed-her} ');
            ch = ch.replace(/(^| )(waʾ)?anbaʾath /g, ' {$1she-informed-him} ');

            ch = ch.replace(/(^| )(wa)?fī qawl[^ ]+ /g, ' {in-speech} ');
            ch = ch.replace(/(^| )([wf]a)?samiʿt /g, ' {I-heard} ');
            ch = ch.replace(/(^| )([wf]a)?samiʿat /g, ' {she-heard} ');
            ch = ch.replace(/(^| )([wf]a)?samiʿnā /g, ' {we-heard} ');
            ch = ch.replace(/(^| )([wf]a)?samiʿ /g, ' {he-heard} ');

            ch = ch.replace(/(^| )(waʾ)?hū /g, ' {and-he-is} ');
            ch = ch.replace(/(^| )(waʾ)?hiyā /g, ' {and-she-is} ');
            ch = ch.replace(/(^| )(waʾ)?hum /g, ' {and-they-are} ');
            ch = ch.replace(/(^| )(waʾ)?humā /g, ' {and-they-are} ');
            ch = ch.replace(/(^| )(waʾ)?ilá /g, ' {to} ');
            ch = ch.replace(/(^| )(a)?ʿalá /g, ' {on} ');
            ch = ch.replace(/(^| )(wa)?ʿa?n /g, ' {from} ');
            ch = ch.replace(/(^| )(waʾ)?annahā /g, ' {that-she} ');
            ch = ch.replace(/(^| )(waʾ)?annah /g, ' {that-he} ');
            ch = ch.replace(/(^| )(waʾ)?an+ /g, ' {that} ');

            ch = ch.replace(/(^| )([wf]a)?qālat\b/g, ' {she-said} ');
            ch = ch.replace(/(^| )([wf]a)?qālā /g, ' {both-said} ');
            ch = ch.replace(/(^| )([wf]a)?qāl\b/g, ' {he-said} ');
            ch = ch.replace(/(^| )([wf]a)?qult\b/g, ' {I-said} ');
            ch = ch.replace(/(^| )([wf]a)?yaqūl\b/g, ' {he-says} ');
            ch = ch.replace(/(^| )([wf]a)?taqūl\b/g, ' {she-says} ');

            ch = ch.replace(/{ /g, '{');
            ch = ch.replace(/ kilāhumā /g, ' {both} ');
            ch = ch.replace(/ wa/, ' and ');
            ch = ch.replace(/ and (qqāṣ|kīʿ)/, ' wa$1');
            ch = ch.replace(/(^| )(wa?)?naḥwah/g, ' {similar-to-it} ');
            ch = ch.replace(/(^| )(wa?)?mithlah/g, ' {similar-to-it} ');

            var matches = ch.matchAll(/\}(.+?)(\{|$)/g);
            var narr = [];
            for (var match of matches) {
                if (!match[1].match(/^\s+$/)) {
                    var name = match[1].trim();
                    name = name.replace(/[\ufdfa\u0610-\u0613]/g, '');
                    name = titleCaseName(match[1].trim());
                    name = name.replace(/^Jadd[uai]hā$/ig, 'her father');
                    name = name.replace(/^Jadd[uai]h$/ig, 'his father');
                    name = name.replace(/^Jadd[uaī]$/ig, 'my father');
                    name = name.replace(/^Ab[ūāī]hā$/ig, 'her father');
                    name = name.replace(/^Ab[ūāī]h$/ig, 'his father');
                    name = name.replace(/^Ab[ūī]$/ig, 'my father');
                    name = name.replace(/^Umm[uai]hā$/ig, 'her mother');
                    name = name.replace(/^Umm[uai]h$/ig, 'his mother');
                    name = name.replace(/^Ummī$/ig, 'my mother');
                    name = name.replace(/^ʿAmm[ua]hā$/ig, 'her uncle');
                    name = name.replace(/^ʿAmm[ua]h$/ig, 'his uncle');
                    name = name.replace(/^ʿAmmī$/ig, 'my uncle');
                    name = name.replace(/^Khāl[uia]hā$/ig, 'her uncle');
                    name = name.replace(/^ʿKhāl[ua]h$/ig, 'his uncle');
                    name = name.replace(/^ʿKhālī$/ig, 'my uncle');
                    name = name.replace(/^ʿAmmat[uia]hā$/ig, 'her aunt');
                    name = name.replace(/^ʿAmmat[uia]h$/ig, 'his aunt');
                    name = name.replace(/^ʿAmmatī$/ig, 'my aunt');
                    name = name.replace(/^Khālat[uia]hā$/ig, 'her uncle');
                    name = name.replace(/^ʿKhālat[ua]h$/ig, 'his uncle');
                    name = name.replace(/^ʿKhālatī$/ig, 'my uncle');
                    name = name.replace(/Um+ al-Muʾminīn/, '');
                    name = name.replace(/Zawj al-Nabī$/, '');
                    name = name.replace(/Rajulān/g, 'two men');
                    name = name.replace(/Rajul/g, 'a man');
                    name = name.replace(/Mawlá/g, 'a freed slave of');
                    name = name.replace(/Jār/g, 'a neighbor');
                    name = name.replace(/Baʿḍ Aṣḥāb[ui]h/g, 'some companions');
                    name = name.replace(/(Yaʿnī|(And )?Hū)/, ' / ');
                    narr.push(name.trim());
                    ch = ch.replace(match[1], ` ${name} `);
                }
            }

            for (var r = 0; r < 3; r++) {
                ch = ch.replace(/{(\w+?)-narrated-(\w+?)}(.+?)({|,|$)/g, '; $3 narrated to $2; $4');
                ch = ch.replace(/{(\w+?)-narrated-it-(\w+?)}(.+?)({|,|$)/g, '; $3 narrated it to $2; $4');
            }
            for (r = 0; r < 3; r++) {
                ch = ch.replace(/{(\w+?)-told-(\w+?)}(.+?)({|,|$)/g, '; $3 told $2; $4');
                ch = ch.replace(/{(\w+?)-told-it-(\w+?)}(.+?)({|,|$)/g, '; $3 told $2 about it; $4');
            }
            for (r = 0; r < 3; r++) {
                ch = ch.replace(/{(\w+?)-informed-(\w+?)}(.+?)({|,|$)/g, '; $3 informed $2; $4');
                ch = ch.replace(/{(\w+?)-informed-it-(\w+?)}(.+?)({|,|$)/g, '; $3 informed $2 about it; $4');
            }
            for (r = 0; r < 3; r++) {
                ch = ch.replace(/{(\w+?)-said}(.+?)({|,|$)/g, 'and $2 said $3');
                ch = ch.replace(/{(\w+?)-heard}(.+?)({|,|$)/g, ' $2 heard $3');
            }
            ch = ch.replace(/{from}/g, '; from ');
            ch = ch.replace(/{that}/g, ' that ');
            ch = ch.replace(/{that-(\w+?)}/g, 'that $1 ');
            ch = ch.replace(/{on}/g, ' on ');
            ch = ch.replace(/{to}/g, ' to ');
            ch = ch.replace(/{both}/g, ' both ');
            ch = ch.replace(/Ab[ūī]h/g, 'his father');
            ch = ch.replace(/Ab[ūī]/g, 'my father');
            ch = ch.replace(/\s+/g, ' ');
            ch = ch.replace(/ ;/g, ';');
            ch = ch.replace(/;+/g, ';');
            ch = ch.replace(/^; /, '');
            chain_en.push(ch.trim());
            narrators.push(narr);
        }
        return {
            chain_en: chain_en,
            narrators: narrators
        };
    }

    static parseNarrators(chain_ar) {
        chain_ar = Arabic.removeDelimeters(chain_ar);
        chain_ar = Arabic.normalizeArabicDiacritics(chain_ar);
        var narrators = [];
        var chains = chain_ar.split(/ ح /);
        for (var i = 0; i < chains.length; i++) {
            var ch = chain_ar;
            if (i > 1)
                ch = ' (الإسناد) ' + ch;
            ch = ch.replace(/(^| )(و\u064e)?حَدَّثَنَاهُ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?حَدَّثَنَا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?حَدَّثَنِي/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?حَدَّثَهَا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?حَدَّثَهُمْ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?حَدَّثَهُ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?ثَنَا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?ثنا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَخْبَرَنَاهُ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَخْبَرَنَا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَخْبَرَنِي/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَخْبَرَهَا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَخْبَرَهُمْ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَخْبَرَهُ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَنَاهُ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَنَا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَنِي/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَهَا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَهُمْ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَهُ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أنبأ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَنَا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أنا/g, ' {} ');

            ch = ch.replace(/(^| )(و\u064e)?حَدَّثَتْنَاهُ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?حَدَّثَتْنَا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?حَدَّثَتْنِي/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?حَدَّثَتْهَا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?حَدَّثَتْهُ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَخْبَرَتْنَاهُ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَخْبَرَتْنَا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَخْبَرَتْنِي/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَخْبَرَتْهَا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَخْبَتْرَهُ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَتْنَاهُ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَتْنَا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَتْنِي/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَتْهَا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَتْهُ/g, ' {} ');

            ch = ch.replace(/(^| )(و\u064e)?سَمِعْتُ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?سَمِعْنَا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?سَمِعَتْ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?سَمِعَ/g, ' {} ');

            ch = ch.replace(/(^| )(و\u064e)?إِلَى/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?عَلَى/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?عَنْهُمَا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?عَنْهُ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?عَنْهَا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?عَنْ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?عَنِ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?عَن/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَنَّهُمَا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَنَّهُ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَنَّهَا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَنَّ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?أَنْ/g, ' {} ');

            ch = ch.replace(/(^| )([وف]\u064e)?قَالَتْ/g, ' {} ');
            ch = ch.replace(/(^| )([وف]\u064e)?قَالَا/g, ' {} ');
            ch = ch.replace(/(^| )([وف]\u064e)?قَالَ/g, ' {} ');
            ch = ch.replace(/(^| )([وف]\u064e)?قُلْتُ/g, ' {} ');
            ch = ch.replace(/(^| )([وف]\u064e)?يَقُولُ/g, ' {} ');
            ch = ch.replace(/(^| )([وف]\u064e)?تَقُولُ/g, ' {} ');

            ch = ch.replace(/(^| )(و\u064e)?كِلَاهُمَا/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?نَحْوَهُ/g, ' {} ');
            ch = ch.replace(/(^| )(و\u064e)?مِثْلَهُ/g, ' {} ');

            ch = ch.replace(/ +/g, ' ');

            var matches = ch.matchAll(/\}(.+?)(\{|$)/g);
            var narr = [];
            for (var match of matches) {
                if (!match[1].match(/^\s+$/)) {
                    var name = match[1].trim();
                    name = name.replace(/[\ufdfa\u0610-\u0613]/g, '');
                    narr.push(name.trim());
                }
            }
            narrators.push(narr);
        }

        return narrators;
    }

    static splitHadithText(hadithText) {
        try {
            hadithText.text = Utils.emptyIfNull(hadithText.text);
            hadithText.text = Arabic.removeDelimeters(hadithText.text).trim();
            hadithText.text = hadithText.text.replace(/\s+/g, ' ').trim();
            hadithText.text = Arabic.normalizeArabicDiacritics(hadithText.text);
            var textMarked = Utils.emptyIfNull(hadithText.text);
            textMarked = Arabic.removeArabicDiacritics(textMarked);
            var bodyMarked = '';

            textMarked = textMarked.replaceAll('صلى الله عليه وسلم', 'ﷺ');
            textMarked = textMarked.replaceAll('صلى الله تعالى عليه وسلم', 'ﷺ');
            textMarked = textMarked.replaceAll('رض[يى] الله عنه(ا|ما|م)?', '');

            textMarked = textMarked.replace(/[وف]?(حدثنا|حدثني|حدثناه|حدثه|ثنا|يحدث) /g, '~ ');
            textMarked = textMarked.replace(/[وف]?(أخبرنا|أخبرناه|أخبرني|أخبره|يخبر) /g, '~ ');
            textMarked = textMarked.replace(/[وف]?(أنبأنا|أنبأناه|أنبأني|أنبأه|أنبأ|أنا) /g, '~ ');
            textMarked = textMarked.replace(/[وف]?(أسمعت|أسمعنا|أسمعناه|أسمع) /g, '~ ');
            textMarked = textMarked.replace(/[وف]?(سمعت|سمعنا|سمعناه|سمع) /g, '~ ');
            textMarked = textMarked.replace(/[وف]?(رواه|أراه) /g, '~ ');
            textMarked = textMarked.replace(/(عن) /g, '~ ');
            textMarked = textMarked.replace(/(يبلغ به) /g, '~~ ');
            textMarked = textMarked.replace(/(أنه|أن|أنها) /g, '~ ');
            textMarked = textMarked.replace(/(قال|قالت|قالا|يقول|تقول) /g, '~ ');
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
                    if (chainDelims[j].match(/(النبي|رسول|في|كنت|كان|كنا|قدمت|سمعت|خرج|خرجت|قدم|دخلت|دخل) /)) {
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
                debug('ERROR on: ' + hadithText.bookId + ' ' + hadithText.num + '\n');
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
            debug(`ERROR on: ${hadithText.bookId}:${hadithText.num}: ${err}\n${err.stack}`);
        }
        return hadithText;
    }

    static async reinit() {
        debug('stubbed out');
    }

}

module.exports = Hadith;

function wordCount(s) {
    return s.split(' ').length;
}

function titleCaseName(name) {
    var words = name.split(/([ \-])/);
    for (var w = 0; w < words.length; w++) {
        var word = words[w].split('');
        var i = 0;
        if (word[0] == 'ʿ' || word[0] == 'ʾ')
            i = 1;
        if (word.length > 1)
            word[i] = word[i].toUpperCase();
        words[w] = word.join('');
    }
    name = words.join('');
    name = name.replace(/Al-/g, 'al-');
    name = name.replace(/B\./g, 'b.');
    return name;
}

