# Community ActivityPub federation

The publishing integration gives each public community author an account at
`@handle@hadithunlocked.com` (using the configured origin's hostname). It publishes
posts, articles, generated hadith title/revision posts, community comments,
hadith/blog reflections, likes, source likes, and reposts. Comments and writing
are `Note` objects; reactions use `Like` and `Announce`. Deletions and hidden or
private content produce `Delete`; removed likes/reposts produce `Undo`.

This is outbound server-to-server federation. Remote Follow and Undo Follow are
processed; incoming remote posts, replies, reactions, and client-to-server writes
are not imported into the local community. The local following controls still
manage local follows. A profile shows its federated address when enabled.

## Activation

The code is disabled by default. After reviewing and deploying it, configure the
web processes and worker with:

```dotenv
ACTIVITYPUB_ENABLED=1
ACTIVITYPUB_ORIGIN=https://hadithunlocked.com
```

The origin must be a permanent, externally reachable HTTPS origin without a
path. It defaults to `settings.site.url` if the override is absent. Changing it
changes federation identities; do not change it once accounts have followers.
Preserve the database's `activitypub_actors` table and signing keys in backups.

Run the worker on the same application checkout and configuration every minute:

```sh
node bin/community-activitypub.js
```

The existing application startup loads the database connection. On first use,
`data/migrations/activitypub.sql` creates separate federation tables. The worker
uses a database advisory lock on a dedicated connection to prevent overlapping
runs. Each pass scans up to 100 IDs per source table, then continues from durable
cursors next run. Initial reconciliation includes existing public history.
After reaching each source's end it restarts, catching edits, visibility changes,
and physically deleted reactions. Thus delivery and removal latency depends on
history size and worker frequency. Increase `scanLimit` through
`ActivityPubWorker.run({scanLimit:500})` if appropriate for the deployment.

Allow the reverse proxy to route these paths to Express, without authentication,
HTML caching, body rewriting, or redirects:

- `/.well-known/webfinger?resource=acct:handle@hadithunlocked.com`
- `/activitypub/actors/:id` and its `/inbox`, `/outbox`, `/followers`
- `/activitypub/objects/:source/:id/:generation`
- `/activitypub/activities/:id`

Preserve the original `Host`, request path, `Date`, `Digest`, and `Signature`
headers. The inbox raw-body parser is deliberately mounted before Express JSON
parsing. WebFinger links to stable opaque actor IDs, independent of handle changes.

## Publication and privacy

Only published content belonging to public profiles is federated. Synthetic
legacy identities without an actual user UID are excluded. Draft text, pending
posts, email addresses, private notebooks, biographies, and profile pictures are
not added to actor documents. Existing signed-in HTML profile access is unchanged.
Federated names use the existing public-name formatter.

Each published object has a stable identity across edits. Republishing after a
processed deletion creates a fresh object identity. The worker reconciles database
state, so a change that is fully reversed between scans may not produce an event.
Public object reads and deliveries recheck current visibility. Public-to-private
profile changes eventually retract the author's previously federated activity.
The minimal actor/key document remains available for verifying those retractions.
Remote servers control whether and when they remove copies they received.

Incoming Follow/Undo uses signed raw-body verification, timestamp and digest
checks, actor-owned RSA keys, and persistent receipt IDs for replay protection.
Outbound requests are signed, bounded by time and response size, restricted to
public HTTPS destinations, pinned to validated DNS answers, and never redirected.
This implements the interoperable RSA HTTP Signature draft supported by Mastodon;
RFC 9421-only peers are not supported yet.

## Delivery operations

Delivery is at least once, with persistent activity IDs and exponential retries.
The queue preserves recipient order while a retry is pending. After ten failed
attempts a job is retained as `failed`. The worker reports changed/sent/skipped/
failed counts. Inspect without exposing stored private keys:

```sql
SELECT status, COUNT(*) FROM activitypub_deliveries GROUP BY status;
SELECT source, last_id FROM activitypub_cursors ORDER BY source;
SELECT id, actor_id, attempts, available_at
FROM activitypub_deliveries WHERE status='failed' ORDER BY id;
```

After resolving a destination failure, retry selected job IDs:

```sql
UPDATE activitypub_deliveries
SET status='queued', attempts=0, available_at=CURRENT_TIMESTAMP(3)
WHERE status='failed' AND id IN (/* reviewed IDs */);
```

Never run the worker against production merely to test connectivity: it sends
queued activities. Integration tests use disposable prefixed tables and mock all
outbound federation requests:

```sh
npx jest spec/activitypubHttp.spec.js --runInBand
HADITHDB_MYSQL_INTEGRATION=1 npx jest spec/activitypub.mysql.spec.js --runInBand
```

Protocol references: [ActivityPub](https://www.w3.org/TR/activitypub/),
[Mastodon ActivityPub](https://docs.joinmastodon.org/spec/activitypub/), and
[Mastodon signed requests](https://docs.joinmastodon.org/spec/security/).
