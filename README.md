# hadithdb

* The Ḥadīth Database is available in SQLite format under **data/hadiths.db.zip**
* Feel free to use and leverage for your use and analysis

## Features
* Isnād and Matn are split for all aḥādīth
* Hosted on https://hadithunlocked.com

## Hadith RAG API
The app exposes a retrieval-augmented endpoint at `/rag`.

* `GET /rag?q=what did the Prophet say about intentions`
* `GET /rag/retrieve?q=intentions&k=5` for retrieval only
* `POST /rag` with JSON: `{ "question": "...", "topK": 6, "books": ["bukhari", "muslim"] }`

Retrieval uses the existing Elasticsearch `hadiths,toc` index and returns cited local source records. If `OPENAI_API_KEY` or `settings.openAI.key` is configured, `/rag` also generates a concise answer using the OpenAI Responses API. Set `OPENAI_MODEL`, `settings.rag.model`, or `settings.openAI.model` to override the default model.

## Available Source Books
The following nine plus source books of ḥadīth are currently availble:
|#| Name | Graded | Translation |
|-|------|--------|-------------|
|0|The Holy Qurʾān|N/A|en|
|1|Ṣaḥīḥ al-Bukhārī|Ṣaḥīḥ(en)|en|
|2|Ṣaḥīḥ Muslim|Ṣaḥīḥ(en)|en|
|3|Sunan al-Nasāʾī|Albānī(en)|en|
|4|Sunan Abū Dawūd|Albānī(en)|en|
|5|Jamiʿ al-Tirmidhī|Tirmidhī(ar), Albānī(en)|en|
|6|Sunan Ibn Mājah|Albānī(en)|en|
|8|Musnad Aḥmad|Arnaʾūt(en)|N/A|
|9|Sunan al-Dārimī|Dārānī(en)|N/A|
|10|Mustadrak al-Ḥākim|Dhahabī(ar)|N/A|
|11|Ibn Ḥibbān|N/A|N/A|
|12|al-Muʿjam al-Kabīr of Ṭabarānī|N/A|N/A|
