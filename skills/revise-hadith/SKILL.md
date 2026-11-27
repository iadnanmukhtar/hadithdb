---
name: revise-hadith
description: Revise a hadith's Arabic Markdown formatting and English translation in HadithDB house style, including transliteration and meaning for quoted dhikr or dua. Use when asked to revise a hadith by reference or supplied text.
---

# Revise hadith

Use the exact report supplied. For a reference, retrieve the record with HadithDB lookup_hadith_detail, confirm the returned reference, and read arabic.body and english.body separately from their chains. If the Arabic is unavailable, request it before attempting a source-checked translation.

## Narrative and speech

Follow [Bukhari 1](https://hadithunlocked.com/bukhari:1). Preserve the Arabic wording, diacritics, honorifics and speaker sequence. Keep the narrator's framing in plain type. Set the Prophet's direct speech in italics, using Arabic guillemets in Arabic and double quotation marks in English. For example, the English pattern is `I heard the Messenger of Allah ﷺ say, *"…."*`. Keep a companion's question or another speaker's reply in narrative type so the change of voice is clear.

Use the vocabulary Muslim readers commonly use in English. For example, use Allah, salah for the ritual prayer, dua for supplication, and zakat for the obligatory alms when those terms fit the Arabic. Let context guide the choice. Keep the English meaning of a recited dua clear enough for the reader to understand what they are asking Allah for.

Use ﷺ after the Prophet Muhammad’s name or a title referring to him, and ؓ after a named Companion. Use the same symbols in the English body, including when revising an older translation that uses PBUH or RA. For example, write `Umar b. al-Khattab ؓ said, "I heard the Messenger of Allah ﷺ say …"`. Verify the narrator is a Companion before adding ؓ.

Translate the exact Arabic into natural English. Retain first-person testimony, conditions, repetitions and qualifications. Use ˹…˺ sparingly around words supplied to clarify an implicit meaning. Keep interpretation outside the translation. Use the collection and chapter to resolve names, legal expressions and technical terms. Keep sustained speech together and start a new paragraph at a change of speaker, scene, ruling or subject. Mirror the Arabic paragraphs in English where practical. Use plain double quotes for other speakers in English and end Prophetic italics when the speaker changes.

Use familiar spellings such as Abdullah and Ubaydullah in English prose. Use `b.` and `bt.` in personal names. For words you transliterate yourself in prose, use short vowel letters and render final ة as h. Keep established Muslim vocabulary and the vocalized recitation style below. Use ﷻ for a devotional honorific after Allah where intended. Translate divine names and attributes that form part of the recited wording in full.

## Chain, footnotes and title

For a full-record revision, inspect the Arabic chain, body and footnote together. Preserve every Arabic word and vowel mark across the three fields. Adjust punctuation and Markdown as needed. For an English-only revision, use the existing Arabic fields as supplied.

- **Chain.** Correct a clearly misplaced boundary. Narrator connectors belong with the isnad. The report starts with its action, description or speech introduction, including phrases such as قال رسول الله ﷺ and any attached له or لها. Extract a clear opening isnad from the body if the chain field is empty. Otherwise retain an uncertain split and leave an absent chain empty.
- **English chain.** Give only the narrators’ names in transmission order, separated by ` > `. Use ALA-LC here, including ʿ for ع and ʾ for ء, as in ʿAbdullāh and ʿUbaydullāh. A sole narrator stands alone. Omit transmission verbs and honorifics from this names-only field.
- **Footnotes.** Identify who is speaking before moving a grading remark, variant, source note or explanation. A collector’s comment after the report belongs in the footnote. A Companion’s ruling within the report belongs in the body. Preserve existing footnotes and append newly separated notes as paragraphs. Translate each note separately, using the corrected body to resolve its references. Leave both footnote fields empty if there is no note.
- **Title.** Preserve an existing editorial title. For a missing title or one prefixed with `[AI]` or `[Machine]`, give a concise sentence-case rendering of the Arabic title. If none exists, derive the title from the corrected body.

## Quran quotations and citations

Mark identifiable Quran quotations in Arabic with ﴿…﴾ and in English with plain double quotes. Keep the verse outside Prophetic italics even when the Prophet ﷺ recites it. Add a reference only when the verse is confidently identified. For identifiable hadith citations, verify the collection and number.

Link the reference label alone, in parentheses beside the quotation. Use Arabic surah or collection names and Arabic-Indic digits in Arabic labels, and transliterated surah names or English collection names in English labels. Use ASCII digits and the canonical alias in URLs. Examples include `([آل عمران ٣:٢٩](https://quran.islamunlocked.com/quran:3:29))` and `([Muslim 2985](https://hadithunlocked.com/muslim:2985))`. Preserve correct targets, citation placement and existing linked inline footnotes such as `[^[Dhāriyāt 51:56–57](https://quran.islamunlocked.com/quran:51:56-57)]`.

## Recited dhikr or dua

Follow [Abu Dawud 832](https://hadithunlocked.com/abudawud:832) wherever the report actually gives words of remembrance or supplication. A passing mention of prayer uses ordinary narrative formatting. Keep each recitation where its speaker says it, including any intervening question or action.

In Arabic, place the vocalized formula in bold italics on its own paragraph. In English, give the transliteration in bold italics on its own line and the complete meaning in italic parentheses immediately beneath. Preserve an introduction such as “Say” only where the Arabic has it. This excerpt illustrates the paired body fields:

Arabic Markdown

```markdown
قَالَ: *«قُلِ:*

***اللَّهُمَّ ارْحَمْنِي وَارْزُقْنِي وَعَافِنِي وَاهْدِنِي***».
```

English Markdown

```markdown
He said: *"Say:*
***allāhumma irḥamnī wa-urzuqnī wa-ʿāfinī wa-ihdinī***
*(O Allah, have mercy on me, provide for me, grant me well-being, and guide me.)"*
```

Match every transliterated phrase and its meaning to the target Arabic in order. Check long vowels, consonants and pronouns. For example, the first formula in the model record ends at بِاللَّهِ in Arabic, although its transliteration continues. Follow the target report's actual ending.

Return copy-ready Markdown for the requested fields, keeping Arabic and English separate. For a draft, present the revision directly. Save edits only when the user requests a write to the specified destination.
