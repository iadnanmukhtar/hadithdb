'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const HadithMcp = require('../lib/HadithMcp');
const router = require('../routes/mcpMarketing');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

describe('MCP marketing page', () => {
  test('publishes the same tool definitions as tools/list without an MCP handshake', async () => {
    const app = express();
    app.use(express.json());
    app.use('/mcp-server', router);
    app.use('/mcp', require('../routes/mcp'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
      const response = await fetch(`${baseUrl}/mcp-server/schema.json`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/^application\/json/);
      expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      const schema = await response.json();
      expect(schema.serverInfo).toEqual({ name: HadithMcp.SERVER_NAME, version: HadithMcp.SERVER_VERSION });
      expect(schema.protocolVersion).toBe(HadithMcp.PROTOCOL_VERSION);
      const rpc = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'MCP-Protocol-Version': HadithMcp.PROTOCOL_VERSION },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
      });
      expect(schema.tools).toEqual((await rpc.json()).result.tools);
      expect(schema.tools.length).toBeGreaterThan(0);
      const page = read('views/mcp_server.ejs');
      expect(page).toContain('href="/mcp-server/schema.json"');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  test('renders the page without shared caching of personalized navigation', () => {
    const route = router.stack.find(layer => layer.route && layer.route.path === '/');
    const res = { locals: {}, setHeader: jest.fn(), render: jest.fn() };
    const req = { path: '/mcp-server' };

    route.route.stack[0].handle(req, res);

    expect(res.locals).toEqual({ req, res });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=0, must-revalidate');
    expect(res.render).toHaveBeenCalledWith('mcp_server');
  });

  test('documents the production endpoint and supported clients', () => {
    const page = read('views/mcp_server.ejs');

    expect(page).toContain("var endpoint = 'https://hadithunlocked.com/mcp'");
    expect(page).toContain('No API key or authentication token');
    expect(page).toContain('does not require an account, API key, access token, or authentication token');
    expect(page).toContain('ChatGPT');
    expect(page).toContain('Codex');
    expect(page).toContain('Claude');
    expect(page).toContain('Cursor');
    expect(page).toContain('VS Code + GitHub Copilot');
    expect(page).toContain('Fiqh evidence &amp; practice');
    expect(page).toContain('Quran &amp; tafsir comparison');
    expect(page).toContain('You ask. Your AI looks through the library.');
    expect(page).toContain('For personal religious rulings');
    expect(page.indexOf('Questions you can ask')).toBeLessThan(page.indexOf('Simple setup guides'));
    expect(page.indexOf('Thoughtful research help')).toBeLessThan(page.indexOf('Simple setup guides'));
  });

  test('is linked from desktop, mobile, footer, and sitemap discovery surfaces', () => {
    expect(read('views/sub-views/header.ejs')).toContain("utils.urlFor(req, '/mcp-server')");
    expect(read('views/sub-views/offcanvas_primary_nav.ejs')).toContain("utils.urlFor(req, '/mcp-server')");
    expect(read('views/sub-views/footer.ejs')).toContain('href="/mcp-server"');
    const searchRoutes = read('routes/search.js');
    expect(searchRoutes).toContain('`${domain}/mcp-server`');
    expect(searchRoutes).toContain(': hadithPublicSitemapUrlList(global.settings.site.url)');
    expect(searchRoutes).toContain('txt += hadithPublicSitemapUrls(domain)');
  });
});
