/* jslint node:true, esversion:8 */
'use strict';

const RE_DELIMETERS = /[\:\«»\(\)"\'،۔ـ\-\.\,\s]/g;
const T_STR = '\u064B\u064C\u064D\u064E\u064F\u0650\u0651\u0652\u0670';
const T = new RegExp(`[${T_STR}]+`, 'g');
const NON_T = new RegExp(`[^${T_STR}]+`, 'g');

class Arabic {

	static removeArabicDiacritics(s) {
		return s.replace(T, '');
	}

    static toArabicDigits(s) {
        s = s.replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
        s = s.replace('a', ' أ').replace('b', ' ب').replace('c', ' ج').replace('d', ' د').replace('e', ' ه').replace('f', ' و').replace('g', ' ز');
        return s;
    }

	static toALALC(s) {
		var result = '';
		// clean string
		s = s.replace(RE_DELIMETERS, ' ').replace(/\s+/g, ' ').trim();
		var words = s.split(/\s+/);
		for (var w of words) {
			//w = w.replace(new RegExp(`(${T})(ا|و|ي)(${NON_T}|$)`, 'g'), '$1$2\u0652$3');
			w = w.replace(/ع/g, 'ʿ');
			w = w.replace(/[ءأإؤئ]/g, 'ʾ');
			w = w.replace(/^ʾ/g, '');
			w = w.replace(/^ال/, 'al-')
			w = w.replace(/^ب\u0650?ال/, 'bi-al-');
			w = w.replace(/^ل\u0650?ال/, 'lil-');
			w = w.replace(/^و\u064e?ال/, 'wa-al-');
			w = w.replace(/^ف\u064e?ال/, 'wa-al-');
			w = w.replace(/\u064eو/g, 'aw');
			w = w.replace(/\u064eي/g, 'ay');
			w = w.replace(/(آ|\u064e?ا|\u064e?\u0670)/g, 'ā');
			w = w.replace(/(\u0650?ي|\u0650?\u0656)/g, 'ī');
			w = w.replace(/(\u064f?و|\u0657)/g, 'ū');
			w = w.replace(/(\u064bا$|ا\u064b$)/g, '');
			w = w.replace(/\u064d$/g, '');
			w = w.replace(/\u064c$/g, '');
			w = w.replace(/([\u064b-\u065f])$/, '');
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
			w = w.replace('al-llah', 'llāh');
			w = w.replace('al-ll', 'al-l');
			result += w + ' ';
		}
		result = result.replace(/ (ʿabd|ʿubayd) ([^\s]|$)/g, '$1u$2');
		result = result.replace(/ amah/g, 'amatu$2');
		return result;
	}

}

//console.log(Arabic.toALALC('أَخْبَرَنَا'));
//console.log(Arabic.toALALC('أَخْبَرَنَا قُتَيْبَةُ قَالَ حَدَّثَنَا اللَّيْثُ بْنُ سَعْدٍ عَنْ عَبْدِ اللَّهِ بْنِ عُبَيْدِ اللَّهِ'));

module.exports = Arabic;