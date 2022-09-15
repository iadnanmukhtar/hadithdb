/*
 * Hadith Grades Parser for Shamela Book: https://old.shamela.ws/index.php/book/25794
 * Musnad Ahmad, Authenticated by Shaykh Arna'ūt
 * مسند أحمد ط الرسالة
 */

const fs = require('fs');

const RE_HADITH_NO_REF = /^[•*]? ?(\d+ \/ \d+|\. \. \/ \d+|\d+) - ?/;
const RE_HADITH_W_REF = /^[•*]? ?(\d+ \/ \d+|\. \. \/ \d+|\d+) - ?.+ \((\d)\) ?\.?$/;
const RE_REF = /\((\d)\) ?\.?$/;
const RE_FOOTER_REF = /^\((\d)\) (.+?)[:،,\-\.]/;
var hadiths = []
var refs = [];
var partialHadith = false;
var withinFooter = false;

var table = JSON.parse(fs.readFileSync('data/25794.json'))[0];
for (var pg = 152; pg < table.rows.length; pg++) {

	if (hadiths.length > 10) {
		console.log('ERROR: something\'s wrong. too many hadith in stack');
		break;
	}

	var lines = table.rows[pg][0].split(/\n/g);
	withinFooter = false;
	refs = [];
	for (var ln = 0; ln < lines.length; ln++) {

		var m = null;
		var line = lines[ln].trim();
		if (line.startsWith('____'))
			withinFooter = true;
		var withinPage = (ln < (lines.length - 1));
		var withinBody = !withinFooter;
		var moreBody = withinPage && withinBody && !lines[ln + 1].startsWith('____');
		var moreFooter = withinPage && withinFooter;

		if (hadiths.indexOf('8') >= 0)
			var x = 0;

		if (withinFooter) {
			// find hadith grade in footer
			m = RE_FOOTER_REF.exec(line);
			if (m && m.length >= 2) {
				if (refs.length > 0) {
					var i = refs.indexOf(m[1]);
					if (i >= 0) {
						console.log(hadiths[i] + '\t' + m[2]);
						refs.splice(i, 1);
						hadiths.splice(i, 1);

						// var hadith = hadiths[i];
						// var grade = m[2];
						// var metadata = line;
						// refs.splice(i, 1);
						// hadiths.splice(i, 1);
						// // get meta info
						// for (var j = ln + 1; j < lines.length; j++) {
						// 	if (lines[j].startsWith('('))
						// 		break;
						// 	metadata += lines[j].replaceAll('\n', ' ');
						// }
						// console.log(hadiths[i] + '\t' + m[2] + '\t' + metadata);

					}
				}
			}

		} else if (withinBody) {
			// find hadith references in body
			m = RE_HADITH_W_REF.exec(line);
			if (m && m.length >= 2) {
				if (hadiths.length > refs.length)
					refs.push(0);
				partialHadith = false;
				hadiths.push(m[1]);
				refs.push(m[2]);
			} else {
				m = RE_HADITH_NO_REF.exec(line);
				if (m && m.length >= 2) {
					if (hadiths.length > refs.length)
						refs.push(0);
					partialHadith = true;
					hadiths.push(m[1]);
				} else if (partialHadith) {
					m = RE_REF.exec(line);
					if (m && m.length >= 2) {
						if ((moreBody && lines[ln + 1].match(RE_HADITH_NO_REF)) || !moreBody) {
							if (refs.indexOf(m[1]) < 0) {
								refs.push(m[1]);
								partialHadith = false;
							}
						}
					}
				}
			}
		}

	}
	if (hadiths.length > 1) {
		// unable to find grade for hadith
		console.log(hadiths[0] + '\t' + 'Grade not found');
		hadiths.splice(0, 1);
	}

}