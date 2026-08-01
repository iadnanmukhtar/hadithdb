#!/usr/bin/env node
/* jslint node:true, esversion:9 */
'use strict';

require('dotenv').config();
require('../../lib/Globals');
const fs = require('fs');
const path = require('path');
const MySQL = require('mysql');
const cheerio = require('cheerio');

const TAFSIRS = {
	'tafsir-tabari': {
		ordinal: 1,
		shortName_en: 'Tabari',
		shortName: 'الطَّبَرِيّ',
		name_en: 'Jami al-Bayan an Tawil Ay al-Quran',
		name: 'جَامِعُ البَيَانِ عَنْ تَأْوِيلِ آيِ القُرْآنِ',
		author_en: 'Ibn Jarir al-Tabari',
		author: 'مُحَمَّدُ بْنُ جَرِيرِ بْنِ يَزِيدَ الطَّبَرِيّ',
		description: 'The foundational encyclopedic tafsir, built on transmitted reports, Arabic evidence, variant readings, and reasoned preference between interpretations. It is essential for early tafsir, isnad-based material, and the roots of later commentary.',
		aqidah: 'Early Sunni traditionalist / Athari',
		lang: 'ar',
		format: 'md',
		file: 'data/tafsir/tabari.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'tafsir-baghawi': {
		ordinal: 8,
		shortName_en: 'Baghawi',
		shortName: 'البَغَوِيّ',
		name_en: 'Maalim al-Tanzil fi Tafsir al-Quran',
		name: 'مَعَالِمُ التَّنْزِيلِ فِي تَفْسِيرِ القُرْآنِ',
		author_en: 'al-Husayn b. Muhammad al-Farra al-Baghawi',
		author: 'الحُسَيْنُ بْنُ مَسْعُودِ بْنِ مُحَمَّدٍ الفَرَّاءُ البَغَوِيّ',
		description: 'A respected Sunni tafsir that combines transmitted reports with concise explanation, language, legal material, and creed-related clarity. It is often treated as a reliable middle path between narration and analysis.',
		aqidah: 'Athari',
		lang: 'ar',
		format: 'md',
		file: 'data/tafsir/baghawi.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'tafsir-ibn-al-jawzi': {
		ordinal: 10,
		shortName_en: 'Ibn al-Jawzi',
		shortName: 'ابْنُ الجَوْزِيّ',
		name_en: 'Zad al-Masir fi Ilm al-Tafsir',
		name: 'زَادُ المَسِيرِ فِي عِلْمِ التَّفْسِيرِ',
		author_en: 'Abd al-Rahman b. Abu Hasan Ali b. al-Jawzi',
		author: 'عَبْدُ الرَّحْمَنِ بْنُ عَلِيِّ بْنِ مُحَمَّدٍ ابْنُ الجَوْزِيّ',
		description: 'A concise but rich Hanbali tafsir that organizes earlier interpretations, language, variant opinions, and moral lessons. It is useful for seeing multiple explanations summarized with literary and preaching sensitivity.',
		aqidah: 'Hanbali Sunni',
		lang: 'ar',
		format: 'md',
		file: 'data/tafsir/ibn-al-jawzi.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'tafsir-qurtubi': {
		ordinal: 12,
		shortName_en: 'Qurtubi',
		shortName: 'القُرْطُبِيّ',
		name_en: 'al-Jami li-Ahkam al-Quran wa-al-Mubayyin lima Tadammana min al-Sunnah wa-Ay al-Furqan',
		name: 'الجَامِعُ لِأَحْكَامِ القُرْآنِ وَالمُبَيِّنُ لِمَا تَضَمَّنَهُ مِنَ السُّنَّةِ وَآيِ الفُرْقَانِ',
		author_en: 'Muhammad b. Abu Bakr al-Ansari al-Qurtubi',
		author: 'مُحَمَّدُ بْنُ أَحْمَدَ بْنِ أَبِي بَكْرٍ الأَنْصَارِيُّ القُرْطُبِيّ',
		description: 'A major Maliki tafsir especially strong in legal rulings, juristic disagreement, Arabic, readings, and practical implications. It remains one of the most important resources for Quranic ahkam.',
		aqidah: 'Ashari',
		lang: 'ar',
		format: 'md',
		file: 'data/tafsir/qurtubi.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'tafsir-ibn-ashur': {
		ordinal: 34,
		shortName_en: 'Ibn Ashur',
		shortName: 'ابْنُ عَاشُورَ',
		name_en: 'Tahrir al-Mana al-Sadid wa-Tanwir al-Aql al-Jadid min Tafsir al-Kitab al-Majid',
		name: 'تَحْرِيرُ المَعْنَى السَّدِيدِ وَتَنْوِيرُ العَقْلِ الجَدِيدِ مِنْ تَفْسِيرِ الكِتَابِ المَجِيدِ',
		author_en: 'Muhammad al-Tahir b. Ashur',
		author: 'مُحَمَّدُ الطَّاهِرُ بْنُ مُحَمَّدٍ بْنِ مُحَمَّدٍ الطَّاهِرِ بْنِ عَاشُورَ',
		description: 'A modern masterpiece emphasizing maqasid, rhetoric, coherence, language, social guidance, and legal reflection. It is especially valuable for literary analysis and for reading the Quran as a unified discourse.',
		aqidah: 'Ashari',
		lang: 'ar',
		format: 'md',
		file: 'data/tafsir/ibn-ashur.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'tafsir-mathur': {
		ordinal: 45,
		shortName_en: 'Mathur',
		shortName: 'المَأْثُورُ',
		name_en: 'Mawsuat al-Tafsir al-Mathur',
		name: 'مَوْسُوعَةُ التَّفْسِيرِ المَأْثُورِ',
		author_en: 'al-Shatibi Institute',
		author: 'مَعْهَدُ الإِمَامِ الشَّاطِبِيّ',
		description: 'A contemporary encyclopedia of transmitted tafsir collecting narrations and early explanations with organized presentation. It is useful for surveying tafsir bil-mathur material across the Quran.',
		aqidah: 'Contemporary Sunni',
		lang: 'ar',
		format: 'md',
		file: 'data/tafsir/tafsir-al-mathur.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'tafsir-suyuti': {
		ordinal: 24,
		shortName_en: 'Suyuti',
		shortName: 'السُّيُوطِيّ',
		name_en: 'al-Durr al-Manthur fi al-Tafsir bi-al-Mathur',
		name: 'الدُّرُّ المَنْثُورُ فِي التَّفْسِيرِ بِالمَأْثُورِ',
		author_en: 'Jalal al-Din al-Suyuti',
		author: 'جَلَالُ الدِّينِ عَبْدُ الرَّحْمَنِ بْنُ أَبِي بَكْرٍ السُّيُوطِيّ',
		description: 'A major compilation of transmitted tafsir reports from hadith and earlier sources. It is valuable for locating narrations and early exegetical material, while individual reports still require hadith-critical evaluation.',
		aqidah: 'Ashari',
		lang: 'ar',
		format: 'md',
		file: 'data/tafsir/tafsir-suyuti.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'wajiz': {
		ordinal: 44,
		shortName_en: 'Wajiz',
		shortName: 'الوَجِيزُ',
		name_en: 'al-Tafsir al-Wajiz',
		name: 'الوَجِيزُ',
		author_en: 'Ali b. Ahmad al-Wahidi',
		author: 'عَلِيُّ بْنُ أَحْمَدَ الوَاحِدِيّ',
		description: 'A concise classical tafsir by al-Wahidi focused on brief explanation and clarification of Quranic meanings.',
		aqidah: 'Ashari',
		lang: 'ar',
		format: 'md',
		file: 'temp/wajiz.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'basit': {
		ordinal: 42,
		shortName_en: 'Basit',
		shortName: 'البَسِيطُ',
		name_en: 'al-Tafsir al-Basit',
		name: 'التَّفْسِيرُ البَسِيطُ',
		author_en: 'Ali b. Ahmad al-Wahidi',
		author: 'عَلِيُّ بْنُ أَحْمَدَ الوَاحِدِيّ',
		description: 'A detailed classical tafsir by al-Wahidi with linguistic discussion, transmitted explanations, and extended commentary.',
		aqidah: 'Ashari',
		lang: 'ar',
		format: 'md',
		file: 'temp/basit.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 100,
		autocommit: true
	},
	'ibn-atiyah': {
		ordinal: 41,
		shortName_en: 'Ibn Atiyyah',
		shortName: 'ابْنُ عَطِيَّةَ',
		name_en: 'al-Muharrar al-Wajiz',
		name: 'المُحَرَّرُ الوَجِيزُ',
		author_en: 'Abd al-Haqq b. Atiyyah',
		author: 'عَبْدُ الحَقِّ بْنِ عَطِيَّةَ',
		description: 'A major Andalusian tafsir combining transmitted reports, Arabic analysis, recitation material, and concise scholarly judgment.',
		aqidah: 'Ashari',
		lang: 'ar',
		format: 'md',
		file: 'temp/Ibn-atiyyah.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 1,
		autocommit: true
	},
	'wasit': {
		ordinal: 54,
		shortName_en: 'Wasit',
		shortName: 'الوَسِيطُ',
		name_en: 'al-Tafsir al-Wasit',
		name: 'التَّفْسِيرُ الوَسِيطُ',
		author_en: 'Muhammad Sayyid Tantawi',
		author: 'مُحَمَّدُ سَيِّدْ طَنْطَاوِي',
		description: 'A contemporary Arabic tafsir focused on accessible explanation, guidance, and clear presentation of Quranic meanings.',
		aqidah: 'Contemporary Sunni',
		lang: 'ar',
		format: 'md',
		file: 'temp/wasit.json',
		column: 'text',
		batchSize: 25,
		autocommit: true
	},
	'mawardi': {
		lang: 'ar',
		format: 'md',
		file: 'temp/mawardi.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 50,
		autocommit: true
	},
	'samaani': {
		lang: 'ar',
		format: 'md',
		file: 'temp/samaani.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 50,
		autocommit: true
	},
	'makki': {
		lang: 'ar',
		format: 'md',
		file: 'temp/makki.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 50,
		autocommit: true
	},
	'samarqandi': {
		lang: 'ar',
		format: 'md',
		file: 'temp/samarqandi.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 50,
		autocommit: true
	},
	'thalabi': {
		ordinal: 20,
		shortName_en: 'Thalabi',
		shortName: 'الثَّعْلَبِيّ',
		name_en: 'al-Kashf wa-al-Bayan',
		name: 'الكَشْفُ وَالبَيَانُ',
		author_en: 'Ahmad b. Muhammad al-Thaalabi',
		author: 'أَحْمَدُ بْنُ مُحَمَّدِ الثَّعْلَبِيّ',
		description: 'A broad narrative and transmitted tafsir known for collecting reports, stories, linguistic notes, and earlier interpretations. It is influential as a source for later exegetes, though its reports vary in strength and require critical handling.',
		aqidah: 'Ashari',
		lang: 'ar',
		format: 'md',
		file: 'temp/thalabi.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 50,
		autocommit: true
	},
	'zamakhshari': {
		lang: 'ar',
		format: 'md',
		file: 'temp/kashaf.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 50,
		autocommit: true
	},
	'tadabbur-wa-amal': {
		lang: 'ar',
		format: 'md',
		file: 'temp/tadabbur-wa-amal.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 50,
		autocommit: true
	},
	'iji': {
		lang: 'ar',
		format: 'md',
		file: 'temp/iji.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 50,
		autocommit: true
	},
	'baydawi': {
		lang: 'ar',
		format: 'md',
		file: 'temp/baydawi.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 50,
		autocommit: true
	},
	'nasafi': {
		lang: 'ar',
		format: 'md',
		file: 'temp/nasafi.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 50,
		autocommit: true
	},
	'shawkani': {
		lang: 'ar',
		format: 'md',
		file: 'temp/shawkani.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 50,
		autocommit: true
	},
	'alusi': {
		lang: 'ar',
		format: 'md',
		file: 'temp/alusi.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 50,
		autocommit: true
	},
	'razi': {
		lang: 'ar',
		format: 'md',
		file: 'temp/razi.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 50,
		autocommit: true
	},
	'shanqiti': {
		lang: 'ar',
		format: 'md',
		file: 'temp/shanqiti.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 50,
		autocommit: true
	},
	'biqaii': {
		lang: 'ar',
		format: 'md',
		file: 'temp/biqaii.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 50,
		autocommit: true
	},
	'abu-hayyan': {
		lang: 'ar',
		format: 'md',
		file: 'temp/abu-hayyan.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 50,
		autocommit: true
	},
	'qasimi': {
		lang: 'ar',
		format: 'md',
		file: 'temp/qasimi.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 50,
		autocommit: true
	},
	'qinnawji': {
		lang: 'ar',
		format: 'md',
		file: 'temp/qinnawji.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 50,
		autocommit: true
	},
	'ibn-uthaymin': {
		lang: 'ar',
		format: 'md',
		file: 'temp/ibn-uthaymin.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 50,
		autocommit: true
	},
	'gharib-al-quran': {
		ordinal: 40,
		shortName_en: 'Gharib',
		shortName: 'الغَرِيبُ',
		name_en: 'al-Siraj fi Bayan Gharib al-Quran',
		name: 'السِّرَاجُ فِي بَيَانِ غَرِيبِ القُرْآنِ',
		author_en: 'Tafsir Center for Quranic Studies',
		author: 'مَرْكَزُ تَفْسِيرٍ لِلدِّرَاسَاتِ القُرْآنِيَّةِ',
		description: 'A focused resource explaining uncommon Quranic vocabulary and difficult words. It is useful as a lexical aid rather than as a full verse-by-verse tafsir.',
		aqidah: 'Contemporary Sunni',
		lang: 'ar',
		format: 'md',
		file: 'data/tafsir/gharib-al-quran.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'en-tafsir-maarif-al-quran': {
		ordinal: 36,
		shortName_en: "Ma'ariful Qur'an",
		name_en: "Ma'ariful Qur'an",
		name: 'مَعَارِفُ القُرْآنِ',
		author_en: 'Mufti Muhammad Shafi',
		description: 'A modern Hanafi-Deobandi tafsir combining explanation, legal guidance, spiritual counsel, and contemporary application. It is especially useful for practical lessons and juristic discussion in a South Asian scholarly style.',
		aqidah: 'Maturidi',
		directory: 'data/en-maarifulquran'
	},
	'en-tafsir-tazkir-al-quran': {
		ordinal: 39,
		shortName_en: 'Tazkirul Quran',
		name_en: 'Tadhkir al-Quran',
		name: 'تَذْكِيرُ القُرْآنِ',
		author_en: 'Maulana Wahiduddin Khan',
		description: 'A modern reflective tafsir focused on reminders, moral awakening, and the Quran’s call to faith and accountability. It is less technical and more concerned with guidance and contemplation.',
		aqidah: 'Modern Sunni',
		directory: 'data/en-tazkirulquran'
	},
	'en-tafsir-mokhtasar': {
		ordinal: 46,
		shortName_en: 'Mokhtasar',
		shortName: 'المُخْتَصَرُ',
		name_en: 'al-Mukhtasar fi Tafsir al-Quran al-Karim',
		name: 'المُخْتَصَرُ فِي تَفْسِيرِ القُرْآنِ الكَرِيمِ',
		author_en: 'Tafsir Center for Quranic Studies',
		author: 'مَرْكَزُ تَفْسِيرٍ لِلدِّرَاسَاتِ القُرْآنِيَّةِ',
		description: 'A contemporary concise tafsir written for accessibility, clarity, and practical guidance. It summarizes meanings in plain language, avoids lengthy disputes, and is useful for quick reading alongside the Quran.',
		aqidah: 'Contemporary Sunni',
		lang: 'en',
		format: 'en:md,ar:md',
		files: {
			en: 'data/en-mokhtasar.json',
			ar: 'data/ar-mokhtasar.json'
		}
	},
	'irab-al-quran': {
		ordinal: 31,
		shortName_en: 'Irab',
		shortName: 'الإِعْرَابُ',
		name_en: 'al-Jadwal fi Irab al-Quran wa-Sarfih wa-Bayanih',
		name: 'الجَدْوَلُ فِي إِعْرَابِ القُرْآنِ وَصَرْفِهِ وَبَيَانِهِ',
		author_en: 'Mahmud Safi',
		author: 'مَحْمُودُ بْنُ عَبْدِ الرَّحِيمِ صَافِي',
		description: 'A grammatical companion to the Quran that focuses on irab, morphology, and explanatory parsing. It is most useful for students analyzing sentence structure and the Arabic mechanics of the verses.',
		aqidah: 'Sunni, not firmly classified',
		lang: 'ar',
		format: 'md',
		file: 'data/irab.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'irab-daas': {
		ordinal: 48,
		shortName_en: 'Irab (Daas)',
		shortName: 'إِعْرَابُ الدَّعَّاسِ',
		name_en: 'Irab al-Quran al-Karim',
		name: 'إِعْرَابُ القُرْآنِ الكَرِيمِ',
		author_en: 'Ahmad Ubayd al-Daas',
		author: 'أَحْمَدُ عُبَيْدُ الدَّعَّاسُ',
		description: 'A concise grammatical parsing resource for the Quran, useful for quick irab and syntactic clarification. Its focus is Arabic structure rather than broad theological or legal interpretation.',
		aqidah: 'Sunni, not firmly classified',
		lang: 'ar',
		format: 'md',
		file: 'data/irab-daas.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'ibn-adil': {
		ordinal: 21,
		shortName_en: 'Ibn Adil',
		shortName: 'ابْنُ عَادِلٍ',
		name_en: 'al-Lubab fi Ulum al-Kitab',
		name: 'اللُّبَابُ فِي عُلُومِ الكِتَابِ',
		author_en: 'Umar b. Ali b. Adil',
		author: 'عُمَرُ بْنُ عَلِيِّ بْنِ عَادِلٍ الدِّمَشْقِيُّ الحَنْبَلِيّ',
		description: 'A large Hanbali tafsir drawing heavily on earlier sources, with attention to language, legal issues, theology, and variant interpretations. It is useful as a broad later compilation of classical material.',
		aqidah: 'Hanbali Sunni',
		death: 880,
		lang: 'ar',
		format: 'md',
		file: 'data/ibn-adil.json',
		column: 'text',
		sourceFormat: 'html',
		batchSize: 250,
		autocommit: true
	},
	'qiraat': {
		ordinal: 47,
		shortName_en: "Qira'at",
		shortName: 'القِرَاءَاتُ',
		name_en: "al-Jadwal fi Qira'at al-Quran",
		name: 'الجَدْوَلُ فِي قِرَاءَاتِ القُرْآنِ',
		author_en: 'Mahmud Safi',
		author: 'مَحْمُودُ بْنُ عَبْدِ الرَّحِيمِ صَافِي',
		description: 'A Quranic readings companion focused on qiraat rather than full tafsir. It helps identify variant recitations and their placement, making it useful for readers studying recitational differences alongside the text.',
		aqidah: 'Sunni, not firmly classified',
		lang: 'ar',
		format: 'md',
		file: 'data/qiraat.json',
		column: 'text',
		sourceFormat: 'html'
	},
	'saadi': {
		ordinal: 32,
		shortName_en: 'Saadi',
		shortName: 'السَّعْدِيّ',
		name_en: 'Taysir al-Karim al-Rahman fi Tafsir Kalam al-Mannan',
		name: 'تَيْسِيرُ الكَرِيمِ الرَّحْمَنِ فِي تَفْسِيرِ كَلَامِ المَنَّانِ',
		author_en: 'Abd al-Rahman al-Saadi',
		author: 'عَبْدُ الرَّحْمَنِ بْنُ نَاصِرٍ السَّعْدِيّ',
		description: 'A concise modern tafsir known for clarity, spiritual benefit, sound creed, and practical lessons. It explains the Quran in accessible language while emphasizing tawhid, guidance, and moral transformation.',
		aqidah: 'Athari',
		death: 1376,
		lang: 'ar',
		format: 'md',
		file: 'data/saadi.json',
		column: 'text',
		sourceFormat: 'html'
	}
};
const options = readOptions(process.argv.slice(2));

(async () => {
	const connection = await getConnection();
	try {
		const quran = await loadQuranAyahs(connection);
		for (const alias of options.aliases)
			await importTafsir(connection, alias, quran);
	} catch (err) {
		console.error(`ERROR: ${err.message}`);
		process.exitCode = 1;
	} finally {
		connection.release();
		await endPool();
	}
})();

function endPool() {
	return new Promise(resolve => {
		global.dbPool.end(err => {
			if (err)
				console.error(`WARN: MySQL pool shutdown failed: ${err.message}`);
			resolve();
		});
	});
}

async function importTafsir(connection, alias, quran) {
	const config = TAFSIRS[alias];
	let passages = loadPassages(config, quran);
	console.log(`${options.dryRun ? 'Checking' : 'Loading'} ${passages.length} '${alias}' passages...`);
	if (options.dryRun)
		return;
	if (config.autocommit)
		return await importTafsirAutocommit(alias, config, passages);

	await query(connection, 'START TRANSACTION');
	try {
		const bookId = await upsertCommentary(connection, alias, config);
		passages = await filterAlreadyLoadedPassages(connection, bookId, passages, alias);
		const batchSize = config.batchSize || 250;
		for (let offset = 0; offset < passages.length; offset += batchSize) {
			await upsertPassages(connection, bookId, passages.slice(offset, offset + batchSize));
			if (config.batchSize)
				console.log(`Loaded ${Math.min(offset + batchSize, passages.length)}/${passages.length} '${alias}' passages...`);
		}
		await query(connection, 'COMMIT');
		console.log(`Loaded '${alias}'.`);
	} catch (err) {
		await query(connection, 'ROLLBACK');
		throw err;
	}
}

