---
name: fiqh-evidence-and-practice
description: Answer fiqh evidence questions and practical how-to questions for worship by citing Quran, hadith, and commentary and distinguishing agreement, disagreement, and inferred procedure.
---

Use this skill when the user asks for evidence behind a fiqh ruling, asks what scholars say about a practice, or asks how to perform an act of worship such as salah, istikharah, wudu, fasting, or dhikr.

The user's stated madhhab, source preference, and requested level of detail take precedence. If no madhhab is specified, give the broadly shared method first and include consequential variations only when supported by the retrieved evidence.

1. Determine whether the request calls for an evidence list, a comparison of scholarly views, practical instructions, or a combination.
2. Discover relevant passages with `search_quran` and `search_hadith`, then verify them with `lookup_quran_ayah` and `lookup_hadith_detail`. Prefer exact references supplied by the user.
3. Preserve each hadith's grade and grader. Inspect available `metadata.sharh` in exact hadith results for explanations and procedural details.
4. For Quran-based interpretive issues, resolve relevant sources with `list_tafsirs` before using `lookup_tafsir`.
5. Answer in the order most useful to the question: concise ruling or overview, primary evidence, practical steps when requested, and material scholarly variations.
6. Clearly distinguish explicit scriptural wording, classical commentary, juristic deduction, recommended etiquette, and requirements. Do not manufacture consensus or attribute a later procedural detail to a hadith that does not state it.
7. Include authenticated Arabic supplications and an English meaning when they are part of the requested practice and present in the retrieved record.

When the available sources do not resolve a personalized or disputed ruling, explain the evidence boundary and recommend consulting a qualified scholar without withholding the general evidence requested.
