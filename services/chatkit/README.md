# Website ChatKit

The “Ask the library” panel uses OpenAI's [custom ChatKit integration](https://developers.openai.com/api/docs/guides/custom-chatkit).
Express proxies `/api/chatkit` to a private Python ChatKit server on port 8011.
The agent queries the existing `/mcp` Streamable HTTP endpoint and links to its source records.
No Agent Builder workflow is required.
For a loopback MCP endpoint, the service sends the configured public website Host
so source URLs use the public domains rather than localhost. The full MCP
`structuredContent` is passed to the model; its short text summary alone is insufficient.

## Run locally

With Python 3.12 available:

```sh
./services/chatkit/setup
npm run chatkit
```

Run `npm run dev` in a second terminal and open http://localhost:3004/books?flush=1.
Click **Ask the library**. ChatKit's public domain key is already configured for
`hadithunlocked.com` and `quran.islamunlocked.com`. Localhost also works with this key
(the dashboard does not accept localhost as a domain registration).
The published key is intentionally public, not an API credential.
Manage it in [OpenAI domain allowlist settings](https://platform.openai.com/settings/organization/security/domain-allowlist).

The service reads the repository `.env` and `~/.hadithdb/settings.json`, using the
existing `openAI.key` and `openAI.model`. API credentials remain on the server.

## Configuration

Environment variables take priority over the optional `settings.chatkit` object.

| Environment | Settings field | Default |
| --- | --- | --- |
| `CHATKIT_ENABLED` | `enabled` | Enabled; `0` or settings `false` disables the route and launcher |
| `CHATKIT_DOMAIN_KEY` | `domainKey` | Registered publishable key in `lib/ChatKitConfig.js` |
| `CHATKIT_ENDPOINT` | `endpoint` | `http://127.0.0.1:8011/chatkit` (Express proxy destination) |
| `CHATKIT_MCP_URL` | `mcpUrl` | `http://127.0.0.1:3004/mcp` (Python agent source endpoint) |
| `CHATKIT_MODEL` | `model` | `settings.openAI.model` |
| `CHATKIT_SECRET` | `secret` | HMAC-derived from the OpenAI API key |
| `CHATKIT_DB` | `db` | `~/.hadithdb/chatkit.sqlite3` |
| `OPENAI_API_KEY` | `openAI.key` | Existing site API key |

`CHATKIT_PORT`, `CHATKIT_PYTHON`, and `CHATKIT_VENV` override the launcher's port,
Python executable, and virtual environment directory. Keep the proxy destination
consistent with any port change. Express and Python must use the same signing
secret (and, when using the derived default, the same API key).

## Production

1. Deploy the application changes and install the Python requirements.
2. Run `npm run chatkit` as a supervised, **single-worker** service alongside Express.
   Keep port 8011 private. The service binds to loopback and verifies signed requests.
3. Set `CHATKIT_MCP_URL` if the local Express port differs from 3004. Use the same
   database path and signing secret across Express workers. For multiple Python
   replicas, replace SQLite and in-process concurrency controls with shared services.
4. Restart Express. Refresh any cached HTML that predates the new footer include.
   `/books?flush=1` provides a cold-page smoke test.
5. Ensure the reverse proxy streams `/api/chatkit` responses without buffering and
   permits at least 120 seconds for streaming requests. Also allow the Quran alias
   `/quran/api/chatkit` if you proxy paths individually.
6. Verify a source-backed question and conversation history on both public domains.

## Guest sessions and limits

- All visitors can chat. A signed, HttpOnly, SameSite=Strict cookie isolates each
  browser's conversations. It expires after 30 days. HTTPS cookies are Secure.
  History is per browser and per host, including for signed-in users.
- Store methods check ownership for thread/item reads, edits, deletion, and cursors.
- Chats persist in SQLite on your server. Conversations inactive for 30 days are
  purged at service startup; use regular service restarts or scheduled retention
  cleanup if strict wall-clock deletion is required. Users can delete chats from history.
- The UI discloses that messages are sent to OpenAI. Agents SDK tracing is disabled.
- Express limits requests to 30/minute/IP/worker. The Python service allows one
  active request per guest, up to 20 globally, a 100-second response deadline,
  10 agent turns, 2,500 output tokens per model turn, and 8,000 input characters.
  These are request limits, not a daily spend cap. Configure API project spend
  controls and edge rate limiting appropriate to public traffic.
- Only the seven current read-only MCP tools are allowed. Uploads, browser-side
  tools, and arbitrary custom actions are disabled. Blog search is not exposed
  by this MCP; the assistant explicitly explains unsupported content.

## Checks

```sh
npx jest spec/chatkitRoute.spec.js spec/mcpRoute.spec.js --runInBand
services/chatkit/.venv/bin/python -m unittest discover -s services/chatkit -p '*_spec.py'
curl http://127.0.0.1:8011/health
```
