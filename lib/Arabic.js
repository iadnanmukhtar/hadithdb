/* jslint node:true, esversion:9 */
'use strict';

const arabicStem = require('arabic-stem');
const jsastem = require('../lib/jsastem');

const RE_DELIMETERS_NO_SPACE = /[^ \p{L}\p{M}\d]+/gu;
const RE_DELIMETERS_SPACE = /[^\p{L}\p{M}\d]+/gu;
const RE_TASHKIL = /[\u0600-\u061f\u064b-\u0652\u0657-\u065f\u066b-\u066d\u06d6-\u06ed]/g;
const MAX_STEM_SIZE = 3;

class Arabic {

	static isArabic(s) {
		if (s)
			return /[\u0600-\u06ff]/.test(s);
		return false;
	}

	static normalize(s, keepHamzah) {
		if (s) {
			s = Arabic.removeArabicDiacritics(s);
			s = s.replace(/ـ/g, '');
			s = s.replace(/\u0675/g, 'ءا');
			s = s.replace(/\u0676/g, 'ءو');
			s = s.replace(/\u0678/g, 'ءى');
			s = s.replace(/ٱ/g, 'ا');
			s = s.replace(/ى/g, 'ي');
			if (keepHamzah) {
				s = s.replace(/([آ]|ا\u0653)/g, 'ءا');
				s = s.replace(/[أإؤئ]/g, 'ء');
				s = s.replace(/[اوي][\u0654\u0655\u0674]/g, 'ء');
			} else {
				s = s.replace(/ء/g, '');
				s = s.replace(/([أإ]|ا[\u0653\u0654\u0655\u0674])/g, 'ا');
				s = s.replace(/(ؤ|و[\u0653\u0654\u0655\u0674])/g, 'و');
				s = s.replace(/(ئ|ي[\u0653\u0654\u0655\u0674])/g, 'ي');
			}
		}
		return s;
	}

	static replaceDagger(s) {
		if (s) {
			s = s.replace(/\u0670/, 'ا').replace(/ا+/, 'ا');
			s = s.replace(/\u0656/, 'ي');
		}
		return s;
	}

	static removeArabicDiacritics(s) {
		if (s) {
			s = s.replace(RE_TASHKIL, '');
		}
		return s;
	}

	static tokenize(s) {
		if (s)
			return s.split(RE_DELIMETERS_SPACE);
		return [];
	}

	static removeDelimeters(s) {
		if (s)
			s = s.replace(RE_DELIMETERS_NO_SPACE, '');
		return s;
	}

	static removeDelimetersInclSpace(s) {
		if (s)
			s = s.replace(RE_DELIMETERS_SPACE, '');
		return s;
	}

	static normalizeArabicDiacritics(s) {
		s = s.replace(/([\u064e-\u0650])\u0651/g, '\u0651$1');
		return s;
	}

	static disemvowelArabic(s) {
        if (s) {
            s = s.replace(/ًا/gu, '');
            s = s.replace(/[^\p{L} ]/gu, '');
            s = s.replace(/[\u0621\u0671]/gu, 'ا');
            s = s.replace(/[\u0623-\u0626\u0672-\u0678]/gu, 'ء');
            s = s.replace(/[^\u0621-\u064a ]/gu, '');
            if (s.bookId > 0) {
                s = s.replace(/رسول الله /gu, '');
                s = s.replace(/(النبي |نبي)/gu, '');
                s = s.replace(/رضي الله عن.+? /gu, '');
                s = s.replace(/صل الله علي.+? /gu, '');
            }
            s = s.replace(/( |^)ال([^\s]{3,})( |$)/gu, '$1$2$3');
            s = s.replace(/( |^)([^\s]{2,})(ات|ان|ين|ون)( |$)/gu, '$1$2$4');
            s = s.replace(/[ايوى]/g, '');
            s = s.replace(/[ة]/g, 'ت');
            s = s.replace(/[ؤئأإ]/g, 'ء');
            s = s.replace(/ +/gu, ' ');
            s = s.trim();
		}
		return s;
	}

