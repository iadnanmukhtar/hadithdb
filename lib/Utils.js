/* jslint node:true, esversion:8 */
'use strict';


class Utils {

	static truncate(s, n, useWordBoundary, before) {
		if (!s || s.length <= n) { return s; }
		var ts = s.slice(0, n - 1);
		ts = useWordBoundary ? ts.slice(0, ts.lastIndexOf(" ")) : ts;
		if (before)
			return '&hellip;' + ts;
		else
			return ts + '&hellip;';
	}

	static wordCount(s) {
		return s.split(' ').length;
	}

	static emptyIfNull(s) {
		if (!s) s = '';
		return s;
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
		return s.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
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
