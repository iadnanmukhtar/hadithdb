# Sharḥ navigation index

The reader checks the existing disk sequence cache, then the `sharh_navigation`
Elasticsearch index. SQL is used only when neither has a usable sequence (including
an ES outage or a book that has not been indexed). The ES index is independent of
the HTML asset/cache version, so a deployment or disk-cache eviction does not
require rebuilding the book order in SQL.

Each document is keyed by Sharḥ `books.id`. It stores one complete ordered sequence,
including heading introductions and deduplicated hadith pages, plus dependencies on
physical/virtual source books, hadith IDs and heading IDs. This avoids partial
neighbor updates and preserves the existing SQL reading order. Publication uses ES
optimistic concurrency control, then invalidates the disk sequence and cached page
HTML that embeds previous/next links.

## Initial rollout

Check snapshot coverage without rebuilding navigation or writing anything:

```sh
node bin/buildSharhNavigationIndex.js --check
```

This reads the Sharh book catalog and one ES document per book. It reports
`ready`, `missing`, `invalid`, or `unavailable`, and exits nonzero if any snapshot
is not ready. Add `--book=malik-zarqani` to check one book. This checks structural
validity and coverage; use the default dry run below to compare content with SQL.
`--check` cannot be combined with `--apply`.

From a checkout containing this change, validate without writing:

```sh
node bin/buildSharhNavigationIndex.js --book=malik-istidhkar
```

After deployment is authorized, publish all book snapshots before restarting the
application workers on the new code:

```sh
node bin/buildSharhNavigationIndex.js --apply
```

`--book=alias --apply` limits publication to one book. Publication invalidates
affected disk/HTML caches. The full `buildSharhSearchIndex.js` command also builds
navigation after indexing commentary text.

Verify a cold-disk passage request uses `sharh_navigation/_doc/<bookId>` and does not
run the `reader_entries` SQL query. Warm requests should use the disk cache.

When the reader falls back to SQL, `hadithdb:SharhNavigation` logs the book ID,
alias and snapshot failure reason, together with the request URL when available.

## Updates

Hadith indexing refreshes navigation for both previous and current commentary
books. Heading-commentary edits, heading indexing, virtual ownership changes, and
book alias changes refresh their affected sequences. Unchanged sequences do not
rewrite ES or invalidate cached pages. Failed index refreshes remain errors and
must be retried; the reader retains its SQL fallback when ES is unavailable.

After direct SQL imports or structural repairs that bypass these application
paths, run the navigation builder for the affected books, or the full Sharḥ index
builder. Do not assume flushing HTML alone refreshes an ES snapshot.
