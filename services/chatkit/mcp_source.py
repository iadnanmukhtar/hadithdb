from agents.mcp import MCPServerStreamableHttp, create_static_tool_filter
from urllib.parse import urlparse

TOOLS = ['lookup_quran_ayah', 'search_quran', 'list_tafsirs', 'lookup_tafsir',
         'search_tafsir', 'search_hadith', 'lookup_hadith_detail']


def library_mcp(url, site_url=None):
    params = {'url': url, 'timeout': 25}
    # The local transport still represents the public website. Its Host controls
    # HadithDB's canonical source URLs; never send visitors links to loopback.
    if site_url and urlparse(url).hostname in ('localhost', '127.0.0.1', '::1'):
        params['headers'] = {'Host': urlparse(site_url).netloc}
    return MCPServerStreamableHttp(
        name='HadithDB', params=params,
        client_session_timeout_seconds=30,
        # HadithDB's text block is only a short status summary. The actual source
        # text, grading, and URLs live in structuredContent.
        use_structured_content=True,
        tool_filter=create_static_tool_filter(allowed_tool_names=TOOLS),
    )
