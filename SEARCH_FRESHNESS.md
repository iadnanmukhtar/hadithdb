# Search freshness

Google chooses crawl timing and whether to show a date in results. A relative
byline such as “40 minutes ago” describes an estimated publication/update time,
not a promise of an immediate crawl. Ordinary Quran, hadith and community pages
are not eligible for Google's job/livestream-only Indexing API.

## Implemented signals

- Community's anonymous landing page derives its visible UTC date and WebPage
  `dateModified` from the public items actually rendered. Draft timestamps are
  excluded. A nullable `community_posts.public_updated_at` records subsequent
  public revisions; historical unknown revisions are not invented. First
  publication uses `published_at`. Unchanged publication leaves the date alone.
- Individual hadith and Quran reader pages use persisted `lastfixed` correction
  timestamps for visible dates and structured data. Missing/invalid/future dates
  are omitted. These refer to the site's editorial content, not the historical
  date of scripture. Counters and general `lastmod` timestamps are excluded.
- Tafsir passage pages expose stored commentary `lastmod` revisions in their
  visible dates and structured data, including SQL fallback reads. Remote sources
  without a reliable revision date omit it. The Quran updates sitemap also lists
  up to 1,000 recently updated, visible local tafsir passages using canonical
  passage-range URLs. Hidden, empty and remote commentary records are excluded.
- Sharh pages use `content_updated_at` across all rendered explanation entries.
  Both hadith and heading explanations enter the Hadith updates sitemap (up to
  1,000 pages). Startup adds nullable revision columns without backdating old
  rows, then enables defaults for future inserts and automatic update timestamps.
  SQL imports and editor changes are covered; identical updates leave dates alone.
- Sirah/history books and individual entries are included in both corpus and
  recent-updates sitemap queries. Their shared detail renderer uses correction
  dates. The Hadith corpus sitemap cache version changes to rebuild old lists.
- All published Community articles are enumerated regardless of Blog feature
  status or feed position. Membership is refreshed outside the corpus cache, so
  newly published and unpublished articles are reflected on the next request.
  Recent articles are selected by public revision date; their detail pages and
  imported Blog pages show the same public date. Draft timestamps are excluded.
- Each domain's existing sitemap index now advertises `/sitemap-updates.xml`.
  This uncached supplement contains up to 1,000 recently corrected physical
  corpus records with `lastmod`, including untitled records, and on the Hadith
  domain, the Community landing page, up to 1,000 recently published/updated
  articles from the full archive, and public posts in its current feed.
  The complete paginated catalog sitemaps remain available. Virtual aliases
  remain in the catalog; this supplement does not enumerate their revisions.
- Existing update/reindex/cache invalidation continues to govern reader HTML.
  The supplemental sitemap reads committed SQL dates on each request.

## Deployment and Search Console

Deploy only with owner approval. The normal Community schema initialization adds
one nullable column idempotently. Rebuild/clear existing reader HTML caches on
deployment so the new visible dates and JSON-LD appear in cached pages too.
Confirm the content index has received the latest corrected records.

Verify `/robots.txt`, `/sitemap.xml`, and `/sitemap-updates.xml` on both domains,
and inspect a corrected hadith, Quran ayah and `/community` in rendered HTML.
Confirm dates reflect the stored revisions and don't change on repeated loads.
Submit each domain's `/sitemap.xml` once in its verified Search Console property;
Google can then discover the new child sitemap automatically. For a few urgent
URLs, use URL Inspection → Request indexing. Repeated submissions don't speed
up crawling. Monitor last crawl and indexed content; do not interpret sitemap
availability as proof Google has indexed an update.

References:
- https://developers.google.com/search/docs/appearance/publication-dates
- https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl
- https://developers.google.com/search/blog/2023/06/sitemaps-lastmod-ping
- https://developers.google.com/search/apis/indexing-api/v3/quickstart

## Local validation

- 27 focused tests passed across page freshness, sitemap delivery, Community
  representations, and social metadata; all five edited EJS templates compile.
- The isolated MySQL publication test passed against disposable prefixed tables:
  publishing a changed revision advances the date; draft saves and identical
  republishes preserve it.
- The separate `communitySocialMetadata` suite has four failures in unchanged
  paths: three fixtures omit `req.query`, and one cover expectation conflicts
  with the existing fallback image. These are not counted as passing validation.
- No local application was listening on port 3004; production deployment,
  full-page visual checks, and Search Console verification have not been done.
- Sharh extension: 59 focused tests passed across Sharh rendering/cache, both
  commentary sitemap paths, date metadata, and sitemap delivery. A separate
  disposable-table MySQL test verified migration idempotence, preserved NULL
  historical dates, new-insert dates, changed edits, and unchanged updates.
- A broader Sharh book-assignment suite exposed an existing template fixture
  missing `utils.urlFor` in the unchanged book-page test; it is not counted as
  passing validation. Passage fixtures now include the new freshness helper.
