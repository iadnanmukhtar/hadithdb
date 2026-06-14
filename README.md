# HadithDB

HadithDB is an Express application and database toolkit for browsing, searching, and citing Qurʾān and ḥadīth records. The public site is hosted at <https://hadithunlocked.com>.

The database stores Arabic source text, English translation fields where available, chapter/table-of-contents metadata, grading metadata, and derived search fields. Isnād and matn are split for all ḥadīth records.

## Project Status

* Runtime: Node.js 18+
* App entrypoint: `app.js`
* Web server: `npm start`
* Development server: `npm run dev`
* Tests: `npm test`
* Search backend: Elasticsearch indexes for `hadiths`, `toc`, and `commentaries`
* Database backend: MySQL, configured through `~/.hadithdb/settings.json`

## Recently Added Features

Recent work has focused on making the Qurʾān and search surfaces richer, faster,
and more tightly connected:

* Enriched Qurʾān reading pages with tafsīr access from āyah markers, passage
  actions, hover previews, and modal entry points.
* Tafsīr browsing improvements, including local commentary indexing, tafsīr
  book navigation, sticky carousel-style browsing, and clearer tafsīr passage
  links.
* Quran passage UX upgrades: shareable selected āyāt, previous/next navigation,
  keyboard navigation, improved random āyah rendering, and unified DigitalKhatt
  typography across passages, heroes, and corpus word annotations.
* Search improvements that bring Qurʾān āyāt, headings, and tafāsīr into the
  same search experience while keeping Qurʾān-only and commentary-only filters
  distinct.
* Search result refinements, including direct `Tafsīr` action links, better
  autocomplete behavior, surah-name matching in English and Arabic, and cleaner
  highlighting for filter-driven searches.

## Available Local Tafsir Books

Visible local tafsīr books are stored in MySQL `books_commentaries` rows where
`source='local'` and `hidden=0`.

Arabic:

* `irab-al-quran` - al-Jadwal fi Irab al-Quran wa-Sarfih wa-Bayanih
* `tafsir-baghawi` - Maalim al-Tanzil fi Tafsir al-Quran
* `tafsir-tabari` - Jami al-Bayan an Tawil Ay al-Quran
* `tafsir-ibn-al-jawzi` - Zad al-Masir fi Ilm al-Tafsir
* `tafsir-qurtubi` - al-Jami li-Ahkam al-Quran wa-al-Mubayyin lima Tadammana min al-Sunnah wa-Ay al-Furqan
* `tafsir-ibn-ashur` - Tahrir al-Mana al-Sadid wa-Tanwir al-Aql al-Jadid min Tafsir al-Kitab al-Majid
* `qiraat` - al-Jadwal fi Qira'at al-Quran
* `irab-daas` - Irab al-Quran al-Karim
* `ibn-adil` - al-Lubab fi Ulum al-Kitab
* `tafsir-mathur` - Mawsuat al-Tafsir al-Mathur
* `tafsir-suyuti` - al-Durr al-Manthur fi al-Tafsir bi-al-Mathur
* `saadi` - Taysir al-Karim al-Rahman fi Tafsir Kalam al-Mannan

English:

* `en-easy-tajwid` - Easy Tajwid
* `en-tafsir-mokhtasar` - al-Mukhtasar fi Tafsir al-Quran al-Karim
* `en-tafsir-maududi` - Tafhim al-Quran
* `en-tafsir-jalalayn` - Tafsir al-Jalalayn
* `en-tafsir-maarif-al-quran` - Ma'ariful Qur'an
* `en-tafsir-tazkir-al-quran` - Tadhkir al-Quran
* `en-tafsir-ibn-kathir` - Tafsir al-Quran al-Azim

## Elasticsearch Indexing

Rebuild search indexes with:

* `node bin/buildSearchIndex.js --all`
* `node bin/buildSearchIndex.js --book-id 16`
* `node bin/buildSearchIndex.js --from-book-id 16`
* `node bin/buildSearchIndex.js --all --toc-only`
* `node bin/buildSearchIndex.js --book-id 16 --toc-only`

Missing Elasticsearch indexes are created from the checked-in mappings. Existing indexes are never deleted. `--all` reindexes every book independently. `--book-id` reindexes only the requested book id. Use `--from-book-id` to reindex that book id and every later book id. Add `--toc-only` to rebuild only the `toc` index. Hidden books are not indexed, and virtual books index only table-of-contents/search collection data.

See [bin/elasticsearch-cron.md](bin/elasticsearch-cron.md) for scheduled indexing notes.

Rebuild the separate local Quran commentaries index with:

* `npm run build:commentaries-index`

This indexes visible `books_commentaries` rows with `source='local'` and their
`hadiths_commentary` passages into Elasticsearch `commentaries`. The rebuild
removes stale commentary documents before indexing the current MySQL rows.
MySQL is the authoritative source for local commentary content; no bundled
commentary source files are required at runtime or during index rebuilds.