async function importTafsirAutocommit(alias, config, passages) {
	const connection = await getConnection();
	try {
		const bookId = await upsertCommentary(connection, alias, config);
		passages = await filterAlreadyLoadedPassages(connection, bookId, passages, alias);
		const batchSize = config.batchSize || 250;
		for (let offset = 0; offset < passages.length; offset += batchSize) {
			await upsertPassages(connection, bookId, passages.slice(offset, offset + batchSize));
			if (config.batchSize)
				console.log(`Loaded ${Math.min(offset + batchSize, passages.length)}/${passages.length} '${alias}' passages...`);
		}
	} finally {
		connection.release();
	}
	console.log(`Loaded '${alias}'.`);
}

async function filterAlreadyLoadedPassages(connection, bookId, passages, alias) {
	const rows = await query(connection, `
		SELECT surah, ayahFrom
		FROM hadiths_commentary
		WHERE bookId=${bookId}
			AND text IS NOT NULL
			AND text <> ''`);
	const loaded = new Set(rows.map(row => `${row.surah}:${row.ayahFrom}`));
	const pending = passages.filter(passage => !loaded.has(`${passage.surah}:${passage.ayah}`));
	if (loaded.size)
		console.log(`Skipping ${passages.length - pending.length}/${passages.length} already loaded '${alias}' passage(s).`);
	return pending;
}

