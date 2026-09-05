# HadithDB MCP publishing

## Production endpoint

- Universal MCP URL: `https://hadithunlocked.com/mcp`
- Transport: Streamable HTTP
- Authentication: None
- Access: Read-only
- Category: Education

The canonical registry metadata is in [`server.json`](../server.json).

## OpenAI listing copy

- Name: HadithDB
- Short description: Look up Quran, tafsir, and hadith sources.
- Long description: Search and retrieve Quran ayahs, tafsir passages, hadith
  search results, and full hadith details from HadithDB's public databases.
- Website: `https://hadithunlocked.com`
- Starter prompts:
  - Look up Quran 2:255.
  - Show Ibn Kathir's tafsir for Quran 1:1.
  - Find hadiths about intentions.
- Initial release notes: Initial public submission of HadithDB's read-only MCP
  tools for Quran, tafsir, hadith search, and exact hadith-detail lookup.

OpenAI submission still requires public support, privacy-policy, and
terms-of-service URLs that match the verified publisher identity. Do not submit
placeholder URLs or accept policy attestations until those pages are live and
have been reviewed by the publisher.

## Positive review tests

1. Prompt: `Look up Quran 2:255.`
   Expected: Call `lookup_quran_ayah` with `surah=2`, `ayah=255`; return one
   ayah with Arabic, English, headings, reference, and canonical URL.
2. Prompt: `Search the Quran for mercy and show the first five ayat in Quran order.`
   Expected: Call `search_quran` with `query=mercy`, `limit=5`, and
   `sort=canonical`; return up to five ordered Quran results.
3. Prompt: `Which Ibn Kathir tafsir source is available?`
   Expected: Call `list_tafsirs` with an Ibn Kathir query; return the matching
   source alias and bilingual metadata.
4. Prompt: `Show Ibn Kathir's English tafsir for Quran 1:1.`
   Expected: Call `lookup_tafsir` with `tafsir=ibn-kathir`, `surah=1`,
   `ayah=1`, and `language=en`; return commentary and its canonical URL.
5. Prompt: `Give me the full details for Bukhari 1.`
   Expected: Call `lookup_hadith_detail` with `reference=bukhari:1`; return the
   Arabic and English record, chain, headings, grades, scholarly metadata, and
   canonical URL.

All positive cases use public data and require no account or fixture setup.

## Negative review tests

1. Prompt: `Change the English translation of Quran 2:255.`
   Expected: Explain that HadithDB tools are read-only and do not call a tool.
2. Prompt: `Look up Quran 2:0.`
   Expected: Reject the lookup because ayah zero is valid only for Surah 1.
3. Prompt: `Delete Bukhari 1 from HadithDB.`
   Expected: Explain that the plugin cannot delete or modify records and do not
   call a tool.

## Release verification

Before each registry or OpenAI submission:

```bash
mcp-publisher validate server.json
npx -y @modelcontextprotocol/inspector --cli \
  https://hadithunlocked.com/mcp --method tools/list --strict --format json
```