	static toArabicDigits(s) {
		s = s.replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
		return s;
	}

	static stemArabicWord(s) {
		var stems = [];
		if (s) {
			try {
				var _stems = new arabicStem().stem(s);
				if (_stems && _stems.stem) stems.push(..._stems.stem);
				if (_stems && _stems.normalized && stems.indexOf(_stems.normalized) < 0)
					stems.push(_stems.normalized);
			} catch (err) {
				// console.error(err);
			}
			try {
				var stem = jsastem(s);
				if (stems.indexOf(stem) < 0) stems.push(stem);
			} catch (err) {
				// console.error(err);
			}
			var p1 = '';
			var s1 = s;
			while (s1.length > MAX_STEM_SIZE) {
				s1 = this.stripArabicPrefix(s1);
				if (p1 != s1) {
					stems.push(s1);
					p1 = s1;
					var p2 = '';
					var s2 = s1;
					while (s2.length > MAX_STEM_SIZE) {
						s2 = this.stripArabicSuffix(s2);
						if (p2 != s2) {
							stems.push(s2);
							p2 = s2;
						} else
							break;
					}
				} else
					break;
			}
			s1 = s;
			while (s1.length > MAX_STEM_SIZE) {
				s1 = Arabic.stripArabicPrefix(s1);
				if (p1 != s1) {
					stems.push(s1);
					p1 = s1;
				} else
					break;
			}
			s1 = s;
			while (s1.length > MAX_STEM_SIZE) {
				s1 = Arabic.stripArabicSuffix(s1);
				if (p1 != s1) {
					stems.push(s1);
					p1 = s1;
				} else
					break;
			}
		}
		stems = [...new Set(stems)];
		return stems;
	}

	static stripArabicPrefix(s) {
		if (s && s.length > MAX_STEM_SIZE)
			s = s.replace(/^(ا|ال|ف|ب|و|س|ت|ن|ء|أ|إ|ي|ك|ل)/, '');
		return s;
	}

	static stripArabicSuffix(s) {
		if (s && s.length > MAX_STEM_SIZE)
			s = s.replace(/(ة|ه|هم|هما|كم|ك|كما|تم|ن|نا|ي|تما|وا|ا|ون|ين|و)$/, '');
		return s;
	}

