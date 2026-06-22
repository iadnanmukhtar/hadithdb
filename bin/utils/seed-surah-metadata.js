/* jslint node:true, esversion:9 */
'use strict';

/**
 * One-time migration: seed surah metadata into the `toc` table.
 *
 * For each of the 114 quran surahs, this overwrites the quran book's level-1
 * heading row (h1 = surah number) with:
 *   - title         = diacritized (vocalized) Arabic name      e.g. الْفَاتِحَة
 *   - title_en      = diacritized English transliteration       e.g. al-Fātiḥah
 *   - surah_ayahs   = ayah count
 *   - surah_revelation = 'makki' | 'madani'
 *   - surah_aliases = JSON array of search aliases
 *
 * This replaces the retired lib/Surahs.json. The dataset is embedded below so
 * the script is fully self-contained (no JSON dependency).
 *
 * Prerequisites: run data/2026-06-21-add-surah-metadata-to-toc.sql first.
 * Usage: node bin/utils/seed-surah-metadata.js
 *
 * The data source is the in-memory surah cache built from this table afterwards,
 * so once seeded + reindexed, lib/Surahs.json can be deleted.
 */

require('../../lib/Globals');

const SURAHS = [
  { num: 1, name_ar: 'الْفَاتِحَة', name_en: 'al-Fātiḥah', ayahs: 7, revelation: 'makki', aliases: ['faithah', 'al_faithah', 'al-faithah', 'al faithah', 'Al-Fatihah', 'al_fatihah', 'al-fatihah', 'al fatihah', 'fatihah', 'الفاتحة', 'فاتحة', 'faatihah', 'faatiha', 'faitha', 'al_faitha', 'al-faitha', 'al faitha', 'Al-Fatiha', 'al_fatiha', 'al-fatiha', 'al fatiha', 'fatiha'] },
  { num: 2, name_ar: 'الْبَقَرَة', name_en: 'al-Baqarah', ayahs: 286, revelation: 'madani', aliases: ['baqarah', 'al_baqarah', 'al-baqarah', 'al baqarah', 'Al-Baqarah', 'البقرة', 'بقرة', 'baqara', 'al_baqara', 'al-baqara', 'al baqara', 'Al-Baqara'] },
  { num: 3, name_ar: 'آل عِمْرَان', name_en: 'Āl ʿImrān', ayahs: 200, revelation: 'madani', aliases: ['al_imran', 'al-imran', 'al imran', 'aal e imraan', 'aal i imraan', 'imran', "Ali 'Imran", 'ali_imran', 'ali-imran', 'ali imran', 'al_ali_imran', 'al-ali_imran', 'al ali_imran', 'آل عمران', 'aal imran', 'aal-imran', 'aal_imran', 'aali imran', 'aali-imran', 'aali_imran'] },
  { num: 4, name_ar: 'النِّسَاء', name_en: 'an-Nisāʾ', ayahs: 176, revelation: 'madani', aliases: ['nisa', 'nisaa', 'al_nisa', 'al-nisa', 'al nisa', 'An-Nisa', 'an_nisa', 'an-nisa', 'an nisa', 'النساء', 'نساء'] },
  { num: 5, name_ar: 'الْمَائِدَة', name_en: 'al-Māʾidah', ayahs: 120, revelation: 'madani', aliases: ['maidah', 'al_maidah', 'al-maidah', 'al maidah', "Al-Ma'idah", 'المائدة', 'مائدة', 'maaidah', "maa'idah", 'maida', 'al_maida', 'al-maida', 'al maida', "Al-Ma'ida", 'maaida', "maa'ida"] },
  { num: 6, name_ar: 'الْأَنْعَام', name_en: 'al-Anʿām', ayahs: 165, revelation: 'makki', aliases: ['anam', 'al_anam', 'al-anam', 'al anam', "Al-An'am", 'الأنعام', 'أنعام', 'anaam', "an'aam"] },
  { num: 7, name_ar: 'الْأَعْرَاف', name_en: 'al-Aʿrāf', ayahs: 206, revelation: 'makki', aliases: ['araf', "a'raf", "a'raaf", 'araaf', "a'raaf", 'al_araf', 'al-araf', 'al araf', "Al-A'raf", 'الأعراف', 'أعراف'] },
  { num: 8, name_ar: 'الْأَنْفَال', name_en: 'al-Anfāl', ayahs: 75, revelation: 'madani', aliases: ['anfal', 'anfaal', 'al_anfal', 'al-anfal', 'al anfal', 'Al-Anfal', 'الأنفال', 'أنفال'] },
  { num: 9, name_ar: 'التَّوْبَة', name_en: 'at-Tawbah', ayahs: 129, revelation: 'madani', aliases: ['tawbah', 'al_tawbah', 'al-tawbah', 'al tawbah', 'At-Tawbah', 'at_tawbah', 'at-tawbah', 'at tawbah', 'التوبة', 'توبة', 'tawba', 'al_tawba', 'al-tawba', 'al tawba', 'At-Tawba', 'at_tawba', 'at-tawba', 'at tawba'] },
  { num: 10, name_ar: 'يُونُس', name_en: 'Yūnus', ayahs: 109, revelation: 'makki', aliases: ['yunus', 'al_yunus', 'al-yunus', 'al yunus', 'Yunus', 'يونس', 'yuunus', 'yoonus', 'yoonas'] },
  { num: 11, name_ar: 'هُود', name_en: 'Hūd', ayahs: 123, revelation: 'makki', aliases: ['hud', 'al_hud', 'al-hud', 'al hud', 'Hud', 'هود', 'huud', 'hood', 'al hood', 'al-hood', 'al_hood'] },
  { num: 12, name_ar: 'يُوسُف', name_en: 'Yūsuf', ayahs: 111, revelation: 'makki', aliases: ['yusuf', 'al_yusuf', 'al-yusuf', 'al yusuf', 'Yusuf', 'يوسف', 'yuusuf', 'yoosuf', 'al yoosuf', 'al-yoosuf', 'al_yoosuf'] },
  { num: 13, name_ar: 'الرَّعْد', name_en: 'ar-Raʿd', ayahs: 43, revelation: 'madani', aliases: ['rad', 'raad', 'al_rad', 'al-rad', 'al rad', "ar-ra'd", 'ar_rad', 'ar-rad', 'ar rad', 'الرعد', 'رعد', "ra'd"] },
  { num: 14, name_ar: 'إِبْرَاهِيم', name_en: 'Ibrāhīm', ayahs: 52, revelation: 'makki', aliases: ['ibrahim', 'al_ibrahim', 'al-ibrahim', 'al ibrahim', 'Ibrahim', 'إبراهيم', 'ibraahiim', 'ibraheem'] },
  { num: 15, name_ar: 'الْحِجْر', name_en: 'al-Ḥijr', ayahs: 99, revelation: 'makki', aliases: ['hijr', 'hijar', 'al_hijr', 'al-hijr', 'al hijr', 'Al-Hijr', 'الحجر', 'حجر'] },
  { num: 16, name_ar: 'النَّحْل', name_en: 'an-Naḥl', ayahs: 128, revelation: 'makki', aliases: ['nahl', 'nahal', 'al_nahl', 'al-nahl', 'al nahl', 'An-Nahl', 'an_nahl', 'an-nahl', 'an nahl', 'النحل', 'نحل'] },
  { num: 17, name_ar: 'الْإِسْرَاء', name_en: 'al-Isrāʾ', ayahs: 111, revelation: 'makki', aliases: ['isra', 'al_isra', 'al-isra', 'al isra', 'Al-Isra', 'الإسراء', 'إسراء', 'israa'] },
  { num: 18, name_ar: 'الْكَهْف', name_en: 'al-Kahf', ayahs: 110, revelation: 'makki', aliases: ['kahf', 'kahaf', 'al_kahf', 'al-kahf', 'al kahf', 'Al-Kahf', 'الكهف', 'كهف'] },
  { num: 19, name_ar: 'مَرْيَم', name_en: 'Maryam', ayahs: 98, revelation: 'makki', aliases: ['maryam', 'mariam', 'mariyam', 'maryum', 'mariyum', 'al_maryam', 'al-maryam', 'al maryam', 'Maryam', 'مريم'] },
  { num: 20, name_ar: 'طٰهٰ', name_en: 'Ṭā Hā', ayahs: 135, revelation: 'makki', aliases: ['ta-ha', 'ta_ha', 'ta ha', 'al_ta_ha', 'al-ta_ha', 'al ta_ha', 'Ta-Ha', 'طه', 'taa haa', 'taa-haa', 'taa_haa', 'taa ha', 'taa-ha', 'taa_ha', 'ta haa', 'ta-haa', 'ta_haa'] },
  { num: 21, name_ar: 'الْأَنْبِيَاء', name_en: 'al-Anbiyāʾ', ayahs: 112, revelation: 'makki', aliases: ['anbiya', 'ambiya', 'ambiyaa', 'al_anbiya', 'al-anbiya', 'al anbiya', 'Al-Anbiya', 'الأنبياء', 'أنبياء', 'anbiyaa'] },
  { num: 22, name_ar: 'الْحَجّ', name_en: 'al-Ḥajj', ayahs: 78, revelation: 'madani', aliases: ['hajj', 'al_hajj', 'al-hajj', 'al hajj', 'Al-Hajj', 'الحج', 'حج'] },
  { num: 23, name_ar: 'الْمُؤْمِنُون', name_en: 'al-Muʾminūn', ayahs: 118, revelation: 'makki', aliases: ['muminun', 'al_muminun', 'al-muminun', 'al muminun', "Al-Mu'minun", 'المؤمنون', 'مؤمنون', 'muminuun', "mu'minuun", 'muminoon', "mu'minoon", 'al muminoon', 'al-muminoon', 'al_muminoon', "al mu'minoon", "al-mu'minoon", "al_mu'minoon"] },
  { num: 24, name_ar: 'النُّور', name_en: 'an-Nūr', ayahs: 64, revelation: 'madani', aliases: ['nur', 'al_nur', 'al-nur', 'al nur', 'An-Nur', 'an_nur', 'an-nur', 'an nur', 'النور', 'نور', 'nuur', 'noor', 'an noor', 'an-noor', 'an_noor'] },
  { num: 25, name_ar: 'الْفُرْقَان', name_en: 'al-Furqān', ayahs: 77, revelation: 'makki', aliases: ['furqan', 'al_furqan', 'al-furqan', 'al furqan', 'Al-Furqan', 'الفرقان', 'فرقان', 'furqaan'] },
  { num: 26, name_ar: 'الشُّعَرَاء', name_en: 'ash-Shuʿarāʾ', ayahs: 227, revelation: 'makki', aliases: ['shuara', 'al_shuara', 'al-shuara', 'al shuara', "Ash-Shu'ara", 'ash_shuara', 'ash-shuara', 'ash shuara', 'الشعراء', 'شعراء', 'shuaraa', "shu'araa"] },
  { num: 27, name_ar: 'النَّمْل', name_en: 'an-Naml', ayahs: 93, revelation: 'makki', aliases: ['naml', 'namal', 'al_naml', 'al-naml', 'al naml', 'An-Naml', 'an_naml', 'an-naml', 'an naml', 'النمل', 'نمل'] },
  { num: 28, name_ar: 'الْقَصَص', name_en: 'al-Qaṣaṣ', ayahs: 88, revelation: 'makki', aliases: ['qasas', 'al_qasas', 'al-qasas', 'al qasas', 'Al-Qasas', 'القصص', 'قصص'] },
  { num: 29, name_ar: 'الْعَنْكَبُوت', name_en: 'al-ʿAnkabūt', ayahs: 69, revelation: 'makki', aliases: ['ankabut', 'al_ankabut', 'al-ankabut', 'al ankabut', 'Al-Ankabut', 'العنكبوت', 'عنكبوت', 'ankabuut', 'ankaboot', 'al ankaboot', 'al-ankaboot', 'al_ankaboot'] },
  { num: 30, name_ar: 'الرُّوم', name_en: 'ar-Rūm', ayahs: 60, revelation: 'makki', aliases: ['rum', 'al_rum', 'al-rum', 'al rum', 'Ar-Rum', 'ar_rum', 'ar-rum', 'ar rum', 'الروم', 'روم', 'ruum', 'room', 'ar room', 'ar-room', 'ar_room'] },
  { num: 31, name_ar: 'لُقْمَان', name_en: 'Luqmān', ayahs: 34, revelation: 'makki', aliases: ['luqman', 'al_luqman', 'al-luqman', 'al luqman', 'Luqman', 'لقمان', 'luqmaan'] },
  { num: 32, name_ar: 'السَّجْدَة', name_en: 'as-Sajdah', ayahs: 30, revelation: 'makki', aliases: ['sajdah', 'al_sajdah', 'al-sajdah', 'al sajdah', 'As-Sajdah', 'as_sajdah', 'as-sajdah', 'as sajdah', 'السجدة', 'سجدة', 'sajda', 'al_sajda', 'al-sajda', 'al sajda', 'As-Sajda', 'as_sajda', 'as-sajda', 'as sajda'] },
  { num: 33, name_ar: 'الْأَحْزَاب', name_en: 'al-Aḥzāb', ayahs: 73, revelation: 'madani', aliases: ['ahzab', 'al_ahzab', 'al-ahzab', 'al ahzab', 'Al-Ahzab', 'الأحزاب', 'أحزاب', 'ahzaab'] },
  { num: 34, name_ar: 'سَبَأ', name_en: 'Sabaʾ', ayahs: 54, revelation: 'makki', aliases: ['saba', 'al_saba', 'al-saba', 'al saba', 'Saba', 'سبأ'] },
  { num: 35, name_ar: 'فَاطِر', name_en: 'Fāṭir', ayahs: 45, revelation: 'makki', aliases: ['fatir', 'al_fatir', 'al-fatir', 'al fatir', 'Fatir', 'فاطر', 'faatir'] },
  { num: 36, name_ar: 'يٰسٓ', name_en: 'Yā Sīn', ayahs: 83, revelation: 'makki', aliases: ['ya-sin', 'ya_sin', 'ya sin', 'al_ya_sin', 'al-ya_sin', 'al ya_sin', 'Ya-Sin', 'يس', 'ya seen', 'ya-seen', 'ya_seen', 'yaa siin', 'yaa-siin', 'yaa_siin', 'yaa seen', 'yaa-seen', 'yaa_seen', 'ya siin', 'ya-siin', 'ya_siin'] },
  { num: 37, name_ar: 'الصَّافَّات', name_en: 'aṣ-Ṣāffāt', ayahs: 182, revelation: 'makki', aliases: ['saffat', 'al_saffat', 'al-saffat', 'al saffat', 'As-Saffat', 'as_saffat', 'as-saffat', 'as saffat', 'الصافات', 'صافات', 'saaffaat', 'safat', 'saafaat'] },
  { num: 38, name_ar: 'صٓ', name_en: 'Ṣād', ayahs: 88, revelation: 'makki', aliases: ['sad', 'al_sad', 'al-sad', 'al sad', 'Sad', 'ص', 'saad'] },
  { num: 39, name_ar: 'الزُّمَر', name_en: 'az-Zumar', ayahs: 75, revelation: 'makki', aliases: ['zumar', 'al_zumar', 'al-zumar', 'al zumar', 'Az-Zumar', 'az_zumar', 'az-zumar', 'az zumar', 'الزمر', 'زمر'] },
  { num: 40, name_ar: 'غَافِر', name_en: 'Ghāfir', ayahs: 85, revelation: 'makki', aliases: ['ghafir', 'al_ghafir', 'al-ghafir', 'al ghafir', 'Ghafir', 'غافر', 'ghaafir'] },
  { num: 41, name_ar: 'فُصِّلَت', name_en: 'Fuṣṣilat', ayahs: 54, revelation: 'makki', aliases: ['fussilat', 'fusilat', 'al_fussilat', 'al-fussilat', 'al fussilat', 'Fussilat', 'فصلت', 'haa meem sajdah', 'ha mim sajda', 'ha meem sajda'] },
  { num: 42, name_ar: 'الشُّورَىٰ', name_en: 'ash-Shūrā', ayahs: 53, revelation: 'makki', aliases: ['shura', 'al_shura', 'al-shura', 'al shura', 'Ash-Shura', 'ash_shura', 'ash-shura', 'ash shura', 'الشورى', 'شورى', 'shuuraa', 'shoora'] },
  { num: 43, name_ar: 'الزُّخْرُف', name_en: 'az-Zukhruf', ayahs: 89, revelation: 'makki', aliases: ['zukhruf', 'al_zukhruf', 'al-zukhruf', 'al zukhruf', 'Az-Zukhruf', 'az_zukhruf', 'az-zukhruf', 'az zukhruf', 'الزخرف', 'زخرف'] },
  { num: 44, name_ar: 'الدُّخَان', name_en: 'ad-Dukhān', ayahs: 59, revelation: 'makki', aliases: ['dukhkhan', 'al_dukhkhan', 'al-dukhkhan', 'al dukhkhan', 'Ad-Dukhan', 'ad_dukhan', 'ad-dukhan', 'ad dukhan', 'dukhan', 'al_dukhan', 'al-dukhan', 'al dukhan', 'الدخان', 'دخان', 'dukhaan', 'dukhkhaan'] },
  { num: 45, name_ar: 'الْجَاثِيَة', name_en: 'al-Jāthiyah', ayahs: 37, revelation: 'makki', aliases: ['jathiyah', 'jaathiyah', 'al_jathiyah', 'al-jathiyah', 'al jathiyah', 'Al-Jathiyah', 'الجاثية', 'جاثية', 'jaathiyah', 'jathiya', 'al_jathiya', 'al-jathiya', 'al jathiya', 'Al-Jathiya', 'jaathiya'] },
  { num: 46, name_ar: 'الْأَحْقَاف', name_en: 'al-Aḥqāf', ayahs: 35, revelation: 'makki', aliases: ['ahqaf', 'al_ahqaf', 'al-ahqaf', 'al ahqaf', 'Al-Ahqaf', 'الأحقاف', 'أحقاف', 'ahqaaf'] },
  { num: 47, name_ar: 'مُحَمَّد', name_en: 'Muḥammad', ayahs: 38, revelation: 'madani', aliases: ['muhammad', 'al_muhammad', 'al-muhammad', 'al muhammad', 'Muhammad', 'محمد', 'mohamad', 'mohammad'] },
  { num: 48, name_ar: 'الْفَتْح', name_en: 'al-Fatḥ', ayahs: 29, revelation: 'madani', aliases: ['fath', 'fatah', 'al_fath', 'al-fath', 'al fath', 'Al-Fath', 'الفتح', 'فتح'] },
  { num: 49, name_ar: 'الْحُجُرَات', name_en: 'al-Ḥujurāt', ayahs: 18, revelation: 'madani', aliases: ['hujurat', 'al_hujurat', 'al-hujurat', 'al hujurat', 'Al-Hujurat', 'الحجرات', 'حجرات', 'hujuraat'] },
  { num: 50, name_ar: 'قٓ', name_en: 'Qāf', ayahs: 45, revelation: 'makki', aliases: ['qaf', 'al_qaf', 'al-qaf', 'al qaf', 'Qaf', 'ق', 'qaaf'] },
  { num: 51, name_ar: 'الذَّارِيَات', name_en: 'adh-Dhāriyāt', ayahs: 60, revelation: 'makki', aliases: ['dhariyat', 'zariyat', 'zaariyaat', 'al_dhariyat', 'al-dhariyat', 'al dhariyat', 'Adh-Dhariyat', 'adh_dhariyat', 'adh-dhariyat', 'adh dhariyat', 'الذاريات', 'ذاريات', 'dhaariyaat'] },
  { num: 52, name_ar: 'الطُّور', name_en: 'aṭ-Ṭūr', ayahs: 49, revelation: 'makki', aliases: ['tur', 'al_tur', 'al-tur', 'al tur', 'At-Tur', 'at_tur', 'at-tur', 'at tur', 'الطور', 'طور', 'tuur', 'toor', 'at toor', 'at-toor', 'at_toor'] },
  { num: 53, name_ar: 'النَّجْم', name_en: 'an-Najm', ayahs: 62, revelation: 'makki', aliases: ['najm', 'najam', 'al_najm', 'al-najm', 'al najm', 'An-Najm', 'an_najm', 'an-najm', 'an najm', 'النجم', 'نجم'] },
  { num: 54, name_ar: 'الْقَمَر', name_en: 'al-Qamar', ayahs: 55, revelation: 'makki', aliases: ['qamar', 'al_qamar', 'al-qamar', 'al qamar', 'Al-Qamar', 'القمر', 'قمر'] },
  { num: 55, name_ar: 'الرَّحْمٰن', name_en: 'ar-Raḥmān', ayahs: 78, revelation: 'madani', aliases: ['rahman', 'rehman', 'rehmaan', 'al_rahman', 'al-rahman', 'al rahman', 'Ar-Rahman', 'ar_rahman', 'ar-rahman', 'ar rahman', 'الرحمن', 'رحمن', 'rahmaan'] },
  { num: 56, name_ar: 'الْوَاقِعَة', name_en: 'al-Wāqiʿah', ayahs: 96, revelation: 'makki', aliases: ['waqiah', 'waqiyah', 'waaqiya', 'waaqiyah', 'al_waqiah', 'al-waqiah', 'al waqiah', "Al-Waqi'ah", 'الواقعة', 'واقعة', 'waaqiah', "waaqi'ah", 'waqia', 'al_waqia', 'al-waqia', 'al waqia', "Al-Waqi'a", 'waaqia', "waaqi'a"] },
  { num: 57, name_ar: 'الْحَدِيد', name_en: 'al-Ḥadīd', ayahs: 29, revelation: 'madani', aliases: ['hadid', 'al_hadid', 'al-hadid', 'al hadid', 'Al-Hadid', 'الحديد', 'حديد', 'hadiid', 'hadeed'] },
  { num: 58, name_ar: 'الْمُجَادِلَة', name_en: 'al-Mujādilah', ayahs: 22, revelation: 'madani', aliases: ['mujadalah', 'al_mujadalah', 'al-mujadalah', 'al mujadalah', 'Al-Mujadilah', 'al_mujadilah', 'al-mujadilah', 'al mujadilah', 'mujadilah', 'المجادلة', 'مجادلة', 'mujaadalah', 'mujadala', 'al_mujadala', 'al-mujadala', 'al mujadala', 'Al-Mujadila', 'al_mujadila', 'al-mujadila', 'al mujadila', 'mujadila', 'mujadilah', 'mujaadilah', 'mujaadila', 'mujaadala'] },
  { num: 59, name_ar: 'الْحَشْر', name_en: 'al-Ḥashr', ayahs: 24, revelation: 'madani', aliases: ['hashr', 'hashar', 'al_hashr', 'al-hashr', 'al hashr', 'Al-Hashr', 'الحشر', 'حشر'] },
  { num: 60, name_ar: 'الْمُمْتَحَنَة', name_en: 'al-Mumtaḥanah', ayahs: 13, revelation: 'madani', aliases: ['mumtahinah', 'al_mumtahinah', 'al-mumtahinah', 'al mumtahinah', 'Al-Mumtahanah', 'al_mumtahanah', 'al-mumtahanah', 'al mumtahanah', 'mumtahanah', 'الممتحنة', 'ممتحنة', 'mumtahina', 'al_mumtahina', 'al-mumtahina', 'al mumtahina', 'Al-Mumtahana', 'al_mumtahana', 'al-mumtahana', 'al mumtahana', 'mumtahana'] },
  { num: 61, name_ar: 'الصَّفّ', name_en: 'aṣ-Ṣaff', ayahs: 14, revelation: 'madani', aliases: ['saff', 'saf', 'al_saff', 'al-saff', 'al saff', 'As-Saff', 'as_saff', 'as-saff', 'as saff', 'الصف', 'صف'] },
  { num: 62, name_ar: 'الْجُمُعَة', name_en: 'al-Jumuʿah', ayahs: 11, revelation: 'madani', aliases: ['jumuah', 'jummah', 'jumma', 'al_jumuah', 'al-jumuah', 'al jumuah', "Al-Jumu'ah", 'الجمعة', 'جمعة', 'jumua', 'al_jumua', 'al-jumua', 'al jumua', "Al-Jumu'a"] },
  { num: 63, name_ar: 'الْمُنَافِقُون', name_en: 'al-Munāfiqūn', ayahs: 11, revelation: 'madani', aliases: ['munafiqun', 'al_munafiqun', 'al-munafiqun', 'al munafiqun', 'Al-Munafiqun', 'المنافقون', 'منافقون', 'munaafiquun', 'munafiqoon', 'al munafiqoon', 'al-munafiqoon', 'al_munafiqoon'] },
  { num: 64, name_ar: 'التَّغَابُن', name_en: 'at-Taghābun', ayahs: 18, revelation: 'madani', aliases: ['taghabun', 'al_taghabun', 'al-taghabun', 'al taghabun', 'At-Taghabun', 'at_taghabun', 'at-taghabun', 'at taghabun', 'التغابن', 'تغابن', 'taghaabun'] },
  { num: 65, name_ar: 'الطَّلَاق', name_en: 'aṭ-Ṭalāq', ayahs: 12, revelation: 'madani', aliases: ['talaq', 'al_talaq', 'al-talaq', 'al talaq', 'At-Talaq', 'at_talaq', 'at-talaq', 'at talaq', 'الطلاق', 'طلاق', 'talaaq'] },
  { num: 66, name_ar: 'التَّحْرِيم', name_en: 'at-Taḥrīm', ayahs: 12, revelation: 'madani', aliases: ['tahrim', 'tehreem', 'al_tahrim', 'al-tahrim', 'al tahrim', 'At-Tahrim', 'at_tahrim', 'at-tahrim', 'at tahrim', 'التحريم', 'تحريم', 'tahriim'] },
  { num: 67, name_ar: 'الْمُلْك', name_en: 'al-Mulk', ayahs: 30, revelation: 'makki', aliases: ['mulk', 'al_mulk', 'al-mulk', 'al mulk', 'Al-Mulk', 'الملك', 'ملك'] },
  { num: 68, name_ar: 'الْقَلَم', name_en: 'al-Qalam', ayahs: 52, revelation: 'makki', aliases: ['qalam', 'al_qalam', 'al-qalam', 'al qalam', 'Al-Qalam', 'القلم', 'قلم'] },
  { num: 69, name_ar: 'الْحَاقَّة', name_en: 'al-Ḥāqqah', ayahs: 52, revelation: 'makki', aliases: ['haqqah', 'al_haqqah', 'al-haqqah', 'al haqqah', 'Al-Haqqah', 'الحاقة', 'حاقة', 'haaqqah', 'haqqa', 'al_haqqa', 'al-haqqa', 'al haqqa', 'Al-Haqqa', 'haaqqa'] },
  { num: 70, name_ar: 'الْمَعَارِج', name_en: 'al-Maʿārij', ayahs: 44, revelation: 'makki', aliases: ['maarij', 'marij', 'al_maarij', 'al-maarij', 'al maarij', "Al-Ma'arij", 'المعارج', 'معارج', "ma'aarij", 'maaarij'] },
  { num: 71, name_ar: 'نُوح', name_en: 'Nūḥ', ayahs: 28, revelation: 'makki', aliases: ['nuh', 'al_nuh', 'al-nuh', 'al nuh', 'Nuh', 'نوح', 'nuuh', 'nooh', 'al nooh', 'al-nooh', 'al_nooh'] },
  { num: 72, name_ar: 'الْجِنّ', name_en: 'al-Jinn', ayahs: 28, revelation: 'makki', aliases: ['jinn', 'jin', 'al_jinn', 'al-jinn', 'al jinn', 'Al-Jinn', 'الجن', 'جن'] },
  { num: 73, name_ar: 'الْمُزَّمِّل', name_en: 'al-Muzzammil', ayahs: 20, revelation: 'makki', aliases: ['muzzammil', 'muzammil', 'al_muzzammil', 'al-muzzammil', 'al muzzammil', 'Al-Muzzammil', 'المزمل', 'مزمل'] },
  { num: 74, name_ar: 'الْمُدَّثِّر', name_en: 'al-Muddaththir', ayahs: 56, revelation: 'makki', aliases: ['muddaththir', 'mudathir', 'al_muddaththir', 'al-muddaththir', 'al muddaththir', 'Al-Muddaththir', 'المدثر', 'مدثر'] },
  { num: 75, name_ar: 'الْقِيَامَة', name_en: 'al-Qiyāmah', ayahs: 40, revelation: 'makki', aliases: ['qiyamah', 'qiama', 'qiamah', 'qiyamat', 'al_qiyamah', 'al-qiyamah', 'al qiyamah', 'Al-Qiyamah', 'القيامة', 'قيامة', 'qiyaamah', 'qiyama', 'al_qiyama', 'al-qiyama', 'al qiyama', 'Al-Qiyama', 'qiyaama'] },
  { num: 76, name_ar: 'الْإِنْسَان', name_en: 'al-Insān', ayahs: 31, revelation: 'madani', aliases: ['insan', 'al_insan', 'al-insan', 'al insan', 'Al-Insan', 'الإنسان', 'إنسان', 'insaan'] },
  { num: 77, name_ar: 'الْمُرْسَلَات', name_en: 'al-Mursalāt', ayahs: 50, revelation: 'makki', aliases: ['mursalat', 'mursilat', 'mursilaat', 'al_mursalat', 'al-mursalat', 'al mursalat', 'Al-Mursalat', 'المرسلات', 'مرسلات', 'mursalaat'] },
  { num: 78, name_ar: 'النَّبَأ', name_en: 'an-Nabaʾ', ayahs: 40, revelation: 'makki', aliases: ['naba', 'al_naba', 'al-naba', 'al naba', 'An-Naba', 'an_naba', 'an-naba', 'an naba', 'النبأ', 'نبأ'] },
  { num: 79, name_ar: 'النَّازِعَات', name_en: 'an-Nāziʿāt', ayahs: 46, revelation: 'makki', aliases: ['naziat', 'naziyat', 'naziyaat', 'al_naziat', 'al-naziat', 'al naziat', "An-Nazi'at", 'an_naziat', 'an-naziat', 'an naziat', 'النازعات', 'نازعات', 'naaziaat', "naazi'aat"] },
  { num: 80, name_ar: 'عَبَس', name_en: 'ʿAbasa', ayahs: 42, revelation: 'makki', aliases: ['abasa', 'al_abasa', 'al-abasa', 'al abasa', 'Abasa', 'عبس'] },
  { num: 81, name_ar: 'التَّكْوِير', name_en: 'at-Takwīr', ayahs: 29, revelation: 'makki', aliases: ['takwir', 'al_takwir', 'al-takwir', 'al takwir', 'At-Takwir', 'at_takwir', 'at-takwir', 'at takwir', 'التكوير', 'تكوير', 'takwiir', 'takweer'] },
  { num: 82, name_ar: 'الْإِنْفِطَار', name_en: 'al-Infiṭār', ayahs: 19, revelation: 'makki', aliases: ['infitar', 'al_infitar', 'al-infitar', 'al infitar', 'Al-Infitar', 'الانفطار', 'انفطار', 'infitaar', 'infatar'] },
  { num: 83, name_ar: 'الْمُطَفِّفِين', name_en: 'al-Muṭaffifīn', ayahs: 36, revelation: 'makki', aliases: ['mutaffifin', 'mutaffin', 'mutaffeen', 'al_mutaffifin', 'al-mutaffifin', 'al mutaffifin', 'Al-Mutaffifin', 'المطففين', 'مطففين', 'mutaffifiin', 'mutaffifeen', 'al mutaffifeen', 'al-mutaffifeen', 'al_mutaffifeen'] },
  { num: 84, name_ar: 'الْإِنْشِقَاق', name_en: 'al-Inshiqāq', ayahs: 25, revelation: 'makki', aliases: ['inshiqaq', 'al_inshiqaq', 'al-inshiqaq', 'al inshiqaq', 'Al-Inshiqaq', 'الانشقاق', 'انشقاق', 'inshiqaaq'] },
  { num: 85, name_ar: 'الْبُرُوج', name_en: 'al-Burūj', ayahs: 22, revelation: 'makki', aliases: ['buruj', 'al_buruj', 'al-buruj', 'al buruj', 'Al-Buruj', 'البروج', 'بروج', 'buruuj', 'burooj', 'al burooj', 'al-burooj', 'al_burooj'] },
  { num: 86, name_ar: 'الطَّارِق', name_en: 'aṭ-Ṭāriq', ayahs: 17, revelation: 'makki', aliases: ['tariq', 'al_tariq', 'al-tariq', 'al tariq', 'At-Tariq', 'at_tariq', 'at-tariq', 'at tariq', 'الطارق', 'طارق', 'taariq'] },
  { num: 87, name_ar: 'الْأَعْلَىٰ', name_en: 'al-Aʿlā', ayahs: 19, revelation: 'makki', aliases: ['ala', 'al_ala', 'al-ala', 'al ala', "Al-A'la", 'الأعلى', 'أعلى', 'alaa', "a'laa"] },
  { num: 88, name_ar: 'الْغَاشِيَة', name_en: 'al-Ghāshiyah', ayahs: 26, revelation: 'makki', aliases: ['ghashiyah', 'al_ghashiyah', 'al-ghashiyah', 'al ghashiyah', 'Al-Ghashiyah', 'الغاشية', 'غاشية', 'ghaashiyah', 'ghashiya', 'al_ghashiya', 'al-ghashiya', 'al ghashiya', 'Al-Ghashiya', 'ghaashiya'] },
  { num: 89, name_ar: 'الْفَجْر', name_en: 'al-Fajr', ayahs: 30, revelation: 'makki', aliases: ['fajr', 'fajar', 'al_fajr', 'al-fajr', 'al fajr', 'Al-Fajr', 'الفجر', 'فجر'] },
  { num: 90, name_ar: 'الْبَلَد', name_en: 'al-Balad', ayahs: 20, revelation: 'makki', aliases: ['balad', 'al_balad', 'al-balad', 'al balad', 'Al-Balad', 'البلد', 'بلد'] },
  { num: 91, name_ar: 'الشَّمْس', name_en: 'ash-Shams', ayahs: 15, revelation: 'makki', aliases: ['shams', 'al_shams', 'al-shams', 'al shams', 'Ash-Shams', 'ash_shams', 'ash-shams', 'ash shams', 'الشمس', 'شمس'] },
  { num: 92, name_ar: 'اللَّيْل', name_en: 'al-Layl', ayahs: 21, revelation: 'makki', aliases: ['layl', 'lail', 'al_layl', 'al-layl', 'al layl', 'Al-Layl', 'الليل', 'ليل'] },
  { num: 93, name_ar: 'الضُّحَىٰ', name_en: 'aḍ-Ḍuḥā', ayahs: 11, revelation: 'makki', aliases: ['dhuha', 'al_dhuha', 'al-dhuha', 'al dhuha', 'Ad-Duha', 'ad_duha', 'ad-duha', 'ad duha', 'duha', 'al_duha', 'al-duha', 'al duha', 'الضحى', 'ضحى', 'duhaa', 'dhuhaa'] },
  { num: 94, name_ar: 'الشَّرْح', name_en: 'ash-Sharḥ', ayahs: 8, revelation: 'makki', aliases: ['inshirah', 'al_inshirah', 'al-inshirah', 'al inshirah', 'Ash-Sharh', 'ash_sharh', 'ash-sharh', 'ash sharh', 'sharh', 'al_sharh', 'al-sharh', 'al sharh', 'الشرح', 'شرح'] },
  { num: 95, name_ar: 'التِّين', name_en: 'at-Tīn', ayahs: 8, revelation: 'makki', aliases: ['tin', 'al_tin', 'al-tin', 'al tin', 'At-Tin', 'at_tin', 'at-tin', 'at tin', 'التين', 'تين', 'tiin', 'teen'] },
  { num: 96, name_ar: 'الْعَلَق', name_en: 'al-ʿAlaq', ayahs: 19, revelation: 'makki', aliases: ['alaq', 'al_alaq', 'al-alaq', 'al alaq', 'Al-Alaq', 'العلق', 'علق'] },
  { num: 97, name_ar: 'الْقَدْر', name_en: 'al-Qadr', ayahs: 5, revelation: 'makki', aliases: ['qadr', 'qadar', 'al_qadr', 'al-qadr', 'al qadr', 'Al-Qadr', 'القدر', 'قدر'] },
  { num: 98, name_ar: 'الْبَيِّنَة', name_en: 'al-Bayyinah', ayahs: 8, revelation: 'madani', aliases: ['bayyinah', 'bayyanah', 'bayyana', 'al_bayyinah', 'al-bayyinah', 'al bayyinah', 'Al-Bayyinah', 'البينة', 'بينة', 'bayyina', 'al_bayyina', 'al-bayyina', 'al bayyina', 'Al-Bayyina'] },
  { num: 99, name_ar: 'الزَّلْزَلَة', name_en: 'az-Zalzalah', ayahs: 8, revelation: 'madani', aliases: ['zilzal', 'al_zilzal', 'al-zilzal', 'al zilzal', 'Az-Zalzalah', 'az_zalzalah', 'az-zalzalah', 'az zalzalah', 'zalzalah', 'al_zalzalah', 'al-zalzalah', 'al zalzalah', 'الزلزلة', 'زلزلة', 'Az-Zalzala', 'az_zalzala', 'az-zalzala', 'az zalzala', 'zalzala', 'al_zalzala', 'al-zalzala', 'al zalzala'] },
  { num: 100, name_ar: 'الْعَادِيَات', name_en: 'al-ʿĀdiyāt', ayahs: 11, revelation: 'makki', aliases: ['adiyat', 'adiat', 'aadiaat', 'al_adiyat', 'al-adiyat', 'al adiyat', 'Al-Adiyat', 'العاديات', 'عاديات', 'aadiyaat'] },
  { num: 101, name_ar: 'الْقَارِعَة', name_en: 'al-Qāriʿah', ayahs: 11, revelation: 'makki', aliases: ['qariah', 'al_qariah', 'al-qariah', 'al qariah', "Al-Qari'ah", 'القارعة', 'قارعة', 'qaariah', "qaari'ah", 'qaria', 'al_qaria', 'al-qaria', 'al qaria', "Al-Qari'a", 'qaaria', "qaari'a"] },
  { num: 102, name_ar: 'التَّكَاثُر', name_en: 'at-Takāthur', ayahs: 8, revelation: 'makki', aliases: ['takathur', 'takasur', 'takaasur', 'al_takathur', 'al-takathur', 'al takathur', 'At-Takathur', 'at_takathur', 'at-takathur', 'at takathur', 'التكاثر', 'تكاثر', 'takaathur'] },
  { num: 103, name_ar: 'الْعَصْر', name_en: 'al-ʿAṣr', ayahs: 3, revelation: 'makki', aliases: ['asr', 'asar', 'al_asr', 'al-asr', 'al asr', 'Al-Asr', 'العصر', 'عصر'] },
  { num: 104, name_ar: 'الْهُمَزَة', name_en: 'al-Humazah', ayahs: 9, revelation: 'makki', aliases: ['humazah', 'al_humazah', 'al-humazah', 'al humazah', 'Al-Humazah', 'الهمزة', 'همزة', 'humaza', 'al_humaza', 'al-humaza', 'al humaza', 'Al-Humaza'] },
  { num: 105, name_ar: 'الْفِيل', name_en: 'al-Fīl', ayahs: 5, revelation: 'makki', aliases: ['fil', 'al_fil', 'al-fil', 'al fil', 'Al-Fil', 'الفيل', 'فيل', 'fiil', 'feel'] },
  { num: 106, name_ar: 'قُرَيْش', name_en: 'Quraysh', ayahs: 4, revelation: 'makki', aliases: ['quraysh', 'quraish', 'al_quraysh', 'al-quraysh', 'al quraysh', 'Quraysh', 'قريش'] },
  { num: 107, name_ar: 'الْمَاعُون', name_en: 'al-Māʿūn', ayahs: 7, revelation: 'makki', aliases: ['maun', 'al_maun', 'al-maun', 'al maun', "Al-Ma'un", 'الماعون', 'ماعون', 'maauun', "maa'uun", 'maoon', "ma'oon", 'al maoon', 'al-maoon', 'al_maoon', "al ma'oon", "al-ma'oon", "al_ma'oon"] },
  { num: 108, name_ar: 'الْكَوْثَر', name_en: 'al-Kawthar', ayahs: 3, revelation: 'makki', aliases: ['kawthar', 'kauthar', 'kausar', 'al_kawthar', 'al-kawthar', 'al kawthar', 'Al-Kawthar', 'الكوثر', 'كوثر'] },
  { num: 109, name_ar: 'الْكَافِرُون', name_en: 'al-Kāfirūn', ayahs: 6, revelation: 'makki', aliases: ['kafirun', 'al_kafirun', 'al-kafirun', 'al kafirun', 'Al-Kafirun', 'الكافرون', 'كافرون', 'kaafiruun', 'kafiroon', 'kaafiroon', 'al kafiroon', 'al-kafiroon', 'al_kafiroon'] },
  { num: 110, name_ar: 'النَّصْر', name_en: 'an-Naṣr', ayahs: 3, revelation: 'madani', aliases: ['nasr', 'nasar', 'al_nasr', 'al-nasr', 'al nasr', 'An-Nasr', 'an_nasr', 'an-nasr', 'an nasr', 'النصر', 'نصر'] },
  { num: 111, name_ar: 'الْمَسَد', name_en: 'al-Masad', ayahs: 5, revelation: 'makki', aliases: ['masad', 'al_masad', 'al-masad', 'al masad', 'Al-Masad', 'المسد', 'مسد'] },
  { num: 112, name_ar: 'الْإِخْلَاص', name_en: 'al-Ikhlāṣ', ayahs: 4, revelation: 'makki', aliases: ['ikhlas', 'al_ikhlas', 'al-ikhlas', 'al ikhlas', 'Al-Ikhlas', 'الإخلاص', 'إخلاص', 'ikhlaas'] },
  { num: 113, name_ar: 'الْفَلَق', name_en: 'al-Falaq', ayahs: 5, revelation: 'makki', aliases: ['falaq', 'al_falaq', 'al-falaq', 'al falaq', 'Al-Falaq', 'الفلق', 'فلق'] },
  { num: 114, name_ar: 'النَّاس', name_en: 'an-Nās', ayahs: 6, revelation: 'makki', aliases: ['nas', 'naas', 'al_nas', 'al-nas', 'al nas', 'An-Nas', 'an_nas', 'an-nas', 'an nas', 'الناس', 'ناس'] }
];

