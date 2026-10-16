# Google Drive notebook storage

My Notebook stores active notes as Markdown files in a visible **Hadith Unlocked** folder in the connected user's Google Drive. The Google OAuth application requests `drive.file`, `openid`, and `email`. It does not request access to all Drive files.

## Deployment configuration

1. Enable **Google Drive API** in the Google Cloud project that owns the OAuth web client.
2. Configure the OAuth consent screen for the three scopes above. Add test users while the application is in testing; move to production before general release. Google may expire refresh tokens for external applications in testing.
3. Register the site's actual origins in the OAuth client's **Authorized JavaScript origins**, including each Quran host. Local development uses `http://localhost:3004`. The popup code flow exchanges the code with the calling page's origin as its redirect URI, per Google's GIS documentation.
4. Supply the server environment:

   - `GOOGLE_DRIVE_CLIENT_SECRET`: the OAuth web client's secret.
   - `NOTEBOOK_DRIVE_TOKEN_KEY`: a stable, secret, base64-encoded 32-byte encryption key. Generate once with `openssl rand -base64 32`, store in the deployment secret manager, and back it up securely. All app processes must use the same key. Changing it without re-encrypting stored tokens breaks existing connections.
   - `GOOGLE_DRIVE_CLIENT_ID`: optional; defaults to the existing `settings.google.clientId` / `client_id`.
   - `GOOGLE_DRIVE_ORIGINS`: optional comma-separated origins if a serving origin isn't present in `settings.site`. This is a server allowlist, not a substitute for Google's authorized origins.

   Settings equivalents for the secret and key are `settings.google.clientSecret` / `client_secret` and `settings.google.driveTokenKey`. Never commit credentials.
5. Restart all application processes with the same configuration and updated code. Do not run old database-writing notebook routes alongside the new routes during migration.

The current implementation deliberately reports an unavailable-storage message when configuration is missing. It never silently saves notes back to MySQL after switching to Drive.

## Connection and migration

Users sign in as usual, then select **Connect Google Drive** in My Notebook or a contextual note modal. Google login users must choose the same Google identity. Other login identities bind to their first connected Google identity. Reconnection cannot silently switch a notebook to another Google account.

The server exchanges the authorization code, verifies Google identity and scope, and encrypts tokens with AES-256-GCM using the notebook owner as authenticated data. Server refresh tokens never reach the browser. Google Picker obtains a separate short-lived `drive.file` access token through GIS in browser memory only; it is never persisted or sent to the notebook import endpoint. The popup exchange requires the authenticated site token, the expected custom header, and an allowed Origin.

Migration copies existing MySQL notes in resumable batches of up to 20 writes, reads each file back, and checks Markdown, tags, title, and source identity before activating Drive. Pre-generated file IDs are reserved before uploads, so a lost response can be retried without creating duplicate migration files. Divergent remote content stops migration rather than overwriting either copy. Originals are retained, unchanged, as a recovery snapshot; they are not a live backup of subsequent Drive edits. No automatic cleanup deletes them.

After activation, reads, writes, search, tags, previews with source expansion, and ZIP export use Drive content. MySQL stores only connection credentials, migration status, and the per-user source-to-file mapping for active use. Back up these metadata tables as well as the token encryption key.

The folder uses app-owned identity, not a name search, so an unrelated folder named Hadith Unlocked is never adopted. Note files contain standard `title` and `tags` front matter plus a `hadithunlocked` metadata object preserving source identity. Their bodies remain exact UTF-8 Markdown, including Arabic and leading blank lines. Keep the reserved metadata when editing files externally. For manually added files, use **Import from Google Drive** in Settings → Google Drive and select the `.md` files from this folder. Google Picker grants access to those existing files under `drive.file`; the server normalizes their frontmatter in place, preserves Markdown and custom fields, and registers their existing Drive file IDs. Repeated selection does not duplicate files or notes. A second file with the same source links gets its own note identity. Newly accessible files can also be found by background discovery; discovery does not block notebook requests and is deduplicated and throttled per owner/folder.

## Conflicts and failures

- Application mutations are serialized per notebook with a MySQL advisory lock held on a dedicated connection.
- A content checksum (SHA-256 of the note identity, title, tags, and Markdown) is written to `hadithunlocked.cksum` in frontmatter and used as the revision for stale-edit checks. Reads compare the stored checksum without rehashing the content. Legacy files without a checksum use a computed fallback and gain the field on their next save, even without content edits. Drive metadata-only version changes do not invalidate an editor draft. File reads still check metadata revisions before and after body retrieval. Conditional writes retry at most twice when the fresh content revision is unchanged; actual content changes remain conflicts. Retrying an already-saved payload returns the existing note without another write.
- The final revision check uses Drive v2 `files.get` for its explicit `etag` field. Updates use v2 multipart `files.update` and trash uses v2 `files.patch`, both with `If-Match`. Drive v3 omitted the ETag and ignored `If-Match` during live verification, so it is only used for reads and creation. Writes fail closed without a revision marker. Changing read snapshots are retried up to twice, always re-reading metadata and content together.
- Deleting a note moves the file to Drive trash. Restoring that file before recreating the note makes it readable again. Recreating a deleted note reserves a new file ID.
- Missing/moved folders, invalid metadata, revoked permission, quota failures, and network errors surface to the user. Unsaved editor text remains available for retry.
- Disconnect deletes stored tokens but leaves the user's Drive files, identity binding, and file mappings. Users can also revoke access in Google account permissions.

