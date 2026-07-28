# HadithDB

HadithDB is a website for reading, searching, and citing the Qurʾān and ḥadīth. You can browse it online at <https://hadithunlocked.com>.

Every record keeps the original Arabic text alongside an English translation where one is available, together with chapter listings and grading information. For ḥadīth, the chain of narrators (isnād) and the report itself (matn) are stored separately so each can be read and searched on its own.

## What's New

Recent work has improved the reading, browsing, and search experience across the site:

* **Reading the Qurʾān** — move naturally between Passage, Ayat, Mushaf, and Memorize views while the site keeps your place. You can like, comment on, bookmark, and share a passage, move easily between verses and sections, and use the page-faithful Mushaf as a memorization exercise.
* **The 15-line Mushaf** — read all 604 pages in a responsive, page-faithful Digital Khatt layout with infinite scrolling, Quranic surah headers, interactive words and ayah markers, page bookmarks, passage-aware coloring, and continuous recitation.
* **Commentary and translation** — full-page commentary and translation views, tabs for switching between commentary works, hover explanations, dynamic translation selection, and the option to show Arabic and English side by side. You can turn individual works on or off and choose the order they appear in.
* **Qurʾān audio** — choose a reciter, begin from a selected ayah, continue across page boundaries, repeat a passage or subsection, and control playback speed without losing synchronized ayah highlighting or translation captions.
* **Search** — searching now covers the Qurʾān and its commentaries as well as ḥadīth, returns Qurʾān matches faster, lets you filter to commentary results, and presents cleaner highlights and a single, unified set of suggestions.
* **My Settings** — separate starting points for ḥadīth and Qurʾān, remembered commentary, translation, and reciter preferences, and bookmarked passages and Mushaf pages saved for later.

## Quran Unlocked

**Read the Qurʾān as a book, explore it as a study text, and hear it as a continuous recitation—all in one place.** Quran Unlocked combines a responsive 15-line Mushaf with word-level learning, passage structure, trusted translations and tafsīr, personalized audio, and tools for saving and sharing what matters.

Open the Mushaf and begin where you left off. Tap a word for its meaning, select an ayah to read its translation, or let the recitation carry you seamlessly across pages. Switch to Memorize to test recall against the same 15-line page layout, or move instantly to a focused ayah or structured passage without losing your place.

## Qurʾān Features

### Four connected reading modes

* **Passage** presents the Qurʾān in titled sections and subsections for thematic reading.
* **Ayat** focuses the reading experience on individual verses and the ayah hero view.
* **Mushaf** reproduces the familiar 15-line, page-by-page reading experience.
* **Memorize** keeps the Digital Khatt Mushaf font and 15-line page layout while replacing ordinary words with underlined blanks. The basmalah and ayah markers remain visible.
* The mode links, page subtitle, URL, previous/next links, and related passage automatically follow the content currently in view during infinite scrolling.
* Direct navigation is available by surah, ayah, passage, subsection, juz, manzil, Mushaf page, and search result.

### A responsive Digital Khatt Mushaf

* All **604 pages** use Digital Khatt Quran text in a page-faithful 15-line layout.
* Pages load continuously with vertical infinite scroll; after page 604, reading can continue again from page 1.
* The layout scales for desktop, portrait phones, and landscape phones without changing through the normal text-size controls or bleeding beyond the page.
* Qurʾānic surah headers use the QCF header font. A new surah opens with its header and basmalah kept with the beginning of the surah; Surah 9 correctly omits the basmalah.
* Subtle inner-edge shading distinguishes odd and even pages like an open printed book.
* Alternating black and saddle-brown text reveals h3 subsection boundaries while preserving the Quranic styling of ayah markers.
* Each page identifies its page number, juz, surah number, and Arabic surah name. Page, juz, and surah numbers are directly editable, while the custom surah picker opens at the current surah.
* The page footer links the passage and subsection titles that actually begin on that page, making the Mushaf’s thematic structure visible without repeating earlier headings.
* `/quran/page` resumes at the bookmarked Mushaf page, or page 1 when no page bookmark exists.

