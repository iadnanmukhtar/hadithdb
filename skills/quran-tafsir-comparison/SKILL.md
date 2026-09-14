---
name: quran-tafsir-comparison
description: Explain or compare Quran interpretations from named tafsir sources while preserving each commentator's position, alternative readings, and source boundaries.
---

Use this skill when the user asks what one or more mufassirun say, requests a tafsir comparison, or asks about competing interpretations of an ayah.

1. Establish the exact verse text with `lookup_quran_ayah`. For a range, retrieve every ayah needed to avoid attributing surrounding wording to the wrong verse.
2. Use `list_tafsirs` to resolve requested authors or titles. Then call `lookup_tafsir` for each source and ayah. Use `search_tafsir` for discovery, not as a substitute for exact lookup.
3. Present each commentator's view separately before synthesizing agreements, differences, and minority readings.
4. Distinguish grammatical or lexical explanation, transmitted reports, theological inference, and historical claims. Presence in a tafsir establishes that the author transmitted or discussed a claim; it does not independently authenticate the claim.
5. Preserve Arabic wording when it controls the interpretation, paired with a concise English explanation.
6. Link the exact Quran and tafsir records used. State when a requested source or passage was unavailable rather than substituting another commentator silently.

Do not collapse real disagreement into a single consensus position, and do not count Quran translations as tafsir sources.
