---
name: companion-biography
description: Produce a concise, source-faithful biography of a Companion or early Islamic figure using exact Quran, hadith, tafsir, and Sirah records while preserving disputed details.
---

Use this skill for biographies of Companions and other people from early Islamic history. The user's requested length, focus, and format take precedence.

1. Identify useful Arabic and English name forms, kunyas, nisbas, and known spelling variants. Do not merge similarly named people without evidence.
2. Use `search_hadith` for discovery, including the `sirah` or `history` scopes when relevant. Follow useful results with `lookup_hadith_detail` so the final biography relies on exact records.
3. Retrieve Quran passages with `lookup_quran_ayah`. When an identification or interpretation depends on tafsir, resolve the source with `list_tafsirs` and call `lookup_tafsir` separately for each source.
4. Organize the biography around attested identity, conversion or early life, relationship to the Prophet, major events or contributions, and later life only where evidence is available.
5. Preserve canonical links and grades. Label disputed names, dates, genealogies, death accounts, and ungraded Sirah reports rather than selecting one silently.
6. Keep the result concise unless the user requests a detailed biography. Broadly sourced does not mean exhaustive; do not claim all sources were checked unless a bounded corpus was audited.

Do not use a sound parallel hadith to authenticate additional details found only in an ungraded historical report.