### Memorize view

* Open a Mushaf page with `?memorize`, such as `/quran/page/1?memorize`, or select **Memorize** from the Quran reading-mode controls.
* Hidden words retain their exact Digital Khatt width and placement and are individually underlined, preserving the page-faithful 15-line layout. Surah headers, the basmalah, and ayah markers remain visible.
* Clicking a hidden word reveals it for **two seconds** before it fades back to an underlined blank.
* Clicking an ayah marker toggles that complete ayah between visible text and blanks without changing the other ayat.
* The page-header **View/Hide** control reveals every word on that page or returns the page to blanks. Hiding also clears individual word and ayah reveals.
* Each page keeps its own state as additional pages load through infinite scrolling, and Memorize mode remains active through page, surah, juz, URL, and previous/next navigation.
* Audio, reciter and translation controls, the translation marquee, and word-translation tooltips are intentionally omitted so the view remains focused on recall.

### Interactive Arabic and ayah tools

* Hovering over a word highlights it using the same interaction language in Passage and Mushaf views.
* Clicking a Quran word reveals corpus information and its word-level translation. In the standard Mushaf it also toggles selection of the complete ayah; Memorize mode instead performs its temporary reveal without translations.
* Selected and audio-playing ayat use a full-ayah highlight and the established Quran passage colors rather than disconnected word boxes.
* Clicking elsewhere clears the selected ayah.
* Ayah markers offer the same compact **View** and **Play** actions in Passage and Mushaf modes. View opens the focused ayah; Play begins recitation from that marker.
* Clicking an ayah, word, or marker displays its selected translation in the footer marquee, even when audio is not playing.
* Juz starts are marked with `۞`, and Quran metadata such as sajdah markers can be rendered alongside the standard ayah marker.

### Continuous, passage-aware audio

* Recitation uses continuous surah recordings with ayah timing segments, avoiding the audible breaks caused by stitching together separate per-ayah files.
* Playback continues across lazy-loaded Mushaf pages and passage boundaries while the current ayah remains highlighted.
* Audio begins at the selected ayah; without a selection it begins at the top of the current page or passage.
* Repeat is a true toggle. It repeats the current h3 subsection, falling back to its h2 passage, even when that range crosses a page boundary.
* The active reciter can be changed during playback. Available reciters are alphabetized, can be enabled or disabled in My Settings, and the preferred reciter is remembered.
* The sticky audio footer provides previous, repeat, play/pause, stop, speed, and next controls in one non-wrapping row.
* Playback speeds are **x1, x1.25, x1.5, x2.0, x2.5, and x3**. The selected rate is retained for the browser session and reapplied after stop, resume, source changes, and page transitions.
* A translation marquee appears above the sticky footer during playback. It identifies the reciter and translation once, uses unobtrusive superscript ayah references, honors LTR and RTL translations, and streams consecutive translations separated by a spaced dot—starting each entry from the center as its audio segment begins.

### Translations, tafsīr, and study

* Change the active translation directly from Passage or Mushaf controls.
* Show or hide Arabic and translation text independently on passage pages.
* Open available translations, bilingual tafsīr, Arabic tafsīr, and English tafsīr for an ayah without leaving the reading workflow.
* Tafsīr tabs, translation disclosures, footnote popups, hover explanations, and side-by-side Arabic/English layouts support both quick reading and deeper study.
* My Settings controls the preferred translation and reciter, enabled translations, tafsīrs and reciters, and the display order of translation and tafsīr works.
* Translation choices are synchronized across passage text, the ayah hero, Mushaf controls, share cards, and the audio/selection marquee.

### Navigation, saving, and sharing

* Infinite Passage and Mushaf readers update their canonical reading context as the user scrolls.
* The compact sticky footer provides back, Quran home, text controls, and context-aware previous/next navigation; in Mushaf mode those links move by page.
* A single Mushaf page bookmark is maintained at a time, appears on the Bookmarks page, and determines the default `/quran/page` destination.
* Quran passages and ayat support bookmarks, likes, comments, reflections, and shareable image cards with selectable translations.
* Keyboard navigation and accessible labels complement touch, mouse, and mobile controls.

