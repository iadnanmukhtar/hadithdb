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

The English-only/linked-footnote template and language-preference changes were published after explicit user approval on 2026-11-14. Database import and search indexing are separate from application deployment.

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

## Production publication

Published on 2026-11-14 after the user said “publish”. Applied only
`var/imports/yqsirah/reader-only.patch` to the clean production checkout at
`93f10baf8c1256a4d799cc29b148688c9c31110d`. Backed up the two modified files to
`/tmp/yqsirah-reader-before-20261114.tgz` on the server, compiled the EJS template,
checked JavaScript syntax, refreshed the book cache/catalog generation, and
reloaded both HadithDB workers. Both ports 3004 and 3005 returned HTTP 200 with
one full-width English column, nine linked notes on the opening passage, and
English direction for the honorific-led footnote.

Public verification artifacts are under `var/imports/yqsirah/production/`.
The public page loads `script.js?v=v524-3debb9de74d1`, including the English-only
language-preference correction. Public checks wait for asynchronous script
initialization before asserting visibility.

## Arabic quotation repair

The supplied PDF's layout extraction split and reordered Arabic words, sometimes
displacing Arabic into English translations. On 2026-11-14, the user explicitly
requested correction in production. `data/yqsirah-arabic-repairs.json` records
483 exact replacements in 171 passages, with Quran references or PDF evidence.
Quran text comes from the canonical Quran corpus, retaining the originally
quoted partial-ayah and multi-ayah boundaries. Other quotation repairs restore
the PDF wording without substituting another narration or inventing vowels.
Names, poetry, and unrelated Arabic prose are outside this repair's scope.

`yqsirah-arabic-repairs.js` applies the same checked overlay to future imports.
It checks the original passage hash, rejects missing/overlapping replacements,
preserves footnote identities and English words, and records original and repair
hashes in provenance. The Ta'awwudh footnote also restores the position of the
English word "I", which the PDF had displaced. Standalone Arabic quotations and
their English translations are separate paragraphs for correct text direction.

The production migration is dry-run by default:

```sh
node bin/utils/repair-yqsirah-arabic.js
node bin/utils/repair-yqsirah-arabic.js --apply
node bin/buildSearchIndex.js --book-id 100427 --skip-commentaries
node bin/utils/flush-book-disk-cache.js yqsirah
```

Applied transactionally; exact readback passed for all 171 passages. A second
run reported zero pending changes. The before-state, including provenance,
remains on the production server at
`var/imports/yqsirah-arabic-repair/before-1794687685680.json`.
The book was reindexed and its disk/runtime caches refreshed. Local audit
artifacts and public browser checks are in
`var/imports/yqsirah/arabic-repair/`. Reference-link enrichment remains deferred.

## Author and transcription credits

`data/yqsirah-metadata.json` supplies the author credit and description for future
imports. The description includes Shaykh Dr. Yasir Qadhi's biography, sourced to
Miftaah Institute, and credits Muhammad Abdul Rahman for transcribing the videos.
The acknowledgment thanks him for his work and retains the introductory note's
request for du‘a for the contributors and their families. The guarded migration
`node bin/utils/update-yqsirah-metadata.js --apply` updates only `author_en` and
`description`, with a server-side backup and exact readback verification.

The subsequent `هللا` → `الله` spelling correction covers 134 remaining
occurrences in 101 passages (including one presentation-form spelling), including names, prose, and footnotes. The importer
applies `yqsirah-allah-spelling.js` after the reviewed quotation overlay.
`repair-yqsirah-allah-spelling.js` checks provenance, backs up affected rows on the
server, updates body/search text and notes transactionally, and verifies no
literal occurrences remain. No other spelling or wording is changed.

## Restoring the original transcript after website edits

`reimport-yqsirah.js` restores the complete original PDF text with the reviewed
Arabic repairs and Allah spelling corrections. It retains the current reviewed
53-chapter / 490-section / 533-subsection outline, passage IDs and references,
source provenance, book description, and author/transcriber credits. It does not
redeploy code or replace the book identity.

Run a read-only comparison first:

```sh
node bin/utils/reimport-yqsirah.js
```

The output reports changed bodies, search text, notes, titles, and a state hash.
Only after restoration has been explicitly authorized, apply that exact state:

```sh
node bin/utils/reimport-yqsirah.js --apply --expected-state=<dry-run-state>
```

The tool refuses missing/reordered passages, changed hierarchy, and unreviewed
heading edits. It locks and checks the current state again before updating.
Full copies of this book's `hadiths` and `yqsirah_source_entries` rows are backed
up in timestamped database tables on the database host, in the same transaction
as the restoration. Backup table names are recorded in the local restoration
report under `var/imports/yqsirah/reimport/`. Bodies are not exported from the
database for comparison. Readback must exactly match the source plan before
commit; a subsequent dry run must report zero changes.

After a successful authorized restoration, reindex only book `100427` and flush
only the `yqsirah` book cache using the existing maintenance commands. Code files
must follow the normal Git workflow; do not copy patches to production or reload
application workers as part of this data restoration.
