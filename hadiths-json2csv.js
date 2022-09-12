const fs = require('fs');
const { format } = require('@fast-csv/format');

var ahadith = JSON.parse(fs.readFileSync('hadiths.json'));
const stream = format({ delimiter: '\t', rowDelimiter: '\n', quote: '', escape: '' });
stream.pipe(process.stdout);
var cid = 0;
var n = '';
var c = '';
for (var i = 0; i < ahadith.length; i++) {
    var h = ahadith[i];
    if (i == 4383)
        cid = cid;
    if (h.CollectionID != cid)
        c = 'Unknown';
    cid = h.CollectionID;
    var match = /^([a-zA-Z`' \-]+)(\d+ ?[a-zA-Z]?)/.exec(h.reference_en);
    if (!match || !match[1]) {
        match = /Hadith (\d+ ?[a-zA-Z]?)$/.exec(h.reference_en);
        if (!match) {
            console.log("ERROR: " + h.reference_en);
            break;
        } else {
            n = match[1];
        }
    } else {
        c = match[1];
        n = match[2];
    }
    if (h.CollectionID < 3 || h.CollectionID == 7)
        h.grade_en = 'Sahih';
    if (h.grade_en == '')
        h.grade_en = 'No Grade'
    if (h.CollectionID != 8 && h.CollectionID != 9 && h.CollectionID != 9 && h.CollectionID != 12 && h.CollectionID != 13 && h.CollectionID != 14 && h.text_ar && !h.text_ar.startsWith('باب')) {
        var t_ar = ((h.narrator_ar ? h.narrator_ar + ' ' : '') + h.text_ar).replace(/\u200f/g, '').trim();
        t_ar = t_ar.replace(/(\n+|\s{2,})/g, ' ');
        var t_en = ((h.narrator_en ? h.narrator_en + ' ' : '') + h.text_en).replace(/\u200f/g, '').trim();
        t_en = t_en.replace(/(\n+|\s{2,})/g, ' ');
        stream.write([h.CollectionID, c.trim(), n.replace(/(\d) /, '$1').trim(), h.grade_en, t_ar, t_en]);
    }
}

stream.end();