### Search, downloads, and integration

* Unified search covers Arabic and translated Qurʾān text, translations, and tafsīr, with autocomplete, filters, highlighting, and direct verse navigation.
* Quran content is addressable through stable ayah, range, passage, subsection, juz, manzil, translation, tafsīr, and Mushaf-page URLs.
* Machine-readable JSON and Markdown responses support individual ayat and ranges, while translation and Quran downloads are available in JSON or EPUB where provided.
* Quran passages, commentary pages, translations, and all Mushaf pages are included in the sitemap.

### Editorial and performance support

* Passage and subsection ranges can be edited and reindexed while maintaining their Passage-to-Mushaf mapping.
* Heading, range, and title changes invalidate the related Passage and Mushaf caches so stale section references are not retained.
* Mushaf page data and section mappings use in-memory and search caches where appropriate, with disk-cache versioning and explicit flush support for updated content.

## Qurʾān Reciters

The site includes the continuous, ayah-synchronized recitations listed below. Each one has a short alias used internally for audio selection and saved preferences.

| Alias | Reciter |
|---|---|
| `abbad` | Fares Abbad |
| `alili` | Aziz Alili |
| `banna` | Mahmoud Ali al-Banna |
| `dusari` | Yasir al-Dusari |
| `husari` | Mahmud Khalil al-Husari |
| `jalil` | Khalid al-Jalil |
| `juhani` | Abdullah Awwad al-Juhani |
| `minshawi` | Muhammed Siddiq al-Minshawi |
| `qatami` | Nasser al-Qatami |
| `shuraym` | Saud al-Shuraym |
| `sudays` | Abd al-Rahman al-Sudays |
| `yasin` | Sahl Yasin |

## Qurʾān Commentaries and Translations

The site includes the commentary (tafsīr) and translation works listed below. Each one has a short alias used in links and an English title.

### Bilingual tafsīr

| Alias | Name |
|---|---|
| `ibn-kathir` | Tafsir al-Quran al-Azim |
| `jalalayn` | Tafsir al-Jalalayn |
| `mokhtasar` | al-Mukhtasar fi Tafsir al-Quran al-Karim |
| `muntakhab` | al-Muntakhab fi Tafsir al-Quran |

### Arabic tafsīr and Qurʾān companions

