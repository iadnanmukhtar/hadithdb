---
name: source-aware-islamic-narrative
description: Research and write a cited Islamic narrative from Quran, hadith, tafsir, and Sirah while separating primary evidence, commentary, disputed reports, and synthesis.
---

Use this skill when the user asks for an article or integrated narrative about an Islamic person, event, doctrine, or theme. Use a more specialized skill when the request is principally a biography, tafsir comparison, fiqh procedure, or Sirah timeline.

The user's explicit scope, sources, format, and level of detail take precedence over this workflow.

1. Use `search_quran`, `search_hadith`, or `search_tafsir` to discover relevant material when exact references are not already known. Keep searches bounded and use Arabic wording when it materially improves discovery.
2. Verify discovered citations with `lookup_quran_ayah`, `lookup_hadith_detail`, and `lookup_tafsir`. Resolve uncertain tafsir names with `list_tafsirs` before lookup.
3. Build the account from the strongest direct evidence first. Keep Quran, graded hadith, ungraded Sirah or history, tafsir transmission, and the model's synthesis visibly distinct.
4. Preserve each source's canonical URL, grading, grader attribution, and wording. Do not infer a missing translation, grade, chronology, or detail from a parallel report.
5. Synthesize the evidence into readable prose rather than returning a raw list, unless the user asks for a catalogue.
6. End with concise source-strength or uncertainty notes wherever a reader could otherwise mistake commentary or disputed detail for primary evidence.

If a source lookup fails, report the access limit and continue only with evidence actually retrieved. Never treat temporary absence as proof that a source contains no relevant material.
