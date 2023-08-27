/* jslint node:true, esversion:9 */
'use strict';

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

	static removeLatinDiacritics(s) {
		if (s) {
			s = s.normalize("NFD").replace(/\p{Diacritic}/gu, '');
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
			s = Arabic.removeDelimeters(s);
			s = s.replace(/ًا/gu, '');
			s = Arabic.normalize(s, true);
			s = s.replace(/رضي الله عن.+? /gu, '');
			s = s.replace(/رضي الله تعالى عن.+? /gu, '');
			s = s.replace(/صلي الله عليه وسلم/gu, '');
			s = s.replace(/صلي الله تعالى عليه وسلم/gu, '');
			s = s.replace(/ﷺ/gu, '');
			s = s.replace(/ﷻ/gu, '');
			s = s.replace(/( |^)ال([^\s]{3,})( |$)/gu, '$1$2$3');
			s = s.replace(/( |^)وال([^\s]{3,})( |$)/gu, '$1$2$3');
			s = s.replace(/( |^)فال([^\s]{3,})( |$)/gu, '$1$2$3');
			s = s.replace(/( |^)و([^\s]{3,})( |$)/gu, '$1$2$3');
			s = s.replace(/( |^)ف([^\s]{3,})( |$)/gu, '$1$2$3');
			s = s.replace(/( |^)([^\s]{2,})(ات|ان|ين|ون)( |$)/gu, '$1$2$4');
			s = s.replace(/[ة]/g, 'ت');
			s = s.replace(/[ايو]/g, '');
			s = s.replace(/ +/gu, ' ');
			s = s.trim();
		}
		return s;
	}

	static toArabicDigits(s) {
		s = (''+s).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
		return s;
	}


	static toLatinDigits(s) {
		const offset = '٠'.charCodeAt();
		s = (''+s).replace(/[٠-٩]/g, d => '0123456789'[d.charCodeAt()-offset]);
		return s;
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

	static arabizi2ALALC(s) {
		if (s) {
			s = s.replace(/3([a-zāīūḍḥṣṭẓʿʾ])/giu, 'ʿ$1'); // `ayn
			s = s.replace(/([a-zāīūḍḥṣṭẓ])3/gu, '$1ʿ'); // `ayn
	  
			s = s.replace(/2([a-zāīūḍḥṣṭẓʿʾ])/gu, 'ʾ$1'); // hamzah
			s = s.replace(/([a-zāīūḍḥṣṭẓʿʾ])2/gu, '$1ʾ'); // hamzah
	  
			s = s.replace(/\^6'([a-zāīūḍḥṣṭẓʿʾ])/gu, 'Ẓ$1'); // Ẓa
			s = s.replace(/([a-zāīūḍḥṣṭẓʿʾ])\^6'/gu, '$1Ẓ'); // Ẓa
			s = s.replace(/6'([a-zāīūḍḥṣṭẓʿʾ])/gu, 'ẓ$1'); // ẓa
			s = s.replace(/([a-zāīūḍḥṣṭẓʿʾ])6'/gu, 'ẓ1ṭ'); // ẓa
	  
			s = s.replace(/\^6([a-zāīūḍḥṣṭẓʿʾ])/gu, 'Ṭ$1'); // Ṭa
			s = s.replace(/([a-zāīūḍḥṣṭẓʿʾ])\^6/gu, '$1Ṭ'); // Ṭa
			s = s.replace(/6([a-zāīūḍḥṣṭẓʿʾ])/gu, 'ṭ$1'); // ṭa
			s = s.replace(/([a-zāīūḍḥṣṭẓʿʾ])6/gu, '$1ṭ'); // ṭa

			s = s.replace(/\^7([a-zāīūḍḥṣṭẓʿʾ])/gu, 'Ḥ$1'); // Ṭa
			s = s.replace(/([a-zāīūḍḥṣṭẓʿʾ])\^7/gu, '$1Ḥ'); // Ṭa
			s = s.replace(/7([a-zāīūḍḥṣṭẓʿʾ])/gu, 'ḥ$1'); // ṭa
			s = s.replace(/([a-zāīūḍḥṣṭẓʿʾ])7/gu, '$1ḥ'); // ṭa
	  
			s = s.replace(/\^9'([a-zāīūḍḥṣṭẓʿʾ])/gu, 'Ḍ$1'); // Ḍād
			s = s.replace(/([a-zāīūḍḥṣṭẓʿʾ])\^9'/gu, '$1Ḍ'); // Ḍād
			s = s.replace(/9'([a-zāīūḍḥṣṭẓʿʾ])/gu, 'ḍ$1'); // ḍād
			s = s.replace(/([a-zāīūḍḥṣṭẓʿʾ])9'/gu, '$1ḍ'); // ḍād
			
			s = s.replace(/\^9([a-zāīūḍḥṣṭẓʿʾ])/gu, 'Ṣ$1'); // Ṣād
			s = s.replace(/([a-zāīūḍḥṣṭẓʿʾ])\^9/gu, '$1Ṣ'); // Ṣād
			s = s.replace(/9([a-zāīūḍḥṣṭẓʿʾ])/gu, 'ṣ$1'); // ṣād
			s = s.replace(/([a-zāīūḍḥṣṭẓʿʾ])9/gu, '$1ṣ'); // ṣād
	  
			s = s.replace(/AAA/gu, 'Á');
			s = s.replace(/aaa/gu, 'á');

			s = s.replace(/AA/gu, 'Ā');
			s = s.replace(/aa/gu, 'ā');

			s = s.replace(/II/gu, 'Ī');
			s = s.replace(/ii/gu, 'ī');

			s = s.replace(/UU/gu, 'Ū');
			s = s.replace(/uu/gu, 'ū');

			s = s.replace(/\{\{/gu, '⌜');
			s = s.replace(/\}\}/gu, '⌝');

		}
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

	static toArabic(s) {
		s = s.replace(/,/gi, '،');
		s = s.replace(/;/gi, ';');
		s = s.replace(/ ?ʿAmr ?/gi, ' عمرو ');
		s = s.replace(/ ?and /gi, ' و ');
		s = s.replace(/ ?from /gi, ' عن ');
		s = s.replace(/husband/gi, ' زوج');
		s = s.replace(/wife/gi, ' زوجت');
		s = s.replace(/grandfather/gi, ' جد');
		s = s.replace(/father/gi, ' أبي');
		s = s.replace(/grandmother/gi, ' جدت');
		s = s.replace(/mother/gi, ' أم');
		s = s.replace(/paternal uncle/gi, ' عم');
		s = s.replace(/paternal aunt/gi, ' عمت');
		s = s.replace(/maternal uncle/gi, ' خال');
		s = s.replace(/maternal aunt/gi, ' خالت');
		s = s.replace(/freed slave/gi, ' مولى');
		s = s.replace(/my +([^ ]+)/gi, '$1ي');
		s = s.replace(/أبيي/gi, 'أبي');
		s = s.replace(/ىه/gi, 'اه');
		s = s.replace(/his +([^ ]+)/gi, '$1ه');
		s = s.replace(/her +([^ ]+)/gi, '$1ها');
		s = s.replace(/their +([^ ]+)/gi, '$1هم');
		s = s.replace(/ullāh/gi, ' الله');
		s = s.replace(/ʿ/g, 'ع');
		s = s.replace(/ʾ/g, 'ء');
		s = s.replace(/b\./g, 'بن');
		s = s.replace(/wa-/g, 'و');
		s = s.replace(/al-/g, 'ٱل');
		s = s.replace(/(^| |ٱل)[aiu]/gi, '$1ا');
		s = s.replace(/(^| |ٱل|[aiuāīūا])th/gi, '$1ث');
		s = s.replace(/(^| |ٱل|[aiuāīūا])gh/gi, '$1غ');
		s = s.replace(/(^| |ٱل|[aiuāīūا])kh/gi, '$1خ');
		s = s.replace(/(^| |ٱل|[aiuāīūا])dh/gi, '$1ذ');
		s = s.replace(/(^| |ٱل|[aiuāīūا])sh/gi, '$1ش');
		s = s.replace(/ah($| )/gi, 'ه$1');
		s = s.replace(/b+/gi, 'ب');
		s = s.replace(/t+/gi, 'ت');
		s = s.replace(/ṭ+/gi, 'ط');
		s = s.replace(/j+/gi, 'ج');
		s = s.replace(/h+/gi, 'ه');
		s = s.replace(/ḥ+/gi, 'ح');
		s = s.replace(/d+/gi, 'د');
		s = s.replace(/ḍ+/gi, 'ض');
		s = s.replace(/r+/gi, 'ر');
		s = s.replace(/z+/gi, 'ز');
		s = s.replace(/ẓ+/gi, 'ظ');
		s = s.replace(/s+/gi, 'س');
		s = s.replace(/ṣ+/gi, 'ص');
		s = s.replace(/f+/gi, 'ف');
		s = s.replace(/q+/gi, 'ق');
		s = s.replace(/k+/gi, 'ك');
		s = s.replace(/l+/gi, 'ل');
		s = s.replace(/m+/gi, 'م');
		s = s.replace(/n+/gi, 'ن');
		s = s.replace(/w+/gi, 'و');
		s = s.replace(/y+/gi, 'ي');
		s = s.replace(/ā/gi, 'ا');
		s = s.replace(/ū/gi, 'و');
		s = s.replace(/ī/gi, 'ي');
		s = s.replace(/á/gi, 'ى');
		s = s.replace(/a/gi, '');
		s = s.replace(/i/gi, '');
		s = s.replace(/u/gi, '');
		s = s.replace(/ٱ/gi, 'ا');
		s = s.replace(/ +/gi, ' ').trim();
		return s;
	}

}

console.log(Arabic.toArabic('from his father Ṭāriq b. Ashyam'));

module.exports = Arabic;