/* jslint node:true, esversion:6 */
'use strict'

const fs = require('fs');
var tsv = fs.readFileSync(process.argv[2]).toString();
console.log(tsv2json(tsv));

function tsv2json(tsv) {
	var lines = tsv.split("\n");
	var result = [];
	var headers = lines[0].split("\t");
	for (var i = 1; i < lines.length; i++) {
		var obj = {};
		var currentline = lines[i].split("\t");
		for (var j = 0; j < headers.length; j++) {
			obj[headers[j]] = currentline[j];
		}
		result.push(obj);
	}
	return JSON.stringify(result);
}