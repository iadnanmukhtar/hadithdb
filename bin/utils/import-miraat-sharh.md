# Mirʿāt al-Mafātīḥ for Mishkat

Imports the supplied `temp/miraat/miraat.epub`: **مرعاة المفاتيح شرح مشكاة المصابيح**, by **عبيد الله الرحماني المباركفوري**. This is a different work from al-Qari's Mirqat.

The EPUB contains 4,545 pages from volumes 1–9, ending with Hajj. Its last colophon announces volume 10 (sales), which is not present. Source number 2783 corresponds to **Mishkat 2758**. The import does not claim coverage of later Mishkat material.

## Source-faithful alignment

The source's running numbers differ from HadithDB's Mishkat edition: for example, source 283 → Mishkat 281. `miraat-alignment.json` pins the EPUB SHA-256, reviewed printed-number corrections, exact paragraph/heading witnesses, the source-to-Mishkat crosswalk, and exact reviewed TOC identities. The map was checked against the quoted matn and continuous sequence. Reviewed short-reference exceptions and explicitly combined variants are recorded separately. Numbers inside source text are preserved verbatim, including printing errors.

The parser removes explicitly marked quoted matn and navigation markup, retains explanation text and footnotes, and proves text conservation before mapping. Bibliographic/title leaves are metadata; the introduction and volume-one appendices are attached as attributed introduction commentary. Chapter commentary is separated at its own textual boundary, including when it follows the prior hadith explanation on the same page.

The plan contains **2,968 owned hadith links**, covering **2,756 Mishkat numbers**, plus **139 introduction/chapter passages** across 138 TOC nodes. Source numbers 232 and 314 (Mishkat 231 and 313) have no separately identifiable commentary passage and remain unfilled. Explicitly combined reports can map to multiple Mishkat references; co-numbered reports mapping to one reference are stored once per passage.

## Storage and replacement behavior

Source namespace: `source_book_id=-11`; catalog alias: `mishkat-miraat`.

Commentary is stored on each Mishkat entry's selected original `hadiths.id`, with stable ownership in `hdith_virtual_sharh_links`. A replacement moves that commentary row to the new original hadith. Stable per-virtual-entry source keys permit multiple Mishkat entries to converge and later diverge without losing their own shuruh. Existing Mirqat and original-book commentaries are preserved.

## Running and checking

- `node bin/utils/import-miraat-sharh.js` generates a read-only plan.
- `node bin/utils/import-miraat-sharh.js --apply` backs up existing source data, imports in a transaction, verifies exact readback, and refreshes search and local caches.
- `--refresh` repeats only indexing/cache refresh; `--skip-refresh` skips it.
- `npx jest --runInBand spec/miraatSharh.spec.js spec/mirqatSharh.spec.js spec/virtualHadithSharh.spec.js spec/virtualHadithEditing.spec.js`
- `node bin/utils/verify-mirqat-replacement.js` checks live transfer of all owned commentary on selected virtual entries, with every test mutation rolled back.

Artifacts are stored under `temp/miraat/audit/`: source inspection, extracted passages, plan, backups, apply receipt, and verification results. EPUBs and extracted source text remain outside version control.

## Verified import

Applied on 2026-09-27 as source **3223**, alias **mishkat-miraat**. Exact database readback, idempotent re-import, 2,968 standalone search documents, and original-hadith search fields were verified. Live checks passed for `bukhari:6689`, `misc:mishkat-43`, `muslim:223`, `misc:mishkat-2758`, and the Mishkat introduction. Both Mirqat and Mirat transferred together in rolled-back Suyuti/misc replacement tests; unrelated commentary was preserved. All 35 focused tests passed.

Heading-only cleanup (2026-09-27): six bare navigation labels were backed up and
removed from the original 139 heading passages, leaving 133 real explanations.
The planner excludes these on future imports. Short commentary such as
`(الفصل الثاني) أي المعبر به عن قوله من الحسان في المصابيح.` is retained.
All 2,968 hadith commentaries and their ownership links remain unchanged. The
shared repair command is documented in `import-mirqat-sharh.md`.

Stored commentary and introductory passages use the shared honorific normalizer
(`ﷺ` / `ؓ`). EPUB hashes, extracted source witnesses, and conservation checks
remain verbatim; normalization is applied only when building the storage plan.