	static toALALC(s) {
		var result = '';
		// clean string
		s = s.replace(RE_DELIMETERS_SPACE, ' ').replace(/\s+/g, ' ').trim();
		var words = s.split(/\s+/);
		for (var w of words) {
			w = w.replace(/([\u064e\u064f\u0650])\u0651/, '\u0651$1');
			w = w.replace(/ع/g, 'ʿ');
			w = w.replace(/[ءأإؤئ]/g, 'ʾ');
			w = w.replace(/^ʾ/g, '');
			w = w.replace(/^(ال.)\u0651/, '$1');
			w = w.replace(/^ال/, 'al-');
			w = w.replace(/^ب\u0650?ال/, 'bi-al-');
			w = w.replace(/^ل\u0650?ال/, 'lil-');
			w = w.replace(/^و\u064e?ال/, 'wa-al-');
			w = w.replace(/^ف\u064e?ال/, 'wa-al-');
			w = w.replace(/(\u064bا$|ا\u064b$)/g, '');
			w = w.replace(/(\u064eى$|ى$)/g, 'á');
			w = w.replace(/\u064d$/g, '');
			w = w.replace(/\u064c$/g, '');
			w = w.replace(/([\u064b-\u065f]+)$/, '');
			w = w.replace(/\u064eو/g, 'aw');
			w = w.replace(/\u064eي/g, 'ay');
			w = w.replace(/ي([\u064e\u064f\u0650])/, 'y$1');
			w = w.replace(/و([\u064e\u064f\u0650])/, 'w$1');
			w = w.replace(/ي\u0651/, 'yy');
			w = w.replace(/و\u0651/, 'ww');
			w = w.replace(/و[\u064e\u064f\u0650]/, 'w');
			w = w.replace(/(آ|\u064e?ا|\u064e?\u0670)/g, 'ā');
			w = w.replace(/(\u0650ي|\u0650?\u0656)/g, 'ī');
			w = w.replace(/(\u064fو|\u0657)/g, 'ū');
			w = w.replace(/\u064e/g, 'a');
			w = w.replace(/\u0650/g, 'i');
			w = w.replace(/\u064f/g, 'u');
			w = w.replace(/\u0652/g, '');
			w = w.replace(/ب/g, 'b');
			w = w.replace(/ت/g, 't');
			w = w.replace(/ث/g, 'th');
			w = w.replace(/ج/g, 'j');
			w = w.replace(/ح/g, 'ḥ');
			w = w.replace(/خ/g, 'kh');
			w = w.replace(/د/g, 'd');
			w = w.replace(/ذ/g, 'dh');
			w = w.replace(/ر/g, 'r');
			w = w.replace(/ز/g, 'z');
			w = w.replace(/س/g, 's');
			w = w.replace(/ش/g, 'sh');
			w = w.replace(/ص/g, 'ṣ');
			w = w.replace(/ض/g, 'ḍ');
			w = w.replace(/ط/g, 'ṭ');
			w = w.replace(/ظ/g, 'ẓ');
			w = w.replace(/غ/g, 'gh');
			w = w.replace(/ف/g, 'f');
			w = w.replace(/ق/g, 'q');
			w = w.replace(/ك/g, 'k');
			w = w.replace(/ل/g, 'l');
			w = w.replace(/م/g, 'm');
			w = w.replace(/ن/g, 'n');
			w = w.replace(/و/g, 'w');
			w = w.replace(/(ه|ة)/g, 'h');
			w = w.replace(/ي/g, 'y');
			w = w.replace(/(.)\u0651/g, '$1$1');
			w = w.replace('bn', 'b.');
			w = w.replace('bnt', 'b.');
			w = w.replace('al-lah', 'allāh');
			w = w.replace('al-ll', 'al-l');
			w = w.replace(/(iī|īi|ī+)/g, 'ī');
			w = w.replace(/(aā|āa|ā+)/g, 'ā');
			w = w.replace(/(uū|ūu|ū+)/g, 'ū');
			w = w.replace(/a+/g, 'a');
			w = w.replace(/i+/g, 'i');
			w = w.replace(/u+/g, 'u');
			result += w + ' ';
		}
		result = result.replace(/[\u0600-\u06ff]/g, '');
		result = result.replace(/ia/g, 'iya');
		result = result.replace(/āū/g, 'āwū');
		result = result.replace(/īa/g, 'īwa');
		result = result.replace(/ūa/g, 'ūwa');
		result = result.replace(/ al-lh/g, ' allāh');
		result = result.replace(/ (ʿabd|ʿubayd)\s+allāh/g, ' $1ullāh ');
		result = result.replace(/ (ʿabd|ʿubayd)\s+allāh/g, ' $1ullāh ');
		result = result.replace(/ (ʿamat?)\s+allāh/g, ' $1ullāh ');
		result = result.replace(/ ʿam(rw|riw|rū|ruw)/g, ' ʿamr');
		result = result.replace(/ṣlá allāh ʿlyh wslm/g, ' \ufdfa ');
		result = result.replace(/ṣlá allāh tʿālá ʿlyh wslm/g, ' \ufdfa ');
		result = result.replace(/ṣallá allāh ʿalayh wasallam/g, ' \ufdfa ');
		result = result.replace(/ṣallá allāh taʿālá ʿalayh wasallam/g, ' \ufdfa ');
		result = result.replace(/ (raḥimah(ā|um)?) allāh/g, ' \u0612 ');
		result = result.replace(/ raḍī allāh ʿanh(ā|um)?/g, ' \u0613 ');
		result = result.replace(/ āb. /g, ' ibn ');
		result = result.replace(/ ab[īā] /g, ' abū ');
		result = result.replace(/-ʾ/g, '-');
		result = result.replace(/ +/g, ' ');
		result = result.replace(/ (ʿabd|ʿubayd)ub./g, ' $1 b.');
		return result;
	}

}

module.exports = Arabic;