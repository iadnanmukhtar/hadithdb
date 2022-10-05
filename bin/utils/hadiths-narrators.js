/* jslint node:true, esversion:6 */
'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');
const AdmZip = require("adm-zip");

const dbFile = __dirname + '/../../data/hadiths.db';
const readDb = new Database(dbFile);
const writeDb = new Database(readDb.serialize());
const updateStmt = writeDb.prepare('UPDATE hadiths SET body_en=?,text_en=?,text=?,chain=?,body=? ' +
    'WHERE bookId=? AND num=? AND chain_en IS NOT null');

console.log('Processing: split hadith chain and body');
var rows = readDb.prepare('SELECT * from hadiths').all();
for (var row of rows) {
    if (row.text_en) {
        if (row.text_en.startsWith('\"'))
            row.text_en = row.text_en.replace(/^"/, "").replace(/"$/, "");
        row.text_en = row.text_en.replace(/\"{2,}/g, "\"");
    } else
        row.text_en = '';

    // normalize
    if (row.text) {
        row.text = row.text.replace(/[\:\"\'،۔ـ\-\.\,]/g, '');
        row.text = row.text.replaceAll('رضى الله عنها', '');
        row.text = row.text.replaceAll('رضى الله عنهما', '');
        row.text = row.text.replaceAll('رضى الله عنهم', '');
        row.text = row.text.replaceAll('رضى الله عنه', '');
        row.text = row.text.replaceAll('صلى الله عليه وسلم', 'ﷺ');
        // FIXME: Replace صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ with diactrics also
        row.text = row.text.replace(/\s+/g, ' ').trim();
    }
    var textMarked = row.text + '';
    var bodyMarked = '';
    textMarked = textMarked.replace(/[ؐ-ًؕ-ٖٓ-ٟۖ-ٰٰۭ]/g, '');
    textMarked = textMarked.replace(/و?(حدثنا|حدثني|حدثناه|حدثه|ثنا) /g, '~ ');
    textMarked = textMarked.replace(/و?(أخبرنا|أخبرناه|أخبرني|أخبره) /g, '~ ');
    textMarked = textMarked.replace(/و?(أنبأنا|أنبأناه|أنبأني|أنبأه) /g, '~ ');
    textMarked = textMarked.replace(/و?(سمعت|سمعنا|سمعناه|سمع) /g, '~ ');
    textMarked = textMarked.replace(/(عن|عنه|عنها) /g, '~ ');
    textMarked = textMarked.replace(/(يبلغ به) /g, '~~ ');
    textMarked = textMarked.replace(/(أنه|أن|أنها) /g, '~ ');
    textMarked = textMarked.replace(/(قال|قالت) /g, '~ ');
    textMarked = textMarked.replace(/\s+/g, ' ').trim();
    // extract body
    var chainDelims = textMarked.split(/~/);
    if (chainDelims) {
        var chainToksWordCount = [];
        for (var tok of chainDelims)
            chainToksWordCount.push(wordCount(tok));
        for (var j = 0; j < chainDelims.length; j++) {
            if (chainDelims[j].match(/(نبي|رسول)/)) {
                bodyMarked = chainDelims.slice(j).join('~ ');
                break;
            } else if (chainToksWordCount[j] > 7 && !chainDelims[j].match(/ (بن|ابن) /)) {
                bodyMarked = chainDelims.slice(j).join('~ ');
                break;
            }
        }
        if (bodyMarked == '')
            bodyMarked = chainDelims[chainDelims.length - 1];
    }
    if (bodyMarked == null) {
        process.stdout.write('ERROR on: ' + row.bookId + ' ' + row.num + '\n');
        return;
    }
    bodyMarked = bodyMarked.replace(/\s+/g, ' ').trim();

    // extract chain and body
    var textToks = row.text.split(/ /);
    var textMarkedToks = textMarked.split(/ /);
    var bodyMarkedToks = bodyMarked.split(/ /);
    row.body = '';
    if (!textToks || !bodyMarkedToks || textToks.length == bodyMarkedToks.length)
        row.body = row.text;
    else {
        var diff = textToks.length - bodyMarkedToks.length;
        for (var j = (diff - 1); j >= 0; j--) {
            if (textMarkedToks[j].endsWith('~'))
                diff--;
            else
                break;
        }
        row.chain = textToks.slice(0, diff).join(' ').trim();
        row.body = textToks.slice(diff).join(' ').trim();
    }

    // stack chain and body updates
    console.log(`Processed hadith ${row.bookId}:${row.num}`);
    updateStmt.run([row.text_en, row.text_en, row.text, row.chain, row.body, row.bookId, row.num]);

}
readDb.close();

console.log('Compressing database');
var zip = new AdmZip();
zip.addFile('hadiths.db', writeDb.serialize(), 'File');
zip.writeZip(dbFile + '.zip');

function wordCount(s) {
    return s.split(' ').length;
}
