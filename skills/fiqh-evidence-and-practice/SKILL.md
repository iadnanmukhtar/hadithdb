---
name: fiqh-evidence-and-practice
description: Answer fiqh evidence questions and practical how-to questions for worship by citing Quran, hadith, and commentary and distinguishing agreement, disagreement, and inferred procedure.
---

Use this skill when the user asks for evidence behind a fiqh ruling, asks what scholars say about a practice, or asks how to perform an act of worship such as salah, istikharah, wudu, fasting, or dhikr.

The user's stated madhhab, source preference, and requested level of detail take precedence. If no madhhab is specified, give the broadly shared method first and include consequential variations only when supported by the retrieved evidence.

1. Determine whether the request calls for an evidence list, a comparison of scholarly views, practical instructions, or a combination.
2. For substantive topic or how-to questions, start with `research_islamic_topic`, supplying short Arabic and English concept queries. Research depth is separate from answer length: a concise answer can still use standard research. Supply known principal report references through `hadith_references` when available, without guessing numbers. Inspect its coverage, retrieve omitted or truncated material that could affect the method, and consult distinct commentary works when available before the first answer. Do not ask the user to prompt separately for explanations that are needed to answer their original question.
3. Discover relevant passages with `search_quran` and `search_hadith`, then verify them with `lookup_quran_ayah` and `lookup_hadith_detail`. Prefer exact references supplied by the user.
4. Preserve each hadith's grade and grader. Inspect `research_inventory` even in compact hadith results; use `lookup_hadith_commentary` for relevant entries and `search_hadith_commentary` across other works/collections. `list_hadith_commentaries` resolves source aliases. Use default/full hadith detail for `metadata.sharh` and provenance. Distinguish entries from distinct works, and preserve each parallel report’s identity and grading. Follow only verified internal references; never infer cross-collection identities from matching numbers.
5. For Quran-based interpretive issues, use `research_quran_ayah`; otherwise verify relevant tafsir search candidates with exact `lookup_tafsir` calls. Include Quran/tafsir when substantively connected, distinguishing direct evidence from broader context. Do not manufacture a Quran connection just to fill a category.
6. Answer in the order most useful to the question: concise ruling or overview, primary evidence, practical steps when requested, and material scholarly variations.
7. Clearly distinguish explicit scriptural wording, classical commentary, juristic deduction, recommended etiquette, and requirements. Do not manufacture consensus or attribute a later procedural detail to a hadith that does not state it.
8. Include authenticated Arabic supplications and an English meaning when they are part of the requested practice and present in the retrieved record.

When the available sources do not resolve a personalized or disputed ruling, explain the evidence boundary and recommend consulting a qualified scholar without withholding the general evidence requested.
