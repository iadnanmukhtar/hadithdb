/* jslint node:true, esversion:8 */
'use strict';

const Hadith = require('../../lib/Hadith');

exports.postSave = function (req, res, args, next) {
	Hadith.reinit();
	next();
};