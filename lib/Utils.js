/* jslint node:true, esversion:9 */
'use strict';

class Utils {

	static truncate(s, n, useWordBoundary, before, useHTML) {
		if (!s || s.length <= n) { return s; }
		s = s.replace(/<\/?[^>]+>/g, '');
		var ts = s.slice(0, n - 1);
		ts = useWordBoundary ? ts.slice(0, ts.lastIndexOf(" ")) : ts;
		if (before)
			return (useHTML ? '&hellip;':'...') + ts;
		else
			return ts + (useHTML ? '&hellip;':'...');
	}

	static isFalsey(o) {
		return o === undefined || o === null || o === false || Utils.trimToEmpty(o) === '';
	}

	static isTruthy(o) {
		return !Utils.isFalsey(o);
	}


	static wordCount(s) {
		return s.split(' ').length;
	}

	static trimToEmpty(s) {
		if (!s) s = '';
		if (typeof s === 'string')
			s = s.trim();
		return s;
	}

	static emptyIfNull(s) {
		if (!s) s = '';
		return s;
	}

	static escSQL(s) {
		if (s) {
			s = s.trim().replace(/(['"])/g, '\\$1');
			s = s.replace(/\n/, '\\n');
		}
		return s;
	}

	static reverse(s) {
		return s.split("").reverse().join("");
	}

	static toTSV(arr, keyNames) {
		var out = '';
		if (keyNames) {
			for (var i = 0; i < keyNames.length; i++) {
				out += keyNames[i];
				if (i < keyNames.length - 1)
					out += '\t';
			}
		} else
			keyNames = Object.keys(arr[0]);
		out += '\n';
		for (i = 0; i < arr.length; i++) {
			for (var j = 0; j < keyNames.length; j++) {
				var val = arr[i][keyNames[j]];
				if (!val) val = 'null';
				out += val.toString().replace(/[\r\n]/g, ' ');
				if (j < keyNames.length - 1)
					out += '\t';
			}
			out += '\n';
		}
		return out;
	}

	static lettersToNumber(s) {
		s = s.toUpperCase();
		var out = 0, len = s.length;
		for (var pos = 0; pos < len; pos++) {
			out += (s.charCodeAt(pos) - 64) * Math.pow(26, len - pos - 1);
		}
		return out;
	}

	static sql(s) {
		if (s)
			return s.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
		return s;
	}

	static regexExtract(s, re) {
		var arr = re.exec(s);
		if (arr)
			return arr[1];
		return null;
	}

	static sleep(n) {
		Utils.msleep(n * 1000);
	}

	static msleep(n) {
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, n);
	}

}


module.exports = Utils;
