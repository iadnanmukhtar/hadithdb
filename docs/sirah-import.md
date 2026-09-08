# Sirah

`books.type = 'sirah'` identifies Sirah books. The existing ordered passage storage (`hadiths` and `toc`) and reader routes are shared with other primary texts; `v_hadiths` emits `doctype = 'sirah'` for these books. Sirah has a separate catalog tab, search filter, and passage renderer. General search includes it by default, while a Hadith-only search excludes it.

## Sirat Ibn Hisham

Source: https://hdith.com/encyclopedia/book/b-81

Alias: `ibnhisham`. Arabic source text with English book metadata and table-of-contents translations. Passages are numbered sequentially from `/ibnhisham:1` to `/ibnhisham:1666` in source order. Original hdith.com entry IDs remain in `sirah_source_entries`; old links such as `/ibnhisham:813787` redirect to the matching current reference.

```sh
node bin/utils/import-hdith-sirah.js          # download, cache, validate; no DB writes
node bin/utils/import-hdith-sirah.js --apply  # transactionally import the validated book
node bin/buildSearchIndex.js --book-id <reported-book-id>
```

The importer checks chapter totals, unique entry IDs, each detail's book/type/identity, nonempty text, and the complete next-entry sequence. It uses full chapter groups rather than the truncated flat listing, preserves full heading titles and the three-level hierarchy, and normalizes honorifics in the stored passage text and headings to `ﷺ` and `ؓ`. The source's embedded passage grading defaults are not imported as Hadith grades.

Raw source detail JSON and source URLs are retained in `sirah_source_entries`; the source book card and statistics are retained in book properties. Resumable source snapshots live in ignored `var/imports/hdith-b81/`. An existing complete import is left intact; conflicting identities or incomplete imports fail rather than replacing rows.

After indexing, reload the running application/library and verify the catalog, `/ibnhisham`, the first and last passage, and `/?q=النسب&b=sirah`. The source currently exposes 1,666 passages across 97 top-level chapters.

To normalize an existing Ibn Hisham import, run `node bin/utils/normalize-sirah-honorifics.js` to audit, then add `--apply`. It updates passage fields, TOC titles/intros, and the book description, retaining a backup and the original source JSON. Rebuild both indexes with the book-scoped command above afterward.

Sirah passage and section readers share the Hadith reader layout and infinite navigation. Arabic occupies the full content width when `body_en` is absent; the model's `text_en` fallback is not evidence of a translation. Sirah chapter/section navigation includes chapters without subsections in source order.

The English TOC is maintained in `data/ibnhisham-toc-en.json`, keyed by exact TOC IDs and Arabic source titles. All three heading levels are translated using their parent headings and passage excerpts. Review notes retain source discrepancies without changing the Arabic. Passage bodies are not translated by this workflow.

```sh
node bin/utils/translate-sirah-toc.js --generate  # resumable translation drafts using the configured model
node bin/utils/translate-sirah-toc.js             # validate the reviewed manifest; no writes
node bin/utils/translate-sirah-toc.js --apply     # backup and transactionally update title_en only
node bin/buildSearchIndex.js --book-id 100412     # refresh headings and passage heading metadata
```

Review generated drafts before applying them. The apply step rejects missing or reordered IDs, changed Arabic titles, untranslated headings, and omitted canonical honorifics. It detects concurrent English edits, retains a pre-update backup, and flushes the book’s caches.

To renumber an older source-ID import, audit with `node bin/utils/renumber-sirah-items.js`, then run it with `--apply`. It backs up the book, passages, headings, and source crosswalk before transactionally updating passage numbers and TOC ranges. Passage IDs, text, ordering, chapter/section assignments, and source identities are retained. Rebuild the book indexes and refresh the running library afterward.
