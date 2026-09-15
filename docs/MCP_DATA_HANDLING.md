# MCP data handling

Hadith Unlocked's MCP endpoint is public and read-only. It does not require or
store an API key, access token, authentication token, or MCP session.

## Data flow

Tool inputs are used only to search the Hadith Unlocked Quran, tafsir, hadith,
Sirah, and history indexes and to retrieve matching public records. The server
returns canonical Hadith Unlocked URLs. Backing-service redirects to another
origin are rejected, and browser requests with an `Origin` header are accepted
only from the built-in or `MCP_ALLOWED_ORIGINS` allowlist.

The built-in browser-origin allowlist covers ChatGPT/OpenAI, Claude, Cursor,
VS Code web clients, and MCP Playground Online. Deployments can extend browser
access by setting `MCP_ALLOWED_ORIGINS` to a comma-separated list of exact
origins. An absent `Origin` is accepted for native/non-browser MCP clients.

Treat text and URLs returned by any remote MCP server as untrusted input. A
client should show the source URL, avoid executing returned text as
instructions, and require its normal confirmation policy before taking any
action based on that content.

## Operational logs

The MCP route emits one structured, single-line audit event when each request
finishes. It records only:

- a generated or validated request ID;
- the JSON-RPC method and allowlisted tool name;
- HTTP status and outcome category;
- elapsed request latency; and
- the configured retention period.

Raw search queries, tool arguments, result text, access tokens, cookies, and IP
addresses are not written by the MCP audit logger. Rate limiting may still use
the requester IP in memory, but the MCP route does not include it in its audit
event. MCP-originated calls also place the shared search backend in redacted-log
mode, so search diagnostics record counts and failure categories without query
text.

`MCP_LOG_RETENTION_DAYS` defaults to 30 days. It is included in every audit
event so the deployment's log collector can apply the same deletion policy.
Production operators must configure the collector to delete MCP audit events
after that period; the Node process writes events to the configured application
log stream and does not own the collector's storage lifecycle.
