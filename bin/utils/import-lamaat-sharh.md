# Lamaat commentary for Mishkat

Imports the supplied `temp/lamaat/lamaat.epub`, **لمعات التنقيح في شرح مشكاة
المصابيح**, by عبد الحق بن سيف الدين الدهلوي. SHA-256:
`06688a9634f57f80386a032c30a8f09d57919c2a067c7cda701610c3e1e79b6c`.
The edition has 6,316 EPUB pages in ten volumes. Volumes 1–9 contain the
commentary through Mishkat 6294; volume 10 contains supplementary works,
biographical material and indexes. Its text is retained as a separate appendix
passage on the introduction, not appended to hadith 6294. Repeated volume title
and copyright leaves (printed pages 1–4) are excluded from commentary.

The parser removes explicitly marked quoted Mishkat text, preserves commentary,
source spellings and footnotes, and verifies text conservation. It splits explicit
numbered explanations and chapter definitions. Eight printed numbering errors
are corrected only in attachment metadata after comparison with the quoted
Mishkat text. Three explicit numbers lack the usual bracketed local number;
reviewed anchors cover those. The unmarked quotation and explanation for 4591
are preserved together under their shared number. Explicitly co-numbered
explanations are attached to each specified number.

Coverage: 6,290 Mishkat numbers, 6,689 virtual-reference commentary links, and
295 substantive heading passages (including two introductory/appendix passages).
Numbers 1901, 2410, 2797 and 6078 have no separately identifiable commentary;
no content is inferred for them. 884 structural-only heading passages are
excluded. Brief real explanations remain. Footnote descriptions of books cannot
become chapter headings. A section without numbered hadiths is mapped by its
section label, not by the next hadith's section.

Ownership uses `hdith_virtual_sharh_links`, storing commentary on the selected
original hadith. Replacing a Suyuti/misc reference moves its Lamaat commentary
with the existing Mirqat/Miraat commentary. Source namespace is `-12`; hadith
source-entry IDs are `-12000000 - virtual_id`; headings use
`-12000000 - EPUB_file * 10 - level`. Existing source edits cause validation to
fail rather than being overwritten.

Run:

- `node bin/utils/import-lamaat-sharh.js` — read-only validation/plan.
- `BULK_INDEX_GZIP=1 node bin/utils/import-lamaat-sharh.js --apply` — backup,
  transactional import, exact readback, indexes, and local cache refresh.
- `--refresh` repeats indexing; `--skip-refresh` omits indexing.
- `npx jest --runInBand spec/lamaatSharh.spec.js spec/sharhHeadingContent.spec.js spec/virtualHadithSharh.spec.js spec/virtualHadithEditing.spec.js`
- `node bin/utils/verify-mirqat-replacement.js` — rolled-back integration tests
  for all owned commentaries, including Lamaat after import.

Audit plans, source text, backups and verification receipts are under
`temp/lamaat/audit/` and are excluded from version control. A remote website also
needs its existing `/reinit` refresh; local disk/runtime refresh does not affect
the remote process.

Verified on 2026-09-27 as source **3224**, alias **mishkat-lamaat**. Exact SQL
readback, 6,689 standalone search documents and representative embedded hadith
commentary fields passed. Live checks passed for `bukhari:6689`,
`misc:mishkat-43`, `muslim:2174`, `tirmidhi:3001`, Mishkat section 1/1/2 and the
introduction. Mirqat and Miraat fingerprints were unchanged. Rolled-back Suyuti
and misc replacements moved all three commentaries, preserved unrelated rows,
rejected empty replacements and verified scoped deletion. All 28 focused tests
passed. Verification receipts are in the source audit directory.

Stored commentary and introductory passages use the shared honorific normalizer
(`ﷺ` / `ؓ`). EPUB hashes, extracted source witnesses, and conservation checks
remain verbatim; normalization is applied only when building the storage plan.
