/* jslint node:true, esversion:9 */
'use strict';

const RE_DELIMETERS_NO_SPACE = /[^ \p{L}\p{M}\d]+/gu;
const RE_DELIMETERS_SPACE = /[^\p{L}\p{M}\d]+/gu;
const RE_TASHKIL = /\p{M}+/gu;

class Arabic {

	static isArabic(s) {
		if (s)
			return /[\u0600-\u06ff]/.test(s);
		return false;
	}

	static normalize(s) {
		if (s) {
			s = Arabic.removeArabicDiacritics(s);
			s = s.replace(/[ـ]/g, '');
			s = s.replace(/[آٱٵأإ]/g, 'ا');
			s = s.replace(/ؤ/g, 'و');
			s = s.replace(/[ئى]/g, 'ي');
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
		s = s.replace(/([\u064e-\u0650]\u0651)/g, '\u0561$1');
		return s;
	}

	static toArabicDigits(s) {
		s = s.replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
		//s = s.replace('a', ' أ').replace('b', ' ب').replace('c', ' ج').replace('d', ' د').replace('e', ' ه').replace('f', ' و').replace('g', ' ز');
		return s;
	}

	static parseNarrators(chain_ar) {
		chain_ar = Arabic.removeDelimeters(chain_ar);
		chain_ar = Arabic.normalizeArabicDiacritics(chain_ar);
		var narrators = [];
		var chains = chain_ar.split(/ ح /);
		for (var i = 0; i < chains.length; i++) {
			var ch = chain_ar;
			if (i > 1)
				ch = ' (الإسناد) ' + ch;
			ch = ch.replace(/(^| )(و\u064e)?حَدَّثَنَاهُ/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?حَدَّثَنَا/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?حَدَّثَنِي/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?حَدَّثَهَا/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?حَدَّثَهُ/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?ثَنَا/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?ثنا/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَخْبَرَنَاهُ/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَخْبَرَنَا/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَخْبَرَنِي/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَخْبَرَهَا/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَخْبَرَهُ/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَنَاهُ/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَنَا/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَنِي/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَهَا/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَهُ/g, ' {} ');

			ch = ch.replace(/(^| )(و\u064e)?حَدَّثَتْنَاهُ/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?حَدَّثَتْنَا/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?حَدَّثَتْنِي/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?حَدَّثَتْهَا/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?حَدَّثَتْهُ/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَخْبَرَتْنَاهُ/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَخْبَرَتْنَا/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَخْبَرَتْنِي/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَخْبَرَتْهَا/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَخْبَتْرَهُ/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَتْنَاهُ/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَتْنَا/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَتْنِي/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَتْهَا/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَنْبَأَتْهُ/g, ' {} ');

			ch = ch.replace(/(^| )(و\u064e)?سَمِعْتُ/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?سَمِعْنَا/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?سَمِعَتْ/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?سَمِعَ/g, ' {} ');

			ch = ch.replace(/(^| )(و\u064e)?إِلَى/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?عَلَى/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?عَنْهُمَا/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?عَنْهُ/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?عَنْهَا/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?عَنْ/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَنَّهُمَا/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَنَّهُ/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَنَّهَا/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَنَّ/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?أَنْ/g, ' {} ');

			ch = ch.replace(/(^| )([وف]\u064e)?قَالَتْ/g, ' {} ');
			ch = ch.replace(/(^| )([وف]\u064e)?قَالَا/g, ' {} ');
			ch = ch.replace(/(^| )([وف]\u064e)?قَالَ/g, ' {} ');
			ch = ch.replace(/(^| )([وف]\u064e)?يَقُولُ/g, ' {} ');
			ch = ch.replace(/(^| )([وف]\u064e)?تَقُولُ/g, ' {} ');

			ch = ch.replace(/(^| )(و\u064e)?كِلَاهُمَا/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?نَحْوَهُ/g, ' {} ');
			ch = ch.replace(/(^| )(و\u064e)?مِثْلَهُ/g, ' {} ');

			ch = ch.replace(/ +/g, ' ');

			var matches = ch.matchAll(/\}(.+?)(\{|$)/g);
			var narr = [];
			for (var match of matches) {
				if (!match[1].match(/^\s+$/)) {
					var name = match[1].trim();
					name = name.replace(/[\ufdfa\u0610-\u0613]/g, '');
					narr.push(name.trim());
				}
			}
			narrators.push(narr);
		}
		return narrators;
	}

	static translateChain(chain_ar) {
		chain_ar = Arabic.removeDelimeters(chain_ar);
		var chain_en = [];
		var narrators = [];
		var chains = chain_ar.split(/ ح /);
		for (var i = 0; i < chains.length; i++) {
			var ch = Arabic.toALALC(chains[i]);
			if (chains.length > 1)
				ch = '[Chain] ' + ch;
			ch = ch.replace(/(^| )(wa)?ḥaddathanāh /g, ' {$1he-narrated-it-us} ');
			ch = ch.replace(/(^| )(wa)?ḥaddathanā /g, ' {$1he-narrated-us} ');
			ch = ch.replace(/(^| )(wa)?ḥaddathanī /g, ' {$1he-narrated-me} ');
			ch = ch.replace(/(^| )(wa)?ḥaddathaha /g, ' {$1he-narrated-her} ');
			ch = ch.replace(/(^| )(wa)?ḥaddathah /g, ' {$1he-narrated-him} ');
			ch = ch.replace(/(^| )(wa)?(thnā|thanā) /g, ' {$1he-narrated-us} ');
			ch = ch.replace(/(^| )(waʾ)?akhbaranāh /g, ' {$1he-told-it-us} ');
			ch = ch.replace(/(^| )(waʾ)?akhbaranā /g, ' {$1he-told-us} ');
			ch = ch.replace(/(^| )(waʾ)?akhbaranī /g, ' {$1he-told-me} ');
			ch = ch.replace(/(^| )(waʾ)?akhbarahā /g, ' {$1he-told-her} ');
			ch = ch.replace(/(^| )(waʾ)?akhbarah /g, ' {$1he-told-him} ');
			ch = ch.replace(/(^| )(waʾ)?anbaʾanāh /g, ' {$1he-informed-it-us} ');
			ch = ch.replace(/(^| )(waʾ)?anbaʾanā /g, ' {$1he-informed-us} ');
			ch = ch.replace(/(^| )(waʾ)?anbaʾanī /g, ' {$1he-informed-me} ');
			ch = ch.replace(/(^| )(waʾ)?anbaʾahā /g, ' {$1he-informed-her} ');
			ch = ch.replace(/(^| )(waʾ)?anbaʾah /g, ' {$1he-informed-him} ');

			ch = ch.replace(/(^| )(wa)?ḥaddathatnāh /g, ' {$1she-narrated-it-us} ');
			ch = ch.replace(/(^| )(wa)?ḥaddathatnā /g, ' {$1she-narrated-us} ');
			ch = ch.replace(/(^| )(wa)?ḥaddathatnī /g, ' {$1she-narrated-me} ');
			ch = ch.replace(/(^| )(wa)?ḥaddathatha /g, ' {$1she-narrated-her} ');
			ch = ch.replace(/(^| )(wa)?ḥaddathath /g, ' {$1she-narrated-him} ');
			ch = ch.replace(/(^| )(waʾ)?akhbaratnāh /g, ' {$1she-told-it-us} ');
			ch = ch.replace(/(^| )(waʾ)?akhbaratnā /g, ' {$1she-told-us} ');
			ch = ch.replace(/(^| )(waʾ)?akhbaratnī /g, ' {$1she-told-me} ');
			ch = ch.replace(/(^| )(waʾ)?akhbarathā /g, ' {$1she-told-her} ');
			ch = ch.replace(/(^| )(waʾ)?akhbarath /g, ' {$1she-told-him} ');
			ch = ch.replace(/(^| )(waʾ)?anbaʾatnāh /g, ' {$1she-informed-itus} ');
			ch = ch.replace(/(^| )(waʾ)?anbaʾatnā /g, ' {$1she-informed-us} ');
			ch = ch.replace(/(^| )(waʾ)?anbaʾatnī /g, ' {$1she-informed-me} ');
			ch = ch.replace(/(^| )(waʾ)?anbaʾathā /g, ' {$1she-informed-her} ');
			ch = ch.replace(/(^| )(waʾ)?anbaʾath /g, ' {$1she-informed-him} ');

			ch = ch.replace(/(^| )(wa)?fī qawl[^ ]+ /g, ' {in-speech} ');
			ch = ch.replace(/(^| )([wf]a)?samiʿt /g, ' {I-heard} ');
			ch = ch.replace(/(^| )([wf]a)?samiʿat /g, ' {she-heard} ');
			ch = ch.replace(/(^| )([wf]a)?samiʿnā /g, ' {we-heard} ');
			ch = ch.replace(/(^| )([wf]a)?samiʿ /g, ' {he-heard} ');

			ch = ch.replace(/(^| )(waʾ)?ilá /g, ' {to} ');
			ch = ch.replace(/(^| )(a)?ʿalá /g, ' {on} ');
			ch = ch.replace(/(^| )(wa)?ʿa?n /g, ' {from} ');
			ch = ch.replace(/(^| )(waʾ)?annahā /g, ' {that-she} ');
			ch = ch.replace(/(^| )(waʾ)?annah /g, ' {that-he} ');
			ch = ch.replace(/(^| )(waʾ)?an+ /g, ' {that} ');

			ch = ch.replace(/(^| )([wf]a)?qāl /g, ' {he-said} ');
			ch = ch.replace(/(^| )([wf]a)?qālat /g, ' {she-said} ');
			ch = ch.replace(/(^| )([wf]a)?qālā /g, ' {both-said} ');

			ch = ch.replace(/(^| )([wf]a)?qālā /g, ' {both-said} ');
			ch = ch.replace(/(^| )([wf]a)?yaqūl /g, ' {he-says} ');
			ch = ch.replace(/(^| )([wf]a)?taqūl /g, ' {she-says} ');

			ch = ch.replace(/{ /g, '{');
			ch = ch.replace(/ kilāhumā /g, ' {both} ');
			ch = ch.replace(/ wa/, ' and ');
			ch = ch.replace(/ and (qqāṣ|kīʿ)/, ' wa$1');
			ch = ch.replace(/(^| )(wa?)?naḥwah/g, ' {similar-to-it} ');
			ch = ch.replace(/(^| )(wa?)?mithlah/g, ' {similar-to-it} ');

			var matches = ch.matchAll(/\}(.+?)(\{|$)/g);
			var narr = [];
			for (var match of matches) {
				if (!match[1].match(/^\s+$/)) {
					var name = match[1].trim();
					name = name.replace(/[\ufdfa\u0610-\u0613]/g, '');
					name = titleCaseName(match[1].trim());
					name = name.replace(/^Ab[ūī]hā$/ig, 'her father');
					name = name.replace(/^Ab[ūī]h$/ig, 'his father');
					name = name.replace(/^Ab[ūī]$/ig, 'my father');
					name = name.replace(/^Umm[ua]hā$/ig, 'her mother');
					name = name.replace(/^Umm[ua]h$/ig, 'his mother');
					name = name.replace(/^Ummī$/ig, 'my mother');
					name = name.replace(/^ʿAmm[ua]hā$/ig, 'her uncle');
					name = name.replace(/^ʿAmm[ua]h$/ig, 'his uncle');
					name = name.replace(/^ʿAmmī$/ig, 'my uncle');
					name = name.replace(/^ʿAmmat[ua]hā$/ig, 'her aunt');
					name = name.replace(/^ʿAmmat[ua]h$/ig, 'his aunt');
					name = name.replace(/^ʿAmmatī$/ig, 'my aunt');
					name = name.replace(/^Um al-Muʾminīn/, '');
					name = name.replace(/^Zawj al-Nabī$/, '');
					name = name.replace(/^Rajulān/g, 'two men');
					name = name.replace(/^Rajul/g, 'a man');
					name = name.replace(/^Mawlá/g, 'a freed slave of');
					name = name.replace(/^Jār/g, 'a neighbor');
					name = name.replace(/Baʿḍ Aṣḥāb[ui]h/g, 'some companions');
					narr.push(name.trim());
					ch = ch.replace(match[1], ` ${name} `);
				}
			}

			for (var r = 0; r < 3; r++) {
				ch = ch.replace(/{(\w+?)-narrated-(\w+?)}(.+?)({|,|$)/g, '; $3 narrated to $2; $4');
				ch = ch.replace(/{(\w+?)-narrated-it-(\w+?)}(.+?)({|,|$)/g, '; $3 narrated it to $2; $4');
			}
			for (r = 0; r < 3; r++) {
				ch = ch.replace(/{(\w+?)-told-(\w+?)}(.+?)({|,|$)/g, '; $3 told $2; $4');
				ch = ch.replace(/{(\w+?)-told-it-(\w+?)}(.+?)({|,|$)/g, '; $3 told $2 about it; $4');
			}
			for (r = 0; r < 3; r++) {
				ch = ch.replace(/{(\w+?)-informed-(\w+?)}(.+?)({|,|$)/g, '; $3 informed $2; $4');
				ch = ch.replace(/{(\w+?)-informed-it-(\w+?)}(.+?)({|,|$)/g, '; $3 informed $2 about it; $4');
			}
			for (r = 0; r < 3; r++) {
				ch = ch.replace(/{(\w+?)-said}(.+?)({|,|$)/g, 'and $2 said $3');
				ch = ch.replace(/{(\w+?)-heard}(.+?)({|,|$)/g, ' $2 heard $3');
			}
			ch = ch.replace(/{from}/g, '; from ');
			ch = ch.replace(/{that}/g, ' that ');
			ch = ch.replace(/{that-(\w+?)}/g, 'that $1 ');
			ch = ch.replace(/{on}/g, ' on ');
			ch = ch.replace(/{to}/g, ' to ');
			ch = ch.replace(/{both}/g, ' both ');
			ch = ch.replace(/Ab[ūī]h/g, 'his father');
			ch = ch.replace(/Ab[ūī]/g, 'my father');
			ch = ch.replace(/\s+/g, ' ');
			ch = ch.replace(/ ;/g, ';');
			ch = ch.replace(/;+/g, ';');
			ch = ch.replace(/^; /, '');
			chain_en.push(ch.trim());
			narrators.push(narr);
		}
		return {
			chain_en: chain_en,
			narrators: narrators
		};
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
		result = result.replace(/āū/g, 'āwū');
		result = result.replace(/īa/g, 'īwa');
		result = result.replace(/ūa/g, 'ūwa');
		result = result.replace(/ al-lh/g, ' allāh');
		result = result.replace(/ (ʿabd|ʿubayd)\s+allāh/g, ' $1ullāh ');
		result = result.replace(/ (ʿabd|ʿubayd)\s+allāh/g, ' $1ullāh ');
		result = result.replace(/ (ʿamat?)\s+allāh/g, ' $1ullāh ');
		result = result.replace(/ ʿam(rw|riw|rٍw)/g, ' ʿamr');
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

function titleCaseName(name) {
	var words = name.split(/([ \-])/);
	for (var w = 0; w < words.length; w++) {
		var word = words[w].split('');
		var i = 0;
		if (word[0] == 'ʿ' || word[0] == 'ʾ')
			i = 1;
		if (word.length > 1)
			word[i] = word[i].toUpperCase();
		words[w] = word.join('');
	}
	name = words.join('');
	name = name.replace(/Al-/g, 'al-');
	name = name.replace(/B\./g, 'b.');
	return name;
}

module.exports = Arabic;