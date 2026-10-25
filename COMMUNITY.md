# Community MVP

Community lives on the existing domain under `/community`. `/notebook` remains the private notebook. Its Share panel now offers **Create a Community post**, which saves the note and copies its body into a publication draft for review; it never changes the private note's visibility. Saved notebook copies retain Markdown, Arabic, references, and bilingual layouts. Changing or removing the notebook note does not change the published copy.

Community appears in the primary navigation. Its shared header uses always-visible segmented tabs styled like the Quran reader controls: My Notebook, Wall, Following, Everyone, and Blog, with the current section highlighted. The existing Blog and article URLs remain unchanged and show the same navigation. The notebook's mobile filters remain available in the same toolbar.

The top-of-wall **What's on your mind?** composer posts short public notes without leaving the feed. It offers an optional Markdown preview, retains text after a failed request, clears it after a successful post or an account change, and sends first-time authors through the existing moderation flow. The **Write an article** action opens the full publication editor. Community inherits the site’s fonts, white background, blue accent, and standard buttons. Author initials, thin separators, and compact controls share a responsive layout across server-rendered and dynamically loaded entries.

## Views

- `/community`: chronological public wall of articles, short notes, and recent Community discussion activity. Filter by type; repeated comments are grouped by discussion.
- `/community/following`: activity from followed authors.
- `/community/mine`: your writing, publication drafts, public profile settings, and follow/email preferences.
- `/community/@handle`: an author's public wall, bio, follower count, and Follow / Subscribe by email buttons.
- `/community/@handle/post-id`: stable public post with comments and replies.
- `/community/write`: Markdown editor, notebook copying, public preview, draft saving, publishing/updating, and unpublishing.
- `/community/moderation`: first-publication review, reports, hiding, and restoring posts.

The personal wall includes the author's private publication drafts; the public author wall only shows published content. Public URLs use stable numerical post identities, so changing a title does not break links. Authors may replace their generated handle once; their chosen handle is permanent.

## Deployment

The application creates the eight new InnoDB tables from `data/migrations/community.sql` on first Community use. No existing notebook, source-content, or comments table is altered. The database account needs CREATE TABLE permission; alternatively install the SQL beforehand. Deploy app.js, the Community modules/routes/templates/assets, notebook navigation, and the updated notebook Share module together.

Set `COMMUNITY_MODERATOR_UIDS` to a comma-separated list of verified account UIDs in the application's environment. Use the UID from the existing account/session system, not a display name or email address. The first publication from an author enters `pending`; a moderator's approval trusts that author for subsequent publications. With no moderators configured, first publications remain pending. Approval is moderation, not verification of religious claims. Moderator authorization never uses the existing edit-mode cookie.

Mail delivery uses the existing `global.settings.smtp` configuration and `global.settings.site.url`. Configure an authenticated SMTP sender with a valid `from` address and the normal SPF/DKIM setup for that sender. Articles are emailed only when the author explicitly checks **Email this article to subscribers when first published**. Short notes, edits, comments, and follows alone do not send subscription mail.

Run the queue worker periodically from the application directory with the same environment as the web app:

```sh
node bin/community-mail.js
```

For example, a scheduler can run it every minute. Each invocation processes at most 25 jobs. Workers claim jobs using InnoDB row locks, retry delivery errors after 15 minutes up to five attempts, and reclaim a crashed worker's lease after 30 minutes. Monitor failed jobs in `community_email_outbox`; the worker prints sent/skipped/failed counts. It sends from the configured site address. Each recipient receives an individual message with a stable Message-ID, an unsubscribe URL, and one-click unsubscribe headers. Delivery rechecks the current subscription and publication state. As with SMTP queues generally, a process crash after SMTP acceptance but before recording success can cause a duplicate on retry.

Unsubscribe pages exclude third-party scripts and send no referrer. Unsubscribe link GET requests display confirmation; only POST changes preferences, including standards-based one-click unsubscribe. Email opt-out leaves the author follow active. No newsletter messages are sent by web requests or app startup. No mail worker or external scheduler is installed automatically by this change.

## Data and access

Posts have separate editable and published title/body/tag fields, optimistic versions, and private revision snapshots. Saving changes to a published article as a draft leaves its public version intact. Publishing an update replaces that snapshot. Unpublishing hides the post and discussion immediately. Moderators can hide a post; its author cannot bypass that by publishing it again.

Public responses contain public author names and handles, never account email addresses, provider UIDs, draft versions, Drive file locations, or private frontmatter. User HTML is sanitized through the existing notebook renderer. Private wiki links become text and private notebook/Drive destinations are stripped from public HTML. Authors should still check the public preview for private prose or embedded external assets before publishing. Publication metadata/frontmatter is excluded from the rendered article.

Writing, commenting, reporting, following, profile edits, and moderation require verified bearer authentication. Mutation rate limits are per verified UID. Replies must reference a comment belonging to the same published post. Deleted comments retain a thread placeholder with no body. Reports are deduplicated per reporter and target.