async function loadQuranAyahs(connection) {
	const rows = await query(connection, `
		SELECT id, num, body_en
		FROM hadiths
		WHERE bookId=0
			AND num REGEXP '^[0-9]+:[1-9][0-9]*$'`);
	const quran = new Map(rows.map(row => [row.num, row]));
	if (quran.size !== 6236)
		throw new Error(`Expected 6236 Quran āyāt, found ${quran.size}.`);
	return quran;
}

function loadPassages(config, quran) {
	if (config.files)
		return loadPairedPassages(config, quran);
	if (config.file)
		return loadSingleRefPassages(config, quran);
	const directory = path.resolve(__dirname, '../..', config.directory);
	const passages = [];
	const seen = new Set();
	for (let surah = 1; surah <= 114; surah++) {
		const filename = path.join(directory, `${surah}.json`);
		const document = JSON.parse(fs.readFileSync(filename, 'utf8'));
		if (!Array.isArray(document.ayahs))
			throw new Error(`${filename} does not contain an "ayahs" array.`);
		for (const ayah of document.ayahs) {
			const ref = `${surah}:${ayah.ayah}`;
			const quranAyah = quran.get(ref);
			if (!quranAyah)
				throw new Error(`Quran ayah '${ref}' was not found.`);
			if (ayah.surah !== surah || !Number.isInteger(ayah.ayah) || ayah.ayah < 1)
				throw new Error(`Invalid ayah in ${filename}: ${JSON.stringify(ayah)}`);
			if (seen.has(ref))
				throw new Error(`Duplicate ayah '${ref}' in ${filename}.`);
			seen.add(ref);
			passages.push({
				hadithId: quranAyah.id,
				surah,
				ayah: ayah.ayah,
				text_en: plainTextToMarkdown([quranAyah.body_en, ayah.text].filter(Boolean).join('\n\n')),
				text: null
			});
		}
	}
	if (passages.length !== quran.size)
		throw new Error(`Expected ${quran.size} passages in '${config.directory}', found ${passages.length}.`);
	return passages;
}