| Alias | Name |
|---|---|
| `tabari` | Jami al-Bayan an Tawil Ay al-Quran |
| `samarqandi` | Bahr al-Ulum |
| `abu-zamanayn` | Tafsir al-Quran al-Aziz |
| `makki` | al-Hidayah ila Bulugh al-Nihayah |
| `mawardi` | al-Nukat wa-al-Uyun |
| `samaani` | Tafsir al-Quran |
| `baghawi` | Maalim al-Tanzil fi Tafsir al-Quran |
| `zamakhshari` | al-Kashshaf an Haqaiq Ghawamid al-Tanzil |
| `ibn-al-jawzi` | Zad al-Masir fi Ilm al-Tafsir |
| `razi` | Mafatih al-Ghayb |
| `qurtubi` | al-Jami li-Ahkam al-Quran wa-al-Mubayyin |
| `baydawi` | Anwar al-Tanzil wa-Asrar al-Tawil |
| `nasafi` | Madarik al-Tanzil wa-Haqaiq al-Tawil |
| `ibn-juzay` | al-Tashil li-Ulum al-Tanzil |
| `abu-hayyan` | al-Bahr al-Muhit |
| `thalabi` | al-Kashf wa-al-Bayan an Tafsir al-Quran |
| `ibn-adil` | al-Lubab fi Ulum al-Kitab |
| `biqaii` | Nazm al-Durar fi Tanasub al-Ayat wa-al-Suwar |
| `iji` | Jami al-Bayan fi Tafsir al-Quran |
| `suyuti-t` | al-Durr al-Manthur fi al-Tafsir bi-al-Mathur |
| `shawkani` | Fath al-Qadir |
| `alusi` | Ruh al-Maani |
| `qinnawji` | Fath al-Bayan fi Maqasid al-Quran |
| `qasimi` | Mahasin al-Tawil |
| `irab-al-quran` | al-Jadwal fi Irab al-Quran wa-Sarfih wa-Bayanih |
| `saadi` | Taysir al-Karim al-Rahman fi Tafsir Kalam al-Mannan |
| `ibn-ashur` | al-Tahrir wa-al-Tanwir |
| `shanqiti` | Adwa al-Bayan fi Idah al-Quran bi-al-Quran |
| `ibn-uthaymin` | Tafsir al-Quran al-Karim |
| `aysar` | Aysar al-Tafasir li-Kalam al-Ali al-Kabir |
| `muyassar` | al-Tafsir al-Muyassar |
| `ibn-atiyah` | al-Muharrar al-Wajiz |
| `basit` | al-Tafsir al-Basit |
| `tadabbur-wa-amal` | al-Quran: Tadabbur wa-Amal |
| `wajiz` | al-Tafsir al-Wajiz |
| `mathur` | Mawsuat al-Tafsir al-Mathur |
| `qiraat` | al-Jadwal fi Qira'at al-Quran wa-Tawjihatih |
| `irab-daas` | Irab al-Quran al-Karim wa-Bayanuh |
| `shawi` | Nafahat min Tafsir al-Quran al-Karim |
| `yasir` | al-Yasir fi Tafsir al-Quran |
| `khadiri` | al-Siraj fi Bayan Gharib al-Quran |
| `wasit` | al-Tafsir al-Wasit li-al-Quran al-Karim |

### English translations

| Alias | Name |
|---|---|
| `en-khattab` | The Clear Quran |
| `en-saheeh-intl` | The Holy Qur'an (Saheeh International) |
| `en-hilali-khan` | Interpretation of the Meanings of the Noble Qur'an |
| `en-bridges` | Bridges' Translation of the Ten Qira'at of the Noble Qur'an |
| `en-taqi-usmani` | The Meanings of the Noble Qur'an with Explanatory Notes |
| `en-itani` | Quran in English: Clear and Easy to Read |
| `en-bewley` | The Noble Qur'an: A New Rendering of Its Meaning in English |
| `en-study-quran` | The Study Quran: A New Translation and Commentary |
| `en-ghali` | Towards Understanding the Ever-glorious Qur'an |
| `en-ahmedraza` | The Holy Quran |
| `en-wahiduddin` | The Quran: Translation and Commentary with Parallel Arabic Text |
| `en-qaribullah` | The Holy Qur'an |
| `en-busool` | The Wise Qur'an: These Are the Verses of the Wise Book |
| `en-tahir-ul-qadri` | Irfan-ul-Quran |
| `en-rowwad` | Explanation of the Meanings of the Noble Quran |
| `en-asad` | The Message of the Qur'an |
| `en-sarwar` | The Holy Qur'an: The Arabic Text and English Translation |
| `en-daryabadi` | Tafseer-e-Majidi |
| `en-shakir` | The Qur'an |
| `en-pickthall` | The Meaning of the Glorious Koran |
| `en-qarai` | The Qur'an with an English Paraphrase |

### English tafsīr

| Alias | Name |
|---|---|
| `en-maududi` | Tafhim al-Quran |
| `en-maarif-al-quran` | Maarif al-Quran |
| `en-tazkir-al-quran` | Tadhkir al-Quran |
| `en-easy-tajwid` | Easy Tajwid |

## Books and Collections

The catalog holds 23 books and collections in all: 20 source books and 3 themed collections drawn from them. The source books together hold 203,840 records, and the collections link to another 4,755.

In the table below, **Records** is the number of entries in each work, **English** is how many of those have an English translation, and **Graded** is how many carry an authenticity grading. The counts were last updated on 2026-04-26.

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
