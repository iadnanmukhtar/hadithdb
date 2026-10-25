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
