'use strict';
const http = require('http');
const SearchHttp = require('../lib/SearchHttp');

test('real Axios aborts a continuously streaming response at the overall deadline', async () => {
  let interval;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('[');
    interval = setInterval(() => res.write(' '), 5);
    res.on('close', () => clearInterval(interval));
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const started = Date.now();
    await expect(SearchHttp.get(`http://127.0.0.1:${server.address().port}`, { timeout: 100, proxy: false }))
      .rejects.toMatchObject({ code: 'ECONNABORTED' });
    expect(Date.now() - started).toBeLessThan(1000);
  } finally {
    clearInterval(interval);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
