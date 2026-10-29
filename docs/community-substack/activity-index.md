# Persistent Community activity index

The feed can now select a page from `community_activity` before loading post bodies, rendering Markdown or joining source metadata. The index stores one record per source event: source/type, source record ID, actor UID, activity timestamp and a stable index ID. It does not duplicate every follower's feed or retain snapshots of private content, public names or photos.

The existing content/source tables already persist titles and canonical references. Only the selected page is hydrated from those records. Current public names, photos, reaction counts and viewer state are applied after pagination, so profile and source edits do not require rebuilding historical feed text. Reposts still use their existing source resolver, bounded by the selected page.

## Indexed reads

- Everyone, Following, personal and author scopes use the same index. Source visibility is checked in SQL **before** `LIMIT`, including unpublished/deleted parents and removed comments/reposts.
- Each query returns at most 21 eligible index records: 20 displayed candidates and one lookahead. Only those 20 IDs reach the existing source loaders.
- Subsequent requests use an opaque cursor containing the last database timestamp and unique index ID. Cursors are bound to feed scope/filter/author/account. Both values participate in descending keyset pagination, including equal timestamps.
- The cursor uses database-formatted millisecond timestamps to avoid application timezone/precision drift. API access and visibility are independently checked; the cursor is a position, not an authorization token.
- Legacy offset clients still work through a bounded compatibility path. The UI sends the cursor and resets it when its feed/filter/account changes. Deeper indexed pages are not subject to the old 10,000-item UI limit.
- If content changes between index selection and hydration, the existing loaders recheck visibility. A page may become short, but its cursor advances past the scanned records. Compact same-type activity grouping and the first-page microinteraction pause remain intact.

## Write maintenance

An explicit migration installs INSERT/UPDATE/DELETE triggers on the nine existing source tables: posts, Community comments, reader/blog reflections, Community likes, reader likes, reader/blog reflection votes and reposts. These update the index within the source transaction, including writes made through older endpoints or repair tools. There is no asynchronous queue to fall behind.

Source tables must exist and use InnoDB; migration preflight rejects other engines without modifying them. Existing business data and source mutation handlers remain authoritative. Deleting or undoing an event removes its index row. Hiding a parent immediately excludes associated events through the read-time visibility condition; republishing can restore eligible historical activity.

Historical votes lack a native timestamp. Backfill uses their mirrored Community-like date when available and otherwise preserves an existing indexed date or uses an explicit epoch ordering fallback. New native vote events record their mutation time. Backfill does not invent a present-day date for undated historical activity.

## Deployment / backfill

The database migration was explicitly authorized and completed on October 29, 2026. Application deployment remains separate. These are the migration and maintenance commands using the application's usual database configuration:

```sh
# Read-only eligibility counts; does not create schema or install triggers.
node -r dotenv/config bin/community-activity-index.js

# Explicitly create the index, install maintenance, backfill and activate reads.
node -r dotenv/config bin/community-activity-index.js --apply
```

The application database principal needs CREATE and TRIGGER privileges for migration. An advisory lock prevents concurrent installers. Installation disables indexed reads first; readers continue using the existing feed until backfill completes. Triggers are installed before copying history. Backfill locks and projects batches of 500 source rows in transactions, preventing a stale snapshot from overwriting a concurrent edit or delete. Unique source keys make reruns idempotent. Activation happens only after all sources finish; an interrupted run stays on the old reader and can be rerun.

To revert indexed reads while retaining maintenance and backfill progress:

```sh
node -r dotenv/config bin/community-activity-index.js --disable --apply
```

An outstanding cursor receives a refresh response if indexed reads are disabled. The UI's retry resets the cursor. Do not drop the index tables while source triggers still reference them.

## Validation

Focused tests cover cursor scope validation, fixed candidate limits on deep pages, full-feed hydration bounded to selected IDs, timestamp ties, draft/public filtering, selected-source loading, activation-after-backfill, and client cursor reset/compact grouping behavior. Existing Community identity/privacy/activity tests are also exercised.

`spec/communityActivityIndex.mysql.spec.js` provides a local-only disposable database test for actual triggers, rollback, visibility changes, native votes, reposts and pagination through 1,000 tied events. It deliberately does not use the application's configured remote database:

```sh
COMMUNITY_ACTIVITY_TEST_URL='mysql://USER:PASSWORD@127.0.0.1:3306' npm test -- --runInBand spec/communityActivityIndex.mysql.spec.js
```

The current environment has no local MySQL server or running Docker daemon, so that integration suite has not been executed. No wall-clock database speedup is claimed. After migration, compare first/deep page latency and examine query plans on realistic data; indexes cover time, actor/time, kind/time and actor/kind/time. Following-feed cost can still depend on the number of followed authors and visible candidates.

Latest local verification: 73 tests passed across 10 suites. The three local-MySQL integration tests were skipped because no test database URL/server was available. JavaScript syntax checks and `git diff --check` passed. The migration and triggers were subsequently applied to the configured database under explicit user authorization; see the verification below.


## Completed database migration — October 29, 2026

Backfilled 2,476 eligible records and installed all 27 source-maintenance triggers on MySQL 8.0.46. Index state is version 1. Activation followed a transactional coverage audit: zero missing, mismatched or stale entries across all nine sources. Existing source records were preserved.

| Source | Indexed records |
| --- | ---: |
| Posts, including generated title/revision activity | 1,922 |
| Reader reflections | 70 |
| Blog reflections | 1 |
| Community likes | 2 |
| Reader likes | 463 |
| Reader-reflection likes | 18 |
| Community comments, blog-reflection likes, reposts | 0 |
| **Total** | **2,476** |

The generated-post subset contains **1,865 title events and 10 revision events**, all covered. A read-only, consistent-snapshot traversal of every public cursor page returned **2,475 distinct records over 124 pages**, matching the visibility-filtered count exactly, with no duplicates. One indexed record is not eligible for the public feed.

The migration now performs this source-by-source coverage audit before activation automatically. Twenty focused regression tests passed after that change. Native mutation/rollback tests in the local-only MySQL test suite remain separate and unrun; the production verification did not create synthetic user activity.

Machine-readable evidence: [activity-migration-verification.json](activity-migration-verification.json). Application deployment was not performed. The new feed reader will use the prepared index when its code is deployed, and installed triggers keep it current in the meantime.
