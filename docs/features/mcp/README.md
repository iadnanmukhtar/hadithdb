# AI research tools and MCP

The public MCP overview explains how an assistant can search the library and retrieve identifiable evidence. The protocol endpoint is also usable without a browser page.

## Using the feature

| Function | What the reader sees and does | How it works |
| --- | --- | --- |
| Discover available tools | /mcp-server presents the tool catalog and connection information. The schema is available at /mcp-server/schema.json. | The marketing page and schema serialize the registered tool definitions. MCP clients discover the active server capabilities through tools/list. |
| Look up a source | An assistant can return a linked ayah, narration, commentary, book, article or audio selection to the reader. | Exact lookups use a source identifier. Hadith detail distinguishes graders, narrators, verified related reports and attached commentary. Search supplies candidates for subsequent lookup. |
| Research a question | A research result can combine Quran, named tafsirs, hadith and Sharḥ. It exposes source coverage and omissions for the assistant to communicate. | Depth controls evidence-gathering limits. The ayah workflow first reads direct commentary and can then use grounded concepts for a follow-up search. Bounded excerpts carry identifiers for fuller retrieval. |
| Open chat instructions | Where the handoff is enabled, the site directs readers to the external assistant connection flow. | The legacy ChatKit configuration returns disabled for the hosted chat service. Its POST route returns 410. Public read-only MCP remains separate. |

## Following a request

For commentary on an ayah, resolve the ayah, retrieve direct tafsir from named works and inspect each source’s coverage. Follow a returned hadith reference with an exact lookup before quoting it. A topical match and an explicitly linked report represent different evidence.

## Earlier desktop and phone captures

These links open the archived route atlas. The URL identifies the original capture, including any redirect or gated state it encountered.

| Screen | Requested URL | Desktop | Phone |
| --- | --- | --- |
| MCP server overview | `/mcp-server` | [Wide](../../design-system/screens/mcp-wide.jpg) | [Narrow](../../design-system/screens/mcp-small.jpg) |

## Skill resources

Clients can also discover HadithDB research and revision skills and read their supporting resources. The server derives each skill from a directory with matching front matter, assigns a stable resource URI and lists a digest for each packaged file. Skill discovery is paginated. Reading one of these resources retrieves instructions, while calling a research tool retrieves records. [Skill catalog implementation](../../../lib/HadithMcpSkills.js)

## Registered functions

The required inputs below come from the registered schemas. Optional filters, paging and response profiles are described by the live schema.

| Function | Purpose | Required arguments |
| --- | --- | --- |
| `list_books` | List library books | None |
| `lookup_book` | Look up a library book | `alias` |
| `lookup_quran_translation` | Look up a Quran translation | `translation`, `surah`, `ayah` |
| `search_blog` | Search blog | `query` |
| `lookup_blog_post` | Look up blog post | `id` |
| `list_hadith_commentaries` | List hadith commentaries | None |
| `search_hadith_commentary` | Search hadith commentary | `query` |
| `lookup_hadith_commentary` | Look up hadith commentary | `id` |
| `research_islamic_topic` | Research an Islamic topic | `question`, `queries` |
| `research_quran_ayah` | Research a Quran ayah and its concepts | `surah`, `ayah` |
| `lookup_quran_page` | Look up Quran page | None |
| `list_quran_sections` | List Quran sections | `surah` |
| `lookup_quran_passage` | Look up Quran passage | `surah` |
| `list_quran_reciters` | List Quran reciters | None |
| `get_quran_audio` | Get Quran passage audio | `surah`, `ayah_from` |
| `lookup_quran_ayah` | Look up Quran ayah | `surah`, `ayah` |
| `search_quran` | Search Quran | `query` |
| `list_tafsirs` | List tafsirs | None |
| `lookup_tafsir` | Look up tafsir | `tafsir`, `surah`, `ayah` |
| `search_tafsir` | Search tafsir | `query` |
| `search_hadith` | Search hadith | `query` |
| `search_history` | Search history and Sirah | `query` |
| `lookup_hadith_detail` | Look up hadith detail | `reference` |

## Implementation and related reading

- Overview and JSON schema. [routes/mcpMarketing.js](../../../routes/mcpMarketing.js)
- Read-only MCP transport. [routes/mcp.js](../../../routes/mcp.js)
- Registered definitions and dispatch. [lib/HadithMcp.js](../../../lib/HadithMcp.js)
- Research dossiers and coverage. [lib/HadithMcpResearch.js](../../../lib/HadithMcpResearch.js)
- Legacy chat behavior. [routes/chatkit.js](../../../routes/chatkit.js)
- Public fields and transport handling. [docs/MCP_DATA_HANDLING.md](../../../docs/MCP_DATA_HANDLING.md)

[All features](../README.md)