Search and tag aggregation currently read all mapped note files (five at a time). This favors correctness and external-edit visibility for personal notebooks; large notebooks will need a Drive Changes-based metadata/search cache to reduce latency and API calls.

## Verification

Run `npx jest spec/notebookDrive.spec.js spec/userNotebook.spec.js spec/notebookApiPaths.spec.js --runInBand` and `git diff --check`.

Before release, use an authorized test account to connect, migrate, reopen, edit, tag, expand a reference, export, delete/restore, disconnect/reconnect, and simulate concurrent edits in two tabs. Verify the same behavior on the Quran host. Test denied consent and revoked permission. The automated suite simulates Drive responses; it does not establish live Google Cloud configuration or API behavior.

Local live verification on 2026-09-21 passed Google authorization, migration of the existing note, create/read/update, rejection of stale ETags for uploads and trash, recoverable deletion of the temporary test note, and ZIP export. The OAuth app is published in the `hadithunlocked` Cloud project and Drive API is enabled. Private credentials are configured on the local server; this does not constitute deployment of code or credentials to a remote production server.

References:

- https://developers.google.com/identity/oauth2/web/guides/use-code-model
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/api/guides/manage-uploads
- https://developers.google.com/workspace/drive/api/reference/rest/v2/files

## Note titles and wiki links

New saves require a nonblank title, unique within the user's notebook after Unicode NFKC normalization, case folding, and whitespace normalization. Brackets, pipes, and line breaks are reserved for link syntax and cannot appear in titles. The per-user mutation lock covers the duplicate-title check and upload. Existing untitled notes remain readable and must be titled when next edited; migration preserves originals. Direct edits in Drive can bypass app validation, so ambiguous titles produce an error rather than opening an arbitrary note.

Use `[[Note title]]` or `[[Note title|display alias]]`. The editor suggests up to 20 titles containing the search term, ignoring case and diacritics, after two characters following `[[`; use arrow keys and Enter/Tab, or select with the pointer. Escape closes suggestions. Links resolve only against the signed-in user's notes. Literal code, escaped syntax, and Markdown link labels are not converted into nested links. Markdown export preserves wiki syntax. Links are title-based: renaming or deleting a target requires updating references to its title; missing targets show a clear error.

External editors must update `hadithunlocked.cksum` when changing note content, or remove it to enable the legacy computed fallback. A stale stored checksum cannot detect edits made outside the app. Note content is still downloaded for rendering and title validation; this change removes repeated hashing, not all Drive content reads.

Editor preview switches immediately on click-away and does not wait for Drive saves. Autosave waits for 1.8 seconds of inactivity; edits made during an in-flight request are coalesced into the next background save. Explicit saves and closing the dialog flush pending edits. Failures retain the draft and surface an error rather than silently discarding it.

Save responses use the accepted upload payload and revision returned by Drive, without an immediate content readback. Title uniqueness scans run on creation or title changes, not every content/tag autosave. Repeatedly unstable read snapshots report a temporary Drive error instead of claiming another editor changed the note.


## Google Picker setup (existing Cloud project)

No full Drive scope is required. Keep only `drive.file`, `openid`, and `email` in the notebook connection flow. Previously stored broad-access connections are prompted to reconnect with limited scopes; new requests set `include_granted_scopes: false`. Reconnecting does not itself revoke a previously granted permission from the Google Account permissions page.

1. In the **same Google Cloud project as the OAuth client**, enable **Google Picker API** (Drive API is already required).
2. Create a **browser API key** in APIs & Services → Credentials. Restrict its API access to **Google Picker API**. Configure website referrer restrictions for the served application origins, including `http://localhost:3004/*` for development. Google's current Picker guide additionally requires `https://docs.google.com/*` because Picker runs in a Google-hosted iframe. Follow the current guide when setting restrictions: https://developers.google.com/workspace/drive/picker/guides/web-picker
3. Copy the numeric **Project number** from the project settings.
4. Set `settings.google.apiKey` (the shared browser API key for Picker and Drive) and `settings.google.projectNumber` (the numeric Cloud project number). Legacy Picker-specific settings and environment names remain supported as fallbacks. Restart the server. The browser key is intentionally public; never put an OAuth client secret in this field.
5. Open Settings → Google Drive → **Import from Google Drive**, choose Markdown files inside the notebook folder, and select them. Imports accept at most 20 files at once. Files outside the configured folder are rejected without moving or copying them.

The import button remains available with a setup message if Picker configuration is missing. Loading the Picker library and obtaining its token happen only after an explicit import action. The server re-fetches selected file metadata using the connected notebook owner's credentials and checks folder membership; it does not trust file names, parents, or tokens supplied by the browser.