function loadSingleRefPassages(config, quran) {
	const source = loadRefMap(config.file);
	const passages = [];
	for (const [ref, quranAyah] of quran.entries()) {
		const location = parseRef(ref);
		const text = resolveRefText(source, ref, config.file, [], config.sourceFormat === 'html');
		const passage = {
			hadithId: quranAyah.id,
			surah: location.surah,
			ayah: location.ayah,
			text: null,
			text_en: null
		};
		passage[config.column || 'text'] = commentarySourceToMarkdown(text, config);
		passages.push(passage);
	}
	if (passages.length !== quran.size)
		throw new Error(`Expected ${quran.size} passages in '${config.file}', found ${passages.length}.`);
	return passages;
}

function loadPairedPassages(config, quran) {
	const english = loadRefMap(config.files.en);
	const arabic = loadRefMap(config.files.ar);
	const passages = [];
	for (const [ref, quranAyah] of quran.entries()) {
		const location = parseRef(ref);
		const englishText = resolveRefText(english, ref, config.files.en);
		const arabicText = resolveRefText(arabic, ref, config.files.ar);
		passages.push({
			hadithId: quranAyah.id,
			surah: location.surah,
			ayah: location.ayah,
			text_en: plainTextToMarkdown([quranAyah.body_en, englishText].filter(Boolean).join('\n\n')),
			text: plainTextToMarkdown(arabicText)
		});
	}
	if (passages.length !== quran.size)
		throw new Error(`Expected ${quran.size} passages in paired tafsir files, found ${passages.length}.`);
	return passages;
}

