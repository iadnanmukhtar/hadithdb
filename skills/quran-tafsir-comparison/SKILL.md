---
name: quran-tafsir-comparison
description: Explain Quran ayahs and their concepts through major available tafsirs, related hadith and shuruh, or compare interpretations from named tafsir sources while preserving each commentator's position, alternative readings, and source boundaries.
---

Use this skill for explanations of an ayah and its concepts, what mufassirun say, tafsir comparisons, or competing interpretations. Respect a request limited to translation or a particular source.

1. Start substantive ayah explanations with `research_quran_ayah` at standard depth, or the user’s requested depth. It retrieves the exact ayah and major available tafsirs. If concepts are not yet grounded, omit them on the first call, read the returned ayah and tafsirs, then call again with short Arabic/English concept phrases in the same turn. Do not ask the user to supply the research terms. Confirm exact wording with `lookup_quran_ayah` as needed. For a range, retrieve every ayah needed to avoid attributing surrounding wording to the wrong verse.
2. Use `list_tafsirs` to resolve requested authors or titles. Then call `lookup_tafsir` for each source and ayah. Use `search_tafsir` for discovery, not as a substitute for exact lookup.
3. Supply known exact principal report references through `hadith_references` when available, without guessing numbers. Research the grounded concepts in hadith and shuruh using the dossier and dedicated commentary tools. Inspect `research_inventory`, retrieve relevant exact reports and commentary entries, and expand to other works/collections where they materially clarify the concepts. A lexical match or a similar subject is a conceptual candidate, not proof that a hadith directly explains this ayah. Follow verified internal report links and preserve separate identities/grades. Inspect coverage and truncation before synthesizing.
4. Present each commentator's view separately before synthesizing agreements, differences, and minority readings.
5. Distinguish grammatical or lexical explanation, transmitted reports, theological inference, and historical claims. Presence in a tafsir establishes that the author transmitted or discussed a claim; it does not independently authenticate the claim.
6. Preserve Arabic wording when it controls the interpretation, paired with a concise English explanation.
7. Link the exact Quran and tafsir records used. State when a requested source or passage was unavailable rather than substituting another commentator silently.

Do not collapse real disagreement into a single consensus position, and do not count Quran translations as tafsir sources.
