# Sirah

`books.type = 'sirah'` identifies Sirah books. The existing ordered passage storage (`hadiths` and `toc`) and reader routes are shared with other primary texts; `v_hadiths` emits `doctype = 'sirah'` for these books. Sirah has a separate catalog tab, search filter, and passage renderer. General search includes it by default, while a Hadith-only search excludes it.

## Sirat Ibn Hisham

Source: https://hdith.com/encyclopedia/book/b-81

Alias: `ibnhisham`. Arabic source text; English book metadata only. References use the source entry ID, e.g. `/ibnhisham:813787`. Source paragraph numbers are not substituted for entry identities.

```sh
node bin/utils/import-hdith-sirah.js          # download, cache, validate; no DB writes
node bin/utils/import-hdith-sirah.js --apply  # transactionally import the validated book
node bin/buildSearchIndex.js --book-id <reported-book-id>
```

The importer checks chapter totals, unique entry IDs, each detail's book/type/identity, nonempty text, and the complete next-entry sequence. It uses full chapter groups rather than the truncated flat listing, preserves full heading titles and the three-level hierarchy, and stores the unmodified source `matn`. The source's embedded passage grading defaults are not imported as Hadith grades.

Raw source detail JSON and source URLs are retained in `sirah_source_entries`; the source book card and statistics are retained in book properties. Resumable source snapshots live in ignored `var/imports/hdith-b81/`. An existing complete import is left intact; conflicting identities or incomplete imports fail rather than replacing rows.

After indexing, reload the running application/library and verify the catalog, `/ibnhisham`, the first and last passage, and `/?q=النسب&b=sirah`. The source currently exposes 1,666 passages across 97 top-level chapters.
