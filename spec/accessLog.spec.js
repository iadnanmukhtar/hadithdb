'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const accessLogMiddleware = require('../lib/AccessLog');
const { formatCombinedLog, rotateAccessLog, resolveLogFile } = accessLogMiddleware;

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

  test('formats requests using the combined log format', () => {
    const req = {
      clientIp: '203.0.113.8',
      method: 'GET',
      originalUrl: '/quran/1?translation=en',
      httpVersion: '1.1',
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

    const entry = formatCombinedLog(req, res, new Date(2026, 7, 9, 14, 30, 15));

    expect(entry).toMatch(
      /^203\.0\.113\.8 - - \[09\/Aug\/2026:14:30:15 [+-]\d{4}\] "GET \/quran\/1\?translation=en HTTP\/1\.1" 200 1234 "https:\/\/example\.test\/" "Example browser"$/
    );
  });
});
