# HadithDB

HadithDB is an Express application and database toolkit for browsing, searching, and citing Qurʾān and ḥadīth records. The public site is hosted at <https://hadithunlocked.com>.

The database stores Arabic source text, English translation fields where available, chapter/table-of-contents metadata, grading metadata, and derived search fields. Isnād and matn are split for all ḥadīth records.

## Project Status

* Runtime: Node.js 18+
* App entrypoint: `app.js`
* Web server: `npm start`
* Development server: `npm run dev`
* Tests: `npm test`
* Search backend: Elasticsearch indexes for `hadiths`, `toc`, and optional `hadith_knowledge`
* Database backend: MySQL, configured through `~/.hadithdb/settings.json`

## Search and Chatbot API

The app exposes a grounded ḥadīth chatbot endpoint at `/chatbot`. The legacy `/rag` path remains available as a compatibility alias.

Examples:

* `GET /chatbot?q=what did the Prophet say about intentions`
* `GET /chatbot/retrieve?q=intentions&k=5`
* `POST /chatbot` with JSON: `{ "question": "...", "topK": 6, "books": ["bukhari", "muslim"] }`
* `POST /chatbot/message` with JSON: `{ "messages": [{ "role": "user", "content": "..." }] }`

Book filters use book aliases such as `bukhari`, `muslim`, `abudawud`, `tirmidhi`, `nasai`, `ibnmajah`, `ahmad`, and `malik`. The grouped aliases `sahihayn` and `sixbooks` are also supported by the retrieval layer.

The chatbot retrieves cited local records from Elasticsearch. It searches the derived `hadith_knowledge` index first, then falls back to the `hadiths,toc` indexes. If `OPENAI_API_KEY` or `settings.openAI.key` is configured, `/chatbot` also generates a concise grounded answer using the OpenAI Responses API. Set `OPENAI_MODEL`, `settings.rag.model`, or `settings.openAI.model` to override the default model.

## Arabic-Rooted Chatbot Knowledge

Raw ḥadīth wording is not always question-friendly, so the chatbot can use a derived `hadith_knowledge` layer before falling back to direct ḥadīth search. This layer is generated from Arabic source fields only: Arabic title, isnād, matn, and Arabic footnote. English fields in the `hadiths_knowledge` table are conversation/retrieval metadata, not the source of truth for answers.

Build and index that layer with:

* `npm run build:knowledge -- --create-index --limit 25`
* `npm run build:knowledge -- --book-id 1 --limit 100`
* `npm run build:knowledge -- --index-only --limit 1000`

The builder creates the MySQL `hadiths_knowledge` table if needed, stores source hashes so unchanged ḥadīths are skipped, and indexes records into Elasticsearch `hadith_knowledge`. Set `OPENAI_KNOWLEDGE_MODEL`, `OPENAI_MODEL`, `settings.knowledge.model`, or `settings.openAI.model` to choose the generation model.

## Elasticsearch Indexing

Rebuild search indexes with:

* `node bin/buildSearchIndex.js --all`
* `node bin/buildSearchIndex.js --book-id 16`
* `node bin/buildSearchIndex.js --all --toc-only`
* `node bin/buildSearchIndex.js --book-id 16 --toc-only`

`--all` recreates and indexes `hadiths` and `toc` for every book. `--book-id` reindexes that book id and every later book id. Add `--toc-only` to recreate or rebuild only the `toc` index. Hidden books are not indexed, and virtual books index only table-of-contents/search collection data.

See [bin/elasticsearch-cron.md](bin/elasticsearch-cron.md) for scheduled indexing notes.

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