This first version provides immediate email delivery for selected new articles. Digest scheduling, paid subscriptions, uploaded cover images, follower lists, notification inboxes, search, and a public revision browser are outside this release. The Community wall includes Community discussions; existing contextual Quran/hadith reflections continue to use their existing views and storage.

## Verification

```sh
npx jest --runInBand spec/community.spec.js spec/notebookShare.spec.js
HADITHDB_MYSQL_INTEGRATION=1 npx jest --runInBand spec/community.mysql.spec.js
```

The MySQL suite rewrites all eight Community table names to unique disposable names, creates/removes only those fixtures, starts a local test server, and mocks verified accounts and SMTP. It exercises actual MySQL transactions, publication privacy, conflicts, follows, email queue/unsubscribe, moderation, replies, and real EJS templates. Its Chrome checks cover desktop/mobile publishing and discussion. No real subscriber emails or application records are changed by these tests.

## Unified activity feeds

My Wall, Following, Everyone, and public author walls include published notes/articles, every visible Community comment, and existing hadith/Quran/Blog reflections and replies. My Wall additionally includes the owner's publication drafts. Following filters by the person who wrote the post or comment, not the owner of the discussion.

Source reflections are read live from `hadiths_comments` and `blog_comments`: no content copies, duplicate threads, or delayed synchronization. New source comments appear on the next feed load; source edits and deletions are reflected immediately. Legacy NULL deletion flags match the original reflection renderer's visible state. Private notebook content and link-only notebook shares are not indexed; explicit Community publications are included.

Run `node bin/community-reflections.js` to backfill missing author profiles for existing visible reflections. This is safe to rerun and preserves chosen handles and names. It does not copy email addresses, change source records, grant trusted-author status, or send mail. Future reflection authors are registered automatically when their activity is read. Records without an account UID receive isolated legacy profiles; ownership is never guessed from names or email addresses.

The quick-post entry is a compact prompt that opens a native modal dialog. The editor focuses automatically, keeps unsent text when closed during the same page visit, prevents closing during submission, and closes after a successful post. Account changes clear the draft. Preview and posting failures leave the text available for retry.

Public feeds, author walls, published notes/articles, and their comments can be read without signing in. Expired tokens or unavailable browser authentication fall back to anonymous reading. Private feeds, unpublished posts, edit data, and all participation actions retain their authentication checks.

## Feed paging and likes

Feeds return 20 activities per request. An intersection observer loads the next batch near the bottom; a retry button preserves loaded content after errors, and browsers without the observer retain Load more. Filter and account changes reset paging. Duplicate activity keys are not appended twice.

Like buttons require sign-in; counts and liked activity are public. `community_likes` stores one like per account and target for Community posts/comments and timestamps for new source reflection likes. Reflection likes reuse the existing upvote tables and update their cached totals. Existing hadith/Quran likes also appear as activity, scoped by the liker for My Wall, Following, and author walls. Historic reflection votes lack a recorded timestamp; they appear after dated activity without a fabricated date. Deleted reflections and comments and unpublished posts are excluded. No like notification emails are sent by the Community action.

## Contribution photos

Both verified sign-in endpoints refresh `user_profile_photos`, storing the provider's validated HTTPS photo URL and an email-derived Gravatar fallback. Missing photos clear the old provider URL on the next sign-in. Community feeds, liked activity, author profiles, post discussions, and existing source reflection threads read the current profile; old contributions do not retain stale photos. API calls using older session tokens do not overwrite the latest photo. Raw email addresses are never added to Community author responses. Broken provider images fall back to Gravatar, then a neutral icon if that image also fails. The photo table is created idempotently on first use.

Runs of consecutive likes/votes of the same activity type and target category show ten compact rows, with remaining loaded activity inside a native expandable disclosure. Runs continue across page boundaries and restart when the interaction type changes or after a post/comment. Expansion persists while paging. Pages containing only collapsed rows are fetched in sequence until more visible activity appears or the feed ends. Both infinite scrolling and Load more advance through these pages without expanding the reaction group. Closing a group rechecks the scroll sentinel.

If the initial batch contains only microinteractions and more activity is available, automatic fetching waits for the compact Load More button. Expanding or collapsing a group does not bypass this initial gate. After that click, normal infinite scrolling resumes.

The feed sidebar follows the reader/search rail styling and shows up to eight top contributors ranked by public posts, visible Community comments, and visible source reflections/comments. Likes, drafts, and deleted content do not count. Signed-in readers are excluded from their own recommendations. Follow/Unfollow uses the existing relationship and does not enable email subscriptions.

Historical identity repair: `node bin/community-merge-identities.js` previews legacy Firebase-to-Google matches; `--apply` migrates only unambiguous, non-anonymous Google-provider identities supported by consistent historical emails and a single current Google account. It refuses identities owning newer community data, writes a mode-0600 backup in `temp/`, migrates public source contributions/votes, deduplicates reactions, preserves old profile links through `community_author_aliases`, and verifies reflection content is unchanged. It does not migrate private notebooks or match display names. Run `node bin/community-reflections.js` afterward to seed missing historical photos/Gravatar fallbacks without overwriting photos refreshed at sign-in. Re-running the identity migration should report no matches.
