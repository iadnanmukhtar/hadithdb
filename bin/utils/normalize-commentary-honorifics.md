# Scoped commentary honorific cleanup

Dry-run first; add `--apply` for transactional text updates, before/after backups,
exact readback, and index/cache refresh. Existing IDs and ownership are retained.

```sh
node bin/utils/normalize-commentary-honorifics.js \
  --source-book-ids=-5,-6,-7,-8,-9,-10,-11,-12 \
  --book-ids=32,57,61,100419
```

`--source-book-ids` selects `hdith_sharh_sources.source_book_id` namespaces,
covering both hadith commentary and `hdith_toc_sharh` introductions. With this
option, unrelated Tafsir and commentary sources are excluded. `--book-ids`
additionally scopes ordinary `toc.intro`/`intro_en` fields. For introductions
alone, use `--introductions --book-ids=...`.

The shared normalizer handles ﷺ and ؓ, preserves protected quotations and URLs,
and is idempotent. Source importers should invoke it only after raw source
extraction, identity checks and conservation audits. Backups and refresh manifests
are saved under `var/imports/commentary-honorifics/<timestamp>/`.

`--apply --skip-refresh` commits the text changes and backups but defers index
and cache refresh. Before serving the completed migration, rebuild any listed
`tocBookIds` with `buildSearchIndex.js --book-id <id> --toc-only`, then call the
exported `refresh(manifest, backupDirectory)`. When applying consecutive passes,
finish earlier refreshes before refreshing the final pass.

Remote application processes need the existing `/reinit` refresh after the local
migration. Verify sample stored/indexed/rendered content and rerun the scoped
read-only audit to confirm zero remaining eligible changes.
