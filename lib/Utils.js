'use strict';

const debug = require('debug')('hadithdb:Utils');
const axios = require("axios");
const fs = require("fs/promises");
const path = require('path');
const { homedir } = require('os');

class Utils {

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
					'Authorization': `Bearer ${process.env.OPENAI_KEY}`
				}
			});
		} catch (e) {
			console.log(`OpenAI ${e.response.status} ${e.response.statusText}`);
			throw e;
		}
		return res.data.choices[0].message.content;
	}

	static async ollama(model, prompt) {
		var content = '';
		const res = await axios.post('http://localhost:11434/api/generate', JSON.stringify({
			model: model,
			prompt: prompt,
			system: "",
			template: "",
			context: [],
			options: null
		}), {
			headers: {
				'Content-Type': 'application/json'
			}
		});
		var fragments = res.data.trim().split(/\n/);
		fragments = fragments.map(f => JSON.parse(f));
		for (const fragment of fragments) {
			if (fragment.response)
				content += fragment.response;
		}
		return content;
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

	static async flushCacheContaining(s) {
		debug(`flushing cache containing '${s}'`);
		const cachePath = `${homedir}/.hadithdb/cache`;
		try {
			const fileNames = await fs.readdir(cachePath);
			for (const fileName of fileNames) {
				const filePath = path.join(cachePath, fileName);
				const stats = await fs.stat(filePath);
				if (stats.isFile()) {
					const fileContent = await fs.readFile(filePath, 'utf8');
					if (fileContent.includes(s)) {
						await fs.unlink(filePath);
						debug(`deleted file: ${filePath}`);
					}
				}
			}
			debug('cache flush complete');
		} catch (error) {
			debug('unable to flush cache:', error);
		}
	}

}


module.exports = Utils;
