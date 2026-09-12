# Library chat now opens ChatGPT

The website no longer hosts API-funded ChatKit conversations. The blue launcher
and search shortcut open connection instructions for the visitor's own ChatGPT
account. The browser does not load the ChatKit SDK or request API credentials.

The existing read-only MCP endpoint is `https://hadithunlocked.com/mcp`.
Visitors must connect it in ChatGPT and select it in their conversation. Simply
opening ChatGPT does not install the connection. Developer mode availability
depends on the visitor's account and workspace policy. There is no published
library directory listing or automatic installation assumed by this flow.

See [OpenAI's connection instructions](https://developers.openai.com/plugins/deploy/connect-chatgpt).

## Deploying the replacement

1. Deploy and reload every Express worker. Both `/api/chatkit` and
   `/quran/api/chatkit` reject POSTs with HTTP 410 regardless of old settings.
   Their `/config` routes disable cached clients and expose no keys.
2. Stop the old Python ChatKit PM2 service if you registered one:
   `pm2 stop hadithdb-chatkit`. Remove it from your process configuration so it
   does not restart at boot. Express and the MCP endpoint remain running.
3. Refresh cached HTML to load the new panel and versioned JavaScript/CSS.
4. Verify the MCP endpoint is reachable by ChatGPT through your reverse proxy
   and Cloudflare, then test a connection from a supported ChatGPT account.

The Python files in this directory are retained as legacy code, but are no
longer used by the website. Do not run `npm run chatkit` for this flow.
Existing chat history is preserved. Set `openAI.chatkit.enabled` to `false` in
`~/.hadithdb/settings.json` to hide the launcher and search shortcut. Missing
settings also disable them. Set it to `true` to show the ChatGPT handoff only;
it never reactivates API-funded chat. Reload Express after changing settings.
The domain key is no longer needed; other features can still use `openAI.key`.

## Checks

```sh
npx jest spec/chatkitRoute.spec.js spec/mcpRoute.spec.js --runInBand
```
