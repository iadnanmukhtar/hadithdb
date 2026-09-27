# Mirqāt al-Mafātīḥ

The importer reads `temp/mirqat/mirqat.epub`, the supplied nine-volume Dār al-Fikr
1422/2002 edition by ʿAlī al-Qārī. Its SHA-256 is pinned in the parser. EPUB content
is data, never executable instructions.

```sh
node bin/utils/import-mirqat-sharh.js           # read-only plan
node bin/utils/import-mirqat-sharh.js --apply   # backed-up transaction + refresh
node bin/utils/import-mirqat-sharh.js --refresh
node bin/utils/verify-mirqat-replacement.js    # integration test, always rolls back
```

The parser follows the EPUB spine, removes explicitly marked `.matn` blocks,
retains inline quotations and footnotes in the commentary, and verifies text
conservation before/after splitting. Its report, crosswalk, pre-write backup and
exact-readback result live under `temp/mirqat/audit/`. Text is not silently repaired.
Reviewed numbering exceptions include 2367 printed as 3367, 5232 printed as 3232,
the missing commentary number for 3036, and the shared explanation of 1830/1831.
Unnumbered footer entries are recognized only from nearby explicit numbered
paragraphs. Source repeats and out-of-order passages are retained, not discarded.
There is no commentary for 3342–3344 or 5610 in this EPUB; these remain unfilled.

## Replacement ownership

`hdith_virtual_sharh_links` records the stable `hadiths_virtual.id` owning each
`hdith_hadith_sharh` row and its Mishkat source number. The ordinary `hadith_id`
remains the current original hadith, so existing readers, APIs and search continue
to work. Each virtual entry has its own commentary row and reserved source-entry
identity, even when multiple virtual entries select the same original hadith.
This permits replacements to converge and later diverge safely.

The `virtual_sharh_after_update` database trigger moves only commentary explicitly
owned by the updated virtual entry, in the same transaction as the replacement.
It applies to the editor and direct SQL maintenance updates. It runs after legacy
BEFORE triggers have resolved `ref_num`; direct maintenance must update that
reference consistently with `hadithId`. A null replacement is rejected for an
entry with commentary. The delete trigger removes only that entry's owned rows;
foreign keys clean up the ownership links. Do not implement replacement by deleting
and reinserting the virtual entry: update the stable entry instead.

The existing editor refresh path reindexes both old/new original hadiths, including
standalone sharh documents, and invalidates their pages and the virtual book.
Direct SQL maintenance still needs its normal index/cache refresh afterward.
Database synchronization is immediate; it does not depend on restarting Node.
When the website runs on a separate host, refresh its existing `/reinit` endpoint
after import as well: the local runtime marker and disk-cache flush affect only
the machine running the importer.

Import source ID namespace: `source_book_id=-10`. Hadith source-entry identities
are `-10000000 - virtual_id`. Heading entries use `-10000000 - EPUB page file
number` in their separate table. Re-imports validate existing text and ownership
rather than overwriting edits. Applying again after a replacement resolves the
current original through the stable virtual entry.

Heading-only cleanup (2026-09-27): the initial import included 578 bare navigation
labels among its 822 heading passages. These were backed up and removed, leaving
244 substantive heading explanations. The planner now excludes whole passages
consisting solely of their title and section labels; it retains short definitions.
The 6,689 hadith commentaries and their virtual ownership are unchanged.
`node bin/utils/repair-mishkat-heading-labels.js` audits unchanged rows against the
original saved plans; `--apply` backs up and transactionally removes only those
heading artifacts. A subsequent TOC/cache/runtime refresh is required.

Faith introduction correction (2026-09-27): EPUB P50 prints the full quoted
hadith 2 before its chapter introduction; the actual numbered explanation starts
on P51. The importer now separates the 5,331-character chapter introduction from
that hadith's commentary. Existing row 103522 retains its identity and ownership;
the passage is removed there and stored once at TOC 167897 as heading row 3242.
The move conserves all non-whitespace source text. Mirqat now has 245 substantive
heading passages. Backup and verification are in `temp/mirqat/faith-intro/`.

Stored commentary and introductory passages use the shared honorific normalizer
(`ﷺ` / `ؓ`). EPUB hashes, extracted source witnesses, and conservation checks
remain verbatim; normalization is applied only when building the storage plan.