async function main() {
  if (SURAHS.length !== 114)
    throw new Error(`Expected 114 surahs in the dataset, found ${SURAHS.length}`);

  const bookRows = await global.query(`SELECT id FROM books WHERE alias='quran' LIMIT 1`);
  if (!bookRows.length)
    throw new Error(`No book with alias 'quran' found in the books table`);
  const quranBookId = bookRows[0].id;

  let updated = 0;
  const missing = [];
  for (const surah of SURAHS) {
    const result = await global.query(`
      UPDATE toc
      SET title = ${global.dbPool.escape(surah.name_ar)},
          title_en = ${global.dbPool.escape(surah.name_en)},
          surah_ayahs = ${global.dbPool.escape(surah.ayahs)},
          surah_revelation = ${global.dbPool.escape(surah.revelation)},
          surah_aliases = ${global.dbPool.escape(JSON.stringify(surah.aliases))}
      WHERE bookId = ${global.dbPool.escape(quranBookId)} AND level = 1 AND h1 = ${global.dbPool.escape(surah.num)}`);
    if (result && result.affectedRows > 0)
      updated += 1;
    else
      missing.push(surah.num);
  }

  console.log(`Seeded surah metadata for ${updated}/${SURAHS.length} surahs (quran bookId=${quranBookId}).`);
  if (missing.length)
    console.warn(`No matching level-1 toc row for surah(s): ${missing.join(', ')}`);

  global.dbPool.end();
}

main().catch((err) => {
  console.error(err);
  if (global.dbPool && typeof global.dbPool.end === 'function')
    global.dbPool.end();
  process.exit(1);
});