function loadRefMap(relativeFile) {
	const filename = path.resolve(__dirname, '../..', relativeFile);
	const document = JSON.parse(fs.readFileSync(filename, 'utf8'));
	if (!document || Array.isArray(document) || typeof document !== 'object')
		throw new Error(`${filename} must contain a reference keyed object.`);
	if (Object.keys(document).length !== 6236)
		throw new Error(`${filename} must contain 6236 ayah references.`);
	return document;
}

function resolveRefText(map, ref, sourceFile, stack = [], preserveHtml = false) {
	const value = map[ref];
	if (typeof value === 'string') {
		if (stack.includes(ref))
			throw new Error(`Circular reference in ${sourceFile}: ${stack.concat(ref).join(' -> ')}`);
		return resolveRefText(map, value, sourceFile, stack.concat(ref), preserveHtml);
	}
	if (value && typeof value === 'object' && Object.keys(value).length === 0)
		return '';
	if (!value || typeof value.text !== 'string')
		throw new Error(`${sourceFile} does not contain text for '${ref}'.`);
	return preserveHtml ? value.text.trim() : htmlToText(value.text);
}

function parseRef(ref) {
	const match = /^([0-9]+):([0-9]+)$/.exec(ref);
	if (!match)
		throw new Error(`Invalid Quran reference '${ref}'.`);
	return { surah: Number(match[1]), ayah: Number(match[2]) };
}

