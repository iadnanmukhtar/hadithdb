const fs = require('fs');
const lines = require('line-reader');
const { format } = require('@fast-csv/format');

lines.eachLine('hadiths-final.csv', function (line, last) {

    var toks = line.split(/\t/);
    if (!toks) return;
    var cid = toks[0];
    var c = toks[1]
    var n = toks[2];
    var g = toks[3];
    var h_ar = toks[4];
    var h_en = toks[5];
    var m = '';
    var ch = '';

    // normalize
    h_ar = h_ar.replace(/[\:\"\'،۔ـ\-\.\,]/g, '');
    h_ar = h_ar.replaceAll('رضى الله عنها', '');
    h_ar = h_ar.replaceAll('رضى الله عنهما', '');
    h_ar = h_ar.replaceAll('رضى الله عنهم', '');
    h_ar = h_ar.replaceAll('رضى الله عنه', '');
    h_ar = h_ar.replaceAll('صلى الله عليه وسلم', 'ﷺ');
    h_ar = h_ar.replace(/\s+/g, ' ').trim();
    var h2 = h_ar + '';
    var m2 = '';
    h2 = h2.replace(/[ؐ-ًؕ-ٖٓ-ٟۖ-ٰٰۭ]/g, '');
    h2 = h2.replace(/(حدثنا|حدثني|حدثناه|حدثه) /g, '~ ');
    h2 = h2.replace(/(أخبرنا|أخبرناه|أخبرني|أخبره) /g, '~ ');
    //h2 = h2.replace(/(سمعت|سمعنا|سمعناه|سمع) (?!((النبي|نبي|الرسول|رسول)|[^\s]+ (النبي|نبي|الرسول|رسول)))/g, '~ ');
    h2 = h2.replace(/(سمعت|سمعنا|سمعناه|سمع) /g, '~ ');
    h2 = h2.replace(/(عن|عنه|عنها) /g, '~ ');
    h2 = h2.replace(/(أنه|أن|أنها) /g, '~ ');
    h2 = h2.replace(/(قال|قالت) /g, '~ ');
    h2 = h2.replace(/\s+/g, ' ').trim();
    // extract body
    var narr_toks = h2.split(/~/);
    if (narr_toks) {
        var h2_tokslen = [];
        narr_toks.forEach(tok => {
            h2_tokslen.push(wordCount(tok));
        });
        for (i = 0; i < narr_toks.length; i++) {
            if (narr_toks[i].match(/(نبي|رسول)/)) {
                m2 = narr_toks.slice(i).join('~ ');
                break;
            } else if (h2_tokslen[i] > 7 && !narr_toks[i].match(/ (بن|ابن) /)) {
                m2 = narr_toks.slice(i).join('~ ');
                break;
            }
        }
        if (m2 == '')
            m2 = narr_toks[narr_toks.length - 1];
    }
    if (!m2) {
        process.stdout.write('ERROR on: ' + c + ' ' + n + '\n');
        return;
    }
    m2 = m2.replace(/\s+/g, ' ').trim();

    // extract chain and body
    var h_toks = h_ar.split(/ /);
    var h2_toks = h2.split(/ /);
    var m2_toks = m2.split(/ /);
    var m = '';
    if (!h_toks || !m2_toks || h_toks.length == m2_toks.length)
        m = h_ar;
    else {
        var diff = h_toks.length - m2_toks.length;
        for (i = (diff - 1); i >= 0; i--) {
            if (h2_toks[i].endsWith('~'))
                diff--;
            else
                break;
        }
        ch = h_toks.slice(0, diff).join(' ').trim();
        m = h_toks.slice(diff).join(' ').trim();
    }

    // write
    process.stdout.write(cid + '\t' + n + '\t' + ch + '\t' + m + '\n');
});

function wordCount(s) {
    return s.split(' ').length;
}
