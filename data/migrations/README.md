# Virtual hadith snapshot refresh

`refresh_v_hadiths_virtual_snapshot` must publish replacement rows in one InnoDB transaction. Deleting rows in autocommit mode (or using `TRUNCATE` for a full refresh) exposes an empty collection to readers. A request during that gap can leave an empty chapter cached until invalidated or expired.

Install the checked-in procedure with:

```sh
node bin/utils/install-atomic-virtual-snapshot.js          # inspect
node bin/utils/install-atomic-virtual-snapshot.js --apply  # back up and install
```

Run this on a dedicated connection outside any application transaction. The installer verifies InnoDB, takes the refresh lock, saves the original definition under `~/.hadithdb/backups`, and restores it if replacement fails. The procedure rolls back an unsuccessful replacement and preserves the previous complete snapshot. Both direct application calls and the database event queue use this procedure.

`VirtualHadithSnapshot` also invalidates the affected book's disk caches after a queued refresh commits. The earlier save-time invalidation alone cannot remove pages rebuilt while the background refresh runs. `VirtualHadithReader` checks the underlying links when a snapshot query is empty, recovers the exact page from the live view when possible, and propagates a non-cacheable error if linked content cannot be loaded. Genuinely empty headings and exhausted pages remain valid. Book-cache cleanup uses indexed filename ranges rather than scanning the entire cache index, and concurrent cache-index initialization retries transient SQLite journal-mode locks.

Focused regression tests:

```sh
npx jest --runInBand spec/atomicVirtualSnapshot.spec.js spec/virtualHadithSnapshot.spec.js spec/virtualHadithReader.spec.js
HADITHDB_MYSQL_INTEGRATION=1 npx jest --runInBand spec/atomicVirtualSnapshot.mysql.spec.js
```

The opt-in MySQL tests create and remove uniquely named fixture tables and a fixture routine in the configured database. They check concurrent reads during successful book/full refreshes and rollback after forced insert failures, without changing application records.

# Reader SQL load reduction (November 8, 2026)

The grading query rewrite requires two secondary indexes **before application deployment**:

```sh
node bin/utils/add-grade-lookup-indexes.js          # inspect only
node bin/utils/add-grade-lookup-indexes.js --apply  # approved production migration
```

The installer checks existing definitions and adds `(grader_source_id,id)` and `(grader,id)` indexes with `ALGORITHM=INPLACE, LOCK=NONE`. It fails after five seconds waiting for a metadata lock instead of waiting indefinitely. DDL is not transactional; if the second index fails, the first remains and rerunning safely completes the missing index. It neither updates grades nor changes translation precedence. Do not deploy the new grading SQL without these indexes: its separate lookups still scan without them. After applying, verify `EXPLAIN` selects the new indexes for `shared_grade` and compare statement-digest deltas under comparable traffic. No production indexes were applied during local verification.

`HadithGradeLookup` replaces the correlated source-ID/name `OR` with independent equality lookups and chooses the lowest matching row ID. It retains own translations, database collation, NULL/empty behavior, and legacy fallback. The same expression is used in single-hadith and export/batch metadata queries. A read-only MySQL fixture test verifies those semantics:

```sh
HADITHDB_MYSQL_READ_TEST=1 npx jest --runInBand spec/gradeLookup.mysql.spec.js
```

`QuranMushaf` now reads only word identities and page ranges once per worker, computes all first/last ayah page mappings, and shares the in-flight build. Surah starts reuse that snapshot. Existing mapping/all-cache invalidation clears the snapshot; generation checks prevent older builds from repopulating it. Failed builds retry. Live-data verification matched all 6,236 ayahs (83,668 words, 8,820 ranges) against an independent range calculation, plus four SQL spot checks. The initial two reads took 416 ms including remote network time; subsequent lookups require no SQL. This is a bounded corpus snapshot, not a cache entry for arbitrary query parameters.

The exact expensive `SELECT * FROM v_hadiths WHERE hId=... LIMIT 1` pattern had two local callers: `Sharh.hadithOwner` (missing/stale/unavailable Elasticsearch reader metadata) and the admin similar-candidate suppression action. Both now use `HadithTranslationIndexView.byId`, which retains the complete view projection but restricts the TOC and grade aggregate **inside** their derived queries. The old EXPLAIN materialized about 275,000 grade links and all physical TOC branches; the new sampled plan used single-record index lookups. Three live read-only lookups took 57–67 ms including network time. These are not an apples-to-apples comparison with the historical 164-second average, and the historical digest cannot separate these two callers.

Commentary action-bar/source identity requests call `ContentItems.source` → `Sharh.entryById`. They now ask only for the owner's identity, bypassing Elasticsearch/full reader-view hydration entirely. Full Sharh reading still validates current structural identity and retains the scoped SQL fallback. Other corpus-wide `v_hadiths` consumers (indexing/downloads and legacy admin queries without this exact pattern) are outside this narrow change.

Focused checks include `mysqlLoadReduction`, `sharhPassage`, `mcpQuranNavigation`, `quranCacheInvalidation`, `hadithMetadataBatch`, `contentItems`, and `communityActivitySource` Jest suites. Two existing `hdithMetadataDisplay` static assertions about CSS/markup fail against unchanged template/stylesheet files; they are unrelated to this SQL change. Existing unrelated worktree edits must not be included inadvertently in a deployment. Do not clear all caches as part of rollout; compare MySQL statement counts/rows examined and worker CPU after the approved migration and application deployment.