async function upsertCommentary(connection, alias, config) {
	config = await hydrateCommentaryConfig(connection, alias, config);
	await query(connection, `
		INSERT INTO books
			(ordinal, alias, type, shortName_en, shortName, hidden, source, lang, format, name_en, author_en, title, author, death, description, aqidah)
		VALUES
			(${config.ordinal}, ${MySQL.escape(alias)}, 'tafsir', ${MySQL.escape(config.shortName_en)}, ${MySQL.escape(config.shortName || null)},
				0, 'local', ${MySQL.escape(config.lang || 'en')}, ${MySQL.escape(config.format || 'md')},
				${MySQL.escape(config.name_en)}, ${MySQL.escape(config.author_en)},
				${MySQL.escape(config.name || null)}, ${MySQL.escape(config.author || null)}, ${MySQL.escape(config.death || null)},
				${MySQL.escape(commentaryDescription(config))}, ${MySQL.escape(config.aqidah || null)})
		ON DUPLICATE KEY UPDATE
			ordinal=VALUES(ordinal),
			type=VALUES(type),
			shortName_en=VALUES(shortName_en),
			shortName=VALUES(shortName),
			hidden=VALUES(hidden),
			source=VALUES(source),
			lang=VALUES(lang),
			format=VALUES(format),
			name_en=VALUES(name_en),
			author_en=VALUES(author_en),
			title=VALUES(title),
			author=VALUES(author),
			death=VALUES(death),
			description=VALUES(description),
			aqidah=VALUES(aqidah)`);
	const rows = await query(connection, `
		SELECT id
		FROM books
		WHERE alias=${MySQL.escape(alias)}
			AND source='local'
			AND type='tafsir'
		LIMIT 1`);
	if (rows.length !== 1)
		throw new Error(`Local commentary '${alias}' was not found after upsert.`);
	return rows[0].id;
}

async function hydrateCommentaryConfig(connection, alias, config) {
	const rows = await query(connection, `
		SELECT ordinal, shortName_en, shortName, lang, format, name_en, author_en, title, author, death, description, aqidah
		FROM books
		WHERE alias=${MySQL.escape(alias)}
			AND type='tafsir'
		LIMIT 1`);
	if (!rows.length)
		return config;
	const row = rows[0];
	const hydrated = Object.assign({}, config);
	for (const key of ['ordinal', 'shortName_en', 'shortName', 'lang', 'format', 'name_en', 'author_en', 'author', 'death', 'description', 'aqidah']) {
		if (hydrated[key] === undefined || hydrated[key] === null || hydrated[key] === '')
			hydrated[key] = row[key];
	}
	if (hydrated.name === undefined || hydrated.name === null || hydrated.name === '')
		hydrated.name = row.title;
	return hydrated;
}

function commentaryDescription(config) {
	var description = (config.description || '').trim();
	if (!description)
		return null;
	description = description.replace(/^Full title:\s*.*?\.\s*/u, '');
	var title = [config.name_en, config.name ? `(${config.name})` : ''].filter(Boolean).join(' ').trim();
	return title ? `Full title: ${title}. ${description}` : description;
}

