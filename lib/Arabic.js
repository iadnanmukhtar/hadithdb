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

	static translateChain(chain_ar) {
		var chain_en = [];
		var narrators = [];
		var chains = chain_ar.split(/ ح /);
		for (var i = 0; i < chains.length; i++) {
			var ch = Arabic.toALALC(chains[i]);
			if (chains.length > 1)
				ch = '[CHAIN] ' + ch;
			ch = ch.replace(/(^| )(wa)?ḥaddathanāh /g, ' {$1he-narrated-it-us} ');
			ch = ch.replace(/(^| )(wa)?ḥaddathanā /g, ' {$1he-narrated-us} ');
			ch = ch.replace(/(^| )(wa)?ḥaddathanī /g, ' {$1he-narrated-me} ');
			ch = ch.replace(/(^| )(wa)?ḥaddathaha /g, ' {$1he-narrated-her} ');
			ch = ch.replace(/(^| )(wa)?ḥaddathah /g, ' {$1he-narrated-him} ');
			ch = ch.replace(/(^| )(wa)?(thnā|thanā) /g, ' {$1he-narrated-us} ');
			ch = ch.replace(/(^| )(wa)?akhbaranāh /g, ' {$1he-told-it-us} ');
			ch = ch.replace(/(^| )(wa)?akhbaranā /g, ' {$1he-told-us} ');
			ch = ch.replace(/(^| )(wa)?akhbaranī /g, ' {$1he-told-me} ');
			ch = ch.replace(/(^| )(wa)?akhbarahā /g, ' {$1he-told-her} ');
			ch = ch.replace(/(^| )(wa)?akhbarah /g, ' {$1he-told-him} ');
			ch = ch.replace(/(^| )(wa)?anbaʾanāh /g, ' {$1he-informed-it-us} ');
			ch = ch.replace(/(^| )(wa)?anbaʾanā /g, ' {$1he-informed-us} ');
			ch = ch.replace(/(^| )(wa)?anbaʾanī /g, ' {$1he-informed-me} ');
			ch = ch.replace(/(^| )(wa)?anbaʾahā /g, ' {$1he-informed-her} ');
			ch = ch.replace(/(^| )(wa)?anbaʾah /g, ' {$1he-informed-him} ');

			ch = ch.replace(/(^| )(wa)?ḥaddathatnāh /g, ' {$1she-narrated-it-us} ');
			ch = ch.replace(/(^| )(wa)?ḥaddathatnā /g, ' {$1she-narrated-us} ');
			ch = ch.replace(/(^| )(wa)?ḥaddathatnī /g, ' {$1she-narrated-me} ');
			ch = ch.replace(/(^| )(wa)?ḥaddathatha /g, ' {$1she-narrated-her} ');
			ch = ch.replace(/(^| )(wa)?ḥaddathath /g, ' {$1she-narrated-him} ');
			ch = ch.replace(/(^| )(wa)?akhbaratnāh /g, ' {$1she-told-it-us} ');
			ch = ch.replace(/(^| )(wa)?akhbaratnā /g, ' {$1she-told-us} ');
			ch = ch.replace(/(^| )(wa)?akhbaratnī /g, ' {$1she-told-me} ');
			ch = ch.replace(/(^| )(wa)?akhbarathā /g, ' {$1she-told-her} ');
			ch = ch.replace(/(^| )(wa)?akhbarath /g, ' {$1she-told-him} ');
			ch = ch.replace(/(^| )(wa)?anbaʾatnāh /g, ' {$1she-informed-itus} ');
			ch = ch.replace(/(^| )(wa)?anbaʾatnā /g, ' {$1she-informed-us} ');
			ch = ch.replace(/(^| )(wa)?anbaʾatnī /g, ' {$1she-informed-me} ');
			ch = ch.replace(/(^| )(wa)?anbaʾathā /g, ' {$1she-informed-her} ');
			ch = ch.replace(/(^| )(wa)?anbaʾath /g, ' {$1she-informed-him} ');

			ch = ch.replace(/(^| )(wa)?samiʿt /g, ' {I-heard} ');
			ch = ch.replace(/(^| )(wa)?samiʿat /g, ' {she-heard} ');
			ch = ch.replace(/(^| )(wa)?samiʿnā /g, ' {we-heard} ');
			ch = ch.replace(/(^| )(wa)?samiʿ /g, ' {he-heard} ');

			ch = ch.replace(/(^| )ilá /g, ' {to} ');
			ch = ch.replace(/(^| )ʿalá /g, ' {on} ');
			ch = ch.replace(/(^| )ʿan /g, ' {from} ');
			ch = ch.replace(/(^| )annahā /g, ' {that-she} ');
			ch = ch.replace(/(^| )annah /g, ' {that-he} ');
			ch = ch.replace(/(^| )an+ /g, ' {that} ');

			ch = ch.replace(/(^| )qāl /g, ' {he-said} ');
			ch = ch.replace(/(^| )qālat /g, ' {she-said} ');
			ch = ch.replace(/(^| )qālā /g, ' {both-said} ');
			ch = ch.replace(/(^| )qālat /g, ' {she-said} ');

			ch = ch.replace(/(^| )qālā /g, ' {both-said} ');
			ch = ch.replace(/(^| )yaqūl /g, ' {he-says} ');
			ch = ch.replace(/(^| )taqūl /g, ' {she-says} ');
			ch = ch.replace(/{ /g, '{');
			ch = ch.replace(/ kilāhumā /g, ' {both} ');

			var matches = ch.matchAll(/\}(.+?)(\{|$)/g);
			var narr = [];
			for (var match of matches) {
				if (!match[1].match(/^\s+$/)) {
					var name = titleCaseName(match[1].trim());
					narr.push(name);
					ch = ch.replace(match[1], ` ${name} `);
				}
			}

			for (var r = 0; r < 3; r++) {
				ch = ch.replace(/{(\w+?)-narrated-(\w+?)}(.+?)({|,|$)/g, ', $3 narrated to $2, $4');
				ch = ch.replace(/{(\w+?)-narrated-it-(\w+?)}(.+?)({|,|$)/g, ', $3 narrated it to $2, $4');
			}
			for (r = 0; r < 3; r++) {
				ch = ch.replace(/{(\w+?)-told-(\w+?)}(.+?)({|,|$)/g, ', $3 told $2, $4');
				ch = ch.replace(/{(\w+?)-told-it-(\w+?)}(.+?)({|,|$)/g, ', $3 told $2 about it, $4');
			}
			for (r = 0; r < 3; r++) {
				ch = ch.replace(/{(\w+?)-informed-(\w+?)}(.+?)({|,|$)/g, ', $3 informed $2, $4');
				ch = ch.replace(/{(\w+?)-informed-it-(\w+?)}(.+?)({|,|$)/g, ', $3 informed $2 about it, $4');
			}
			for (r = 0; r < 3; r++)
				ch = ch.replace(/{(\w+?)-said}(.+?)({|,|$)/g, ', $2 said, $3');
			ch = ch.replace(/{from}/g, ', from ');
			ch = ch.replace(/{that}/g, ' that ');
			ch = ch.replace(/{that-(\w+?)}/g, 'that $1 ');
			ch = ch.replace(/{on}/g, ' on ');
			ch = ch.replace(/{to}/g, ' to ');
			ch = ch.replace(/{both}/g, ' both ');
			ch = ch.replace(/\s+/g, ' ');
			chain_en.push(ch.trim());
			narrators.push(narr.join(' > ').trim());
		}
		return {
			chain_en: chain_en,
			narrators: narrators
		};
	}

	static toALALC(s) {
		var result = '';
		// clean string
		s = s.replace(RE_DELIMETERS, ' ').replace(/\s+/g, ' ').trim();
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
		result = result.replace(/ (ʿabd|ʿubayd)\s+([^\s]+|$)/g, ' $1u$2 ');
		result = result.replace(/ (ʿabdu|ʿubaydu)al-/g, ' $1l');
		result = result.replace(/ (ʿabdu|ʿubaydu)a/g, ' $1');
		result = result.replace(/ (ama)h\s+([^\s]+|$)/g, ' $1tu$2 ');
		result = result.replace(/ (amatu)al-/g, ' $1tu');
		result = result.replace(/ ʿamatua/g, ' ʿamatu');
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

// var chains = [
// 	`حَدَّثَنِي أَبُو إِسْحَاقَ الْمُزَكِّي ثَنَا أَبُو الْعَبَّاسِ بْنُ سَعِيدٍ الْحَافِظُ ثَنَا يَعْقُوبُ بْنُ يُوسُفَ بْنِ زِيَادٍ الضَّبِّيُّ ثَنَا أَبُو حَفْصٍ الْأَعْشَى ثَنَا بَسَّامٌ الصَّيْرَفِيُّ عَنْ أَبِي الطُّفَيْلِ الْكِنَانِيِّ عَنْ حُبَابِ بْنِ الْمُنْذِرِ`,
// 	`حَدَّثَنَا إِبْرَاهِيمُ بْنُ أَبِي الْعَبَّاسِ حَدَّثَنَا أَبُو أُوَيْسٍ قَالَ الزُّهْرِيُّ أَخْبَرَنِي عَبْدُ الرَّحْمَنِ بْنُ عَبْدِ اللهِ الْأَنْصَارِيُّ أَنَّ كَعْبَ بْنَ مَالِكٍ كَانَ يُحَدِّثُ`,
// 	`وَحَدَّثَنَاهُ عَبْدُ بْنُ حُمَيْدٍ حَدَّثَنَا سَعِيدُ بْنُ عَامِرٍ عَنْ شُعْبَةَ ح وَحَدَّثَنَا عَبْدُ بْنُ حُمَيْدٍ أَخْبَرَنَا عَبْدُ الرَّزَّاقِ أَخْبَرَنَا مَعْمَرٌ كِلاَهُمَا عَنْ عَاصِمٍ الأَحْوَلِ عَنْ عَبْدِ اللَّهِ بْنِ الْحَارِثِ`
// ];

// for (var chain of chains)
// 	console.log(Arabic.translateChain(chain));
