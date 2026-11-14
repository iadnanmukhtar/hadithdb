# Yasir Qadhi sirah transcript import

The source is the user-supplied `temp/yqsirah.pdf` (1,181 PDF pages). The printed table of contents is on pages 3–43. The 101 transcripts occupy pages 44–1165. The subsequent glossary and the Ctrl+F instruction page are PDF appendices, not additional lectures; they are not imported as passages. Glossary explanations appearing as transcript footnotes are retained.

The book uses alias `yqsirah`, type `sirah`, language `en`, and sequential topical passage references. The Arabic body/title columns remain empty. Arabic names and quotations embedded in the English transcript are retained in the English content.

## Reproduction

```sh
python3 bin/utils/prepare-yqsirah.py temp/yqsirah.pdf
node bin/utils/import-yqsirah.js
node bin/utils/import-yqsirah.js --apply
```

Poppler (`pdftotext`, `pdftohtml`) is required. The preparation script checks the 101 video headers and uses font/position metadata to identify footnote numbers. It reconciles the printed TOC with body headings, including reviewed wording differences. PDF bidi punctuation is restored to its logical edge before note markers are converted. The importer pins the source SHA-256.

The dry run writes `var/imports/yqsirah/plan.json` and a reviewable `contents.md`. Chapter boundaries are explicitly curated in `data/yqsirah-topics.json`; boundaries can occur within a video. Video openings are retained with their upcoming topics, and immediately repeated continuation headings are merged. Chronological source order is retained, including later returns to earlier events and lecture recaps.

Examples: rebuilding the Ka‘bah spans videos 9–10; the second revelation spans 10–11 in one passage; the slander of Aisha spans 55–56 in one chapter; Banu Qurayza changing sides spans 58–59 in one passage; Ka‘b ibn Malik's account spans 88–89 in one passage.

## Storage and safeguards

- 53 chapters, 1,023 passages, 1,866 footnotes; all 7,456 extracted transcript blocks are assigned exactly once.
- Footnotes use `[^p<page>n<number>]` markers and definitions in `footnote_en`; repeated PDF numbering is safe. The reader combines text and definitions and namespaces rendered IDs per passage/language.
- Every passage has video numbers, source PDF pages, source heading labels, block indices, note keys, and the PDF hash in `yqsirah_source_entries`.
- Eleven bracketed numeric Quran references are explicitly reviewed and retained literally. No Quran/hadith reference enrichment is performed.
- Import uses a transaction, exact readback hashes, and a recorded empty before-state for this new identity. It never replaces an existing import; a rerun validates content and heading identities and reports unchanged, or refuses to overwrite edits.
- The source PDF and generated plan remain available locally. The imported book metadata identifies the source as a transcript, preserving the distinction between the lecturer's words and transcript editorial notes.

## Verification

Reader tests cover Arabic-only, bilingual, and English-only sīrah, separately stored linked notes, and distinct note targets across adjacent passages. A full-corpus render audit checks all 1,866 note targets. After import, rerun the importer to prove no changes; index only the imported book, and verify catalog, chapter, passage, search, and footnote output locally.

The English-only/linked-footnote template change requires deployment before the production reader has the same rendering behavior as the local reader. Database import and search indexing are separate from application deployment.

## Recorded result

Imported book ID: `100427`. Exact-content rerun reported `unchanged: true`.
Elasticsearch returned 1,023 `sirah` documents and 1,076 TOC documents using the
canonical `book_alias: yqsirah` filter. Local catalog, chapter, and passage routes
returned HTTP 200; the first footnote linked to its unique target. Desktop and
390px mobile checks passed, including the saved Arabic-only language preference.

The two sīrah suites pass (23 tests), and the new saved-language-preference
regression passes. The broader language-column suite has one pre-existing CSS
regex failure at `spec/readerLanguageColumns.spec.js:87`; the same regex also fails
against the committed HEAD stylesheet. No stylesheet change was made for this import.

Local evidence: `var/imports/yqsirah/{applied.log,rerun.log,index.log,browser-audit.json}`.
The reader-only deployment patch is `var/imports/yqsirah/reader-only.patch`; it
excludes the workspace's pre-existing print and tafsir edits.