async function upsertPassages(connection, bookId, passages) {
	const values = passages.map(passage => `(
		${bookId},
		${passage.hadithId},
		${passage.surah},
		${passage.ayah},
		${passage.ayah},
		${passage.ayah},
		${MySQL.escape(passage.text)},
		${MySQL.escape(passage.text_en)}
	)`).join(',\n');
	await query(connection, `
		INSERT INTO hadiths_commentary
			(bookId, hadithId, surah, ayahFrom, ayahTo, passageNum, text, text_en)
		VALUES ${values}
		ON DUPLICATE KEY UPDATE
			hadithId=VALUES(hadithId),
			passageNum=VALUES(passageNum),
			text=VALUES(text),
			text_en=VALUES(text_en)`);
}

function getConnection() {
	return new Promise((resolve, reject) => {
		global.dbPool.getConnection((err, connection) => err ? reject(err) : resolve(connection));
	});
}

function query(connection, sql) {
	if (!connection)
		return global.query(sql);
	return new Promise((resolve, reject) => {
		connection.query({ sql, timeout: 600000 }, (err, result) => err ? reject(err) : resolve(result));
	});
}

function plainTextToMarkdown(text) {
	return normalizeMarkdownSource(text)
		.split('\n\n')
		.map(escapeMarkdownLiterals)
		.join('\n\n');
}

function commentarySourceToMarkdown(text, config) {
	if (config.format === 'html')
		return text;
	if (config.sourceFormat === 'html')
		return htmlToMarkdown(text);
	return plainTextToMarkdown(text);
}

function htmlToMarkdown(html) {
	const $ = cheerio.load(html, { decodeEntities: true }, false);
	const blocks = [];
	const rootNodes = $('body').length ? $('body').contents().toArray() : $.root().contents().toArray();
	for (const node of rootNodes)
		collectMarkdownBlocks($, node, blocks);
	return blocks.map(block => block.trim()).filter(Boolean).join('\n\n');
}

function normalizeMarkdownSource(text) {
	return (text || '').toString()
		.replace(/\r\n?/g, '\n')
		.split(/\n+/)
		.map(line => line.trim())
		.filter(Boolean)
		.join('\n\n');
}

function collectMarkdownBlocks($, node, blocks) {
	if (!node)
		return;
	if (node.type === 'text') {
		const text = normalizeMarkdownSource(node.data || '')
			.split('\n\n')
			.map(escapeMarkdownLiterals)
			.join('\n\n');
		if (text)
			blocks.push(text);
		return;
	}
	const name = (node.name || '').toLowerCase();
	if (name === 'p') {
		const text = renderMarkdownInline($, $(node).contents().toArray()).trim();
		if (text)
			blocks.push(text);
		return;
	}
	const heading = /^h([1-6])$/.exec(name);
	if (heading) {
		const text = renderMarkdownInline($, $(node).contents().toArray()).trim();
		if (text)
			blocks.push(`${'#'.repeat(Number(heading[1]))} ${text}`);
		return;
	}
	if (name === 'br') {
		blocks.push('');
		return;
	}
	for (const child of $(node).contents().toArray())
		collectMarkdownBlocks($, child, blocks);
}

function renderMarkdownInline($, nodes) {
	return nodes.map(node => {
		if (node.type === 'text')
			return escapeMarkdownLiterals(node.data || '');
		const name = (node.name || '').toLowerCase();
		if (name === 'br')
			return '\n';
		const content = renderMarkdownInline($, $(node).contents().toArray());
		if ((name === 'b' || name === 'strong') && content.trim())
			return `**${content.trim()}**`;
		return content;
	}).join('').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n');
}

function escapeMarkdownLiterals(text) {
	return (text || '').toString().replace(/([`*[\]])/g, '\\$1');
}

function htmlToText(text) {
	return text
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.trim();
}

function readOptions(argv) {
	const aliases = [];
	let dryRun = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--tafsir') {
			const alias = argv[++i];
			if (!TAFSIRS[alias])
				throw new Error(`Unknown tafsir '${alias || ''}'.`);
			aliases.push(alias);
		} else if (arg === '--dry-run')
			dryRun = true;
		else if (arg === '--help' || arg === '-h') {
			console.log(usage());
			process.exit(0);
		} else
			throw new Error(`Unknown option '${arg}'.\n\n${usage()}`);
	}
	return { aliases: aliases.length ? aliases : Object.keys(TAFSIRS), dryRun };
}

function usage() {
	return [
		'Usage: node bin/utils/load-local-tafsir-json.js [options]',
		'',
		'Loads bundled Quran.com tafsir JSON into local commentary rows.',
		'Each ayah stores the Quran translation first, followed by the commentary.',
		'',
		'Options:',
		'  --tafsir <alias>  Load only one configured local tafsir',
		'  --dry-run         Validate source files without changing MySQL',
		'  --help            Show this help'
	].join('\n');
}
