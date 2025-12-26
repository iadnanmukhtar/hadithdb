'use strict';

const debug = require('debug')('hadithdb:Utils');
const axios = require("axios");
const fs = require("fs/promises");
const { homedir } = require('os');
const util = require('util');
const sqlite3 = require('sqlite3');
const { marked } = require('marked');

marked.setOptions({
	gfm: true,
	breaks: true
});

class Utils {

	static CACHENDX;

	static truncate(s, n, useWordBoundary, before, useHTML) {
		if (!s || s.length <= n) { return s; }
		s = s.replace(/<\/?[^>]+>/g, '');
		var ts = s.slice(0, n - 1);
		ts = useWordBoundary ? ts.slice(0, ts.lastIndexOf(" ")) : ts;
		if (before)
			return (useHTML ? '&hellip;' : '...') + ts;
		else
			return ts + (useHTML ? '&hellip;' : '...');
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
		if (s === undefined || s === null) s = '';
		return s;
	}

	static markdownToHtml(markdown) {
		markdown = Utils.emptyIfNull(markdown);
		if (markdown === '')
			return '';
		return marked.parse(markdown);
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

	static toMarkdown(results) {
		var out = '';
		for (var i = 0; i < results.length; i++) {
			out +=
`
**Hadith: ${results[i].title}**
- ~~«${results[i].body}» ([${results[0].book_shortName} ${results[0].ar.num}](https://hadithunlocked.com/${results[0].ref}) ${results[0].grade_grade})~~
> ${results[i].body_en}
`;
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

	static async openai(model, prompt) {
		if (prompt.constructor != Array)
			prompt = [prompt];
		var data = {
			model: model,
			messages: []
		};
		for (var p of prompt)
			data.messages.push({
				role: 'user',
				content: p
			});
		var res = null;
		try {
			res = await axios.post(`https://api.openai.com/v1/chat/completions`, JSON.stringify(data), {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${global.settings.openAI.key}`
				}
			});
			debug(`OpenAI ${model} ${prompt}:\n${res.data.choices[0].message.content}`);
		} catch (e) {
			debug(`OpenAI ${model} ${prompt} ${e.response.status}:\n${e.response.statusText}`);
			throw e;
		}
		return res.data.choices[0].message.content;
	}

	static replacePBUH(s) {
		s = s.replace(/[\[\(]]PBUH[\]\)]/g, ' ﷺ ');
		s = s.replace(/[\[\(]SAW[\]\)]/g, ' ﷺ ');
		s = s.replace(/[\[\(]peace be upon him[\]\)]/g, ' ﷺ ');
		s = s.replace(/peace be upon him/g, ' ﷺ ');
		s = s.replace(/[\[\(]pbuh[\]\)]/g, ' ﷺ ');
		s = s.replace(/, peace be upon him, /g, ' ﷺ ');
		s = s.replace(/[\[\(]ﷺ[\]\)]/g, ' ﷺ ');
		s = s.replace(/صلى الله عليه وسلم/g, ' ﷺ ');
		return s;
	}

	static reqToFilename(req) {
		var name = req.url.replace(/\//g, '_');
		name = name.replace(/\?o=0/g, '');
		return name;
	}

	static async setupCacheIndex() {
		if (Utils.CACHENDX === undefined) {
			debug(`initializing cache index`);
			const db = new sqlite3.Database(`${homedir}/.hadithdb/cachendx.db`);
			db.runAsync = util.promisify(db.run.bind(db));
			db.allAsync = util.promisify(db.all.bind(db));
			Utils.CACHENDX = db;
			await db.runAsync('CREATE TABLE IF NOT EXISTS cachendx (id VARCHAR(30) primary key, filename VARCHAR(255));');
		}
		return Utils.CACHENDX;
	}

	static async indexCachedItem(keys, value) {
		const cachedb = await Utils.setupCacheIndex();
		for (const key of keys)
			await cachedb.runAsync(`INSERT OR IGNORE INTO cachendx(id, filename) VALUES (?, ?);`, [key, value]);
	}

	static async flushCachedFile(filename) {
		try {
			const stats = await fs.stat(filename);
			if (stats.isFile()) {
				const fileContent = await fs.readFile(filename, 'utf8');
				await fs.unlink(filename);
				debug(`deleted file: ${filename}`);
			}
		} catch (error) {
			debug('unable to flush cache:', error);
		}
	}

	static async flushCacheContaining(key) {
		const cachedb = await Utils.setupCacheIndex();
		debug(`flushing cache containing '${key}'`);
		try {
			var rows = await cachedb.allAsync(`SELECT DISTINCT filename FROM cachendx WHERE id=?;`, [key]);
			if (rows) {
				for (const row of rows)
					await Utils.flushCachedFile(row.filename);
				await cachedb.runAsync(`DELETE FROM cachendx WHERE id=?;`, [key]);
				debug('cache flush complete');
			}
		} catch (error) {
			debug('unable to flush cache:', error);
		}
	}

}

module.exports = Utils;
