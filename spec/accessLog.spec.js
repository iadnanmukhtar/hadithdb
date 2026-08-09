'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const accessLogMiddleware = require('../lib/AccessLog');
const { buildAccessLog, rotateAccessLog, resolveLogFile } = accessLogMiddleware;

describe('access logging', () => {
  test('is disabled when ACCESS_LOG_FILE is empty', () => {
    const previousLogFile = process.env.ACCESS_LOG_FILE;
    process.env.ACCESS_LOG_FILE = '';
    const next = jest.fn();
    const res = { once: jest.fn() };

    accessLogMiddleware({}, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.once).not.toHaveBeenCalled();
    if (previousLogFile === undefined)
      delete process.env.ACCESS_LOG_FILE;
    else
      process.env.ACCESS_LOG_FILE = previousLogFile;
  });

  test('expands a dotenv home-directory log path', () => {
    expect(resolveLogFile('~/.hadithdb/logs/hadithdb-access.log')).toBe(
      path.join(os.homedir(), '.hadithdb', 'logs', 'hadithdb-access.log')
    );
  });

  test('rotates the current log and retains only one backup', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hadithdb-access-log-'));
    const logFile = path.join(directory, 'hadithdb-access.log');
    try {
      fs.writeFileSync(logFile, 'first period\n');
      rotateAccessLog(logFile, Date.now(), -1);
      expect(fs.readFileSync(`${logFile}.1`, 'utf8')).toBe('first period\n');

      fs.writeFileSync(logFile, 'second period\n');
      rotateAccessLog(logFile, Date.now(), -1);
      expect(fs.readFileSync(`${logFile}.1`, 'utf8')).toBe('second period\n');
      expect(fs.readdirSync(directory).sort()).toEqual(['hadithdb-access.log.1']);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('records the completed request and PM2 worker', () => {
    const previousWorker = process.env.NODE_APP_INSTANCE;
    process.env.NODE_APP_INSTANCE = '1';
    const req = {
      clientIp: '203.0.113.8',
      method: 'GET',
      originalUrl: '/quran/1?translation=en',
      headers: {
        referer: 'https://example.test/',
        'user-agent': 'Example browser'
      },
      get(name) {
        return this.headers[name];
      }
    };
    const res = {
      statusCode: 200,
      getHeader(name) {
        return name === 'content-length' ? '1234' : undefined;
      }
    };

    const entry = buildAccessLog(req, res, 12.34);

    expect(entry).toMatchObject({
      type: 'access',
      worker: '1',
      clientIp: '203.0.113.8',
      method: 'GET',
      url: '/quran/1?translation=en',
      status: 200,
      bytes: 1234,
      durationMs: 12.3,
      referrer: 'https://example.test/',
      userAgent: 'Example browser'
    });
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry.pid).toBe(process.pid);

    if (previousWorker === undefined)
      delete process.env.NODE_APP_INSTANCE;
    else
      process.env.NODE_APP_INSTANCE = previousWorker;
  });
});
