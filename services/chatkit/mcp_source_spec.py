import json
import unittest
from unittest.mock import AsyncMock

from agents import RunContextWrapper
from agents.mcp.util import MCPUtil
from mcp.types import CallToolResult, TextContent, Tool
from mcp_source import library_mcp


class MCPSourceSpec(unittest.IsolatedAsyncioTestCase):
    async def test_model_receives_source_text_and_urls_not_only_found_summary(self):
        source = library_mcp('http://127.0.0.1:3004/mcp')
        record = {'canonical_url': 'https://hadithunlocked.com/bukhari:1',
                  'records': [{'text_arabic': 'إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ'}]}
        source.call_tool = AsyncMock(return_value=CallToolResult(
            structuredContent=record,
            content=[TextContent(type='text', text='Found 1 record for bukhari:1.')]))
        tool = Tool(name='lookup_hadith_detail', inputSchema={'type': 'object'})
        output = await MCPUtil.invoke_mcp_tool(source, tool, RunContextWrapper(context={}),
                                               '{"reference":"bukhari:1"}')
        self.assertEqual(json.loads(output), record)


if __name__ == '__main__':
    unittest.main()