## Available Books and Collections

The current public catalog contains 23 available books and collections: 20 source books plus 3 virtual collections. Source books contain 203,840 records, and virtual collections contain 4,755 linked records.

Counts below come from the live MySQL `books`, `hadiths`, and `hadiths_virtual` tables on 2026-04-26. `English` shows records with non-empty English body text. `Graded` shows records with a grader id.

| ID | Alias | Name | Type | Records | English | Graded | Graders |
|---:|---|---|---|---:|---:|---:|---|
| 0 | `quran` | The Holy Qurʾān | Source | 6,236 | 6,236 | 0 | N/A |
| 57 | `ibnrajab50` | Jāmiʿ al-ʿUlūm wa-al-Ḥikam | Virtual | 93 | N/A | N/A | N/A |
| 61 | `riyad` | Riyāḍ al-Ṣāliḥīn min Kalām Sayyid al-Mursalīn | Virtual | 2,755 | N/A | N/A | N/A |
| 15 | `adab` | al-Adab al-Mufrad | Source | 1,326 | 1,326 | 1,326 | Albānī, Arnaʾūṭ |
| 50 | `lulu-marjan` | al-Luʾluʾ wa-al-Marjān (Muttafaq ʿAlayh) | Virtual | 1,907 | N/A | N/A | N/A |
| 1 | `bukhari` | Ṣaḥīḥ al-Bukhārī | Source | 7,277 | 7,277 | 7,276 | Bukhārī, Luʿluʿ wa-al-Marjān |
| 2 | `muslim` | Ṣaḥīḥ Muslim | Source | 7,469 | 7,469 | 7,469 | Muslim |
| 4 | `abudawud` | Sunan Abū Dāwūd | Source | 5,276 | 5,276 | 4,897 | Albānī, Arnaʾūṭ |
| 5 | `tirmidhi` | Jamiʿ al-Tirmidhī | Source | 4,052 | 4,052 | 3,908 | Albānī, Arnaʾūṭ, Tirmidhī, ʿAli Zaʾī |
| 3 | `nasai` | Sunan al-Nasāʾī | Source | 5,769 | 5,769 | 5,460 | Albānī, Arnaʾūṭ, Ḥākim, Nasāʿī, ʿAli Zaʾī |
| 6 | `ibnmajah` | Sunan Ibn Mājah | Source | 4,345 | 4,345 | 4,184 | Albānī, Arnaʾūṭ, ʿAli Zaʾī |
| 9 | `darimi` | Sunan al-Dārimī | Source | 3,547 | 3,546 | 3,199 | Dārānī, Ibn Ḥibbān, Ibn Mājah |
| 8 | `ahmad` | Musnad Aḥmad | Source | 27,735 | 27,668 | 27,734 | Arnaʾūṭ, ʿAli Zaʾī |
| 7 | `malik` | Muwaṭṭaʾ Mālik | Source | 1,975 | 1,975 | 1,975 | Mālik |
| 10 | `hakim` | Mustadrak al-Ḥākim | Source | 8,809 | 8,788 | 8,809 | Aḥmad, Dhahabī, Ḥākim, Haythamī, Ibn Ḥibbān |
| 11 | `ibnhibban` | Ṣaḥīḥ Ibn Ḥibbān | Source | 7,539 | 7,496 | 6,723 | Arnaʾūṭ |
| 16 | `bazzar` | Musnad al-Bazzār | Source | 9,030 | 22 | 0 | N/A |
| 17 | `ibnkhuzaymah` | Ṣaḥīḥ Ibn Khuzaymah | Source | 2,414 | 1 | 0 | N/A |
| 12 | `tabarani` | al-Muʿjam al-Kabīr, Ṭabarānī | Source | 21,373 | 21,264 | 19 | Aḥmad, Albānī, Arnaʾūṭ, Haythamī, Muslim |
| 13 | `nasai-kubra` | al-Sunan al-Kubrá, Nasāʾī | Source | 11,446 | 11,414 | 4 | Arnaʾūṭ, Nasāʿī, Tirmidhī, ʿAli Zaʾī |
| 14 | `bayhaqi` | al-Sunan al-Kabīr, Bayhaqī | Source | 19,953 | 19,850 | 5 | Bayhaqī, Bukhārī, Muslim |
| 82 | `ahmad-zuhd` | al-Zuhd, Aḥmad | Source | 2,360 | 2,355 | 0 | N/A |
| 1000 | `suyuti` | Jamʿ al-Jawāmiʿ, Suyūṭī | Source | 45,909 | 1,397 | 61 | Albānī, Arnaʾūṭ, Bayhaqī, Bukhārī, Dhahabī, Ḥākim, Haythamī, Ibn al-Jawzī, Ibn Ḥajar, Luʿluʿ wa-al-Marjān, Mudhiri, Muslim, Nawawī, Suyūṭī, Tirmidhī |
