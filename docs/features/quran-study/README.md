# Quran Study, contents and word exploration

Study follows an ayah, a range or an editorial passage. A printed page, an authored commentary entry and a Study section each group ayat differently.

## Using the feature

| Function | What the reader sees and does | How it works |
| --- | --- | --- |
| Navigate contents | The Quran home offers Juz, Surahs and Manzils. Opening a surah reveals numbered passages and indented subpassages with ranges. The rail becomes an in-page filter on phones. | The navigation data maps each division to a reading location. A slash route such as /quran/2/1 denotes a chapter and section. A colon reference such as /quran:2:1 denotes an ayah. |
| Select a translation | The work picker appears above the surah heading. Its expanded list marks the current work. Selecting another translation retains the ayah, range or passage. | An explicit work alias identifies the translation. Unscoped reading resolves the saved preference or the default, The Clear Quran. The same ayah reference can therefore display different English text. |
| Study a selection | The ayah heading, original text, translation and associated actions share the reading column. The ayah dialog offers Tafsir and Translations, with a full-page action. | A continuous pale highlight follows the selected Arabic ayah across wrapped lines and matches its English translation. The reference carries surah and ayah into commentary, audio and related content. The study renderer separates translation footnotes from body text and numbers them in reading order. |
| Compare related ayat | Similar ayat and Mutashabihat open as disclosures. Similar ayat list linked references and bilingual text. Mutashabihat groups repeated phrases and occurrences. | Stored similarity and phrase relationships drive these lists. A phrase match can identify a span within an ayah. Opening a linked result changes the reading reference. |
| Explore words and relationships | Word-level study adds text and meanings within their verse context. Related-ayah detail can load when opened. | Corpus data is grouped by surah and ayah. Script text, relationships, outlines and translation data have separate payloads so changing the reading script can preserve the location. |
| Load and resume | The first passage can render from an installed edition. Later navigation reuses local data while missing files download. | Eligible public document requests receive a shell with initial file information. The client uses published, versioned data and shared reading templates. Edit views, unsupported sources and server-reader requests follow the server path. |

## Following a request

Compare /quran/2/1 with /quran:2:255 and /passage:2:255-257. The section number in the first address identifies a heading. The other addresses identify verse boundaries. Following an ayah across Study, Tafsir and Mushaf requires translating that reference into each mode’s own location.

## Earlier desktop and phone captures

These links open the archived route atlas. The URL identifies the original capture, including any redirect or gated state it encountered.

| Screen | Requested URL | Desktop | Phone |
| --- | --- | --- |
| Surah entry | `/quran/2` | [Wide](../../design-system/screens/surah-wide.jpg) | [Narrow](../../design-system/screens/surah-small.jpg) |
| Individual ayah | `/quran:2:255` | [Wide](../../design-system/screens/ayah-wide.jpg) | [Narrow](../../design-system/screens/ayah-small.jpg) |
| Ayah range | `/passage:2:255-257` | [Wide](../../design-system/screens/passage-wide.jpg) | [Narrow](../../design-system/screens/passage-small.jpg) |
| Juz entry | `/quran/juz/1` | [Wide](../../design-system/screens/juz-wide.jpg) | [Narrow](../../design-system/screens/juz-small.jpg) |
| Manzil entry | `/quran/manzil/1` | [Wide](../../design-system/screens/manzil-wide.jpg) | [Narrow](../../design-system/screens/manzil-small.jpg) |
| Quran navigation drawer | `/quran/page/42` | [Wide](../../design-system/screens/contents-wide.jpg) | [Narrow](../../design-system/screens/contents-small.jpg) |

## Implementation and related reading

- Study shell eligibility, server fallback and reference routes. [routes/search.js](../../../routes/search.js)
- Full server reading layout. [views/section_quran.ejs](../../../views/section_quran.ejs)
- Browser-rendered entry. [views/quran_study_shell.ejs](../../../views/quran_study_shell.ejs)
- Passage assembly and footnote handling. [public/static/js/quran-local-reader.js](../../../public/static/js/quran-local-reader.js)
- Word data. [lib/QuranCorpus.js](../../../lib/QuranCorpus.js)
- Repeated-phrase groups. [views/sub-views/quran_mutashabihat.ejs](../../../views/sub-views/quran_mutashabihat.ejs)
- Similar-ayah disclosure and reference links. [views/sub-views/quran_similar_ayahs.ejs](../../../views/sub-views/quran_similar_ayahs.ejs)
- Edition manifests and immutable files. [lib/QuranPublication.js](../../../lib/QuranPublication.js)
- Contents drawer and contextual navigation. [public/static/js/quran-navigation.js](../../../public/static/js/quran-navigation.js)

Related guides · [Quran translation library and comparison](../quran-translations/README.md) · [Tafsir library and passage reading](../tafsir/README.md) · [Quran recitation and audio ranges](../quran-audio/README.md) · [Mushaf pages and facing-page reading](../mushaf/README.md) · [Quran edition downloads and reader updates](../quran-editions/README.md)

[All features](../README.md)
