'use strict';
const keepalive = require('../lib/UpdateKeepalive');

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test.each(['hadith.revise', 'hdith_sharh.revise', 'hdith_toc_sharh.revise', 'toc.revise', 'commentary.revise', 'hdith_sharh.text_en', 'hdith_toc_sharh.text_en'])('keeps slow %s requests connected and stops on completion', prop => {
  const res = { status: jest.fn(), setHeader: jest.fn(), write: jest.fn(), once: jest.fn() };
  const stop = keepalive({ params: { prop }, body: { value: '' } }, res);
  jest.advanceTimersByTime(15000);
  expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
  expect(res.write).toHaveBeenCalledWith(' \n');
  stop();
  jest.advanceTimersByTime(30000);
  expect(res.write).toHaveBeenCalledTimes(1);
});

test.each([200, 502])('a 134-second hadith revision keeps streaming and preserves the final JSON status %s', code => {
  let wire = '';
  let lastWrite = 0;
  const started = Date.now();
  const res = {
    headersSent: false,
    status: jest.fn(),
    setHeader: jest.fn(),
    once: jest.fn(),
    write(chunk) {
      // Model the proxy's 60-second upstream idle timeout.
      expect(Date.now() - started - lastWrite).toBeLessThan(60000);
      lastWrite = Date.now() - started;
      this.headersSent = true;
      wire += chunk;
    }
  };
  const stop = keepalive({ params: { prop: 'hadith.revise' }, body: { value: 'Revise' } }, res);
  jest.advanceTimersByTime(134000);
  stop();
  const result = code === 200
    ? { code, revised: { body: 'Revised Arabic', body_en: 'Revised translation' } }
    : { code, message: 'AI revision failed' };
  res.write(JSON.stringify(result));
  expect(lastWrite).toBe(134000);
  expect(JSON.parse(wire)).toEqual(result);
  expect(res.status).toHaveBeenCalledTimes(1);
  const completedWire = wire;
  jest.advanceTimersByTime(60000);
  expect(wire).toBe(completedWire);
});

test('disconnecting a revision clears the heartbeat', () => {
  const res = { status: jest.fn(), setHeader: jest.fn(), write: jest.fn(), once: jest.fn() };
  keepalive({ params: { prop: 'hadith.revise' }, body: {} }, res);
  res.once.mock.calls.find(([event]) => event === 'close')[1]();
  jest.advanceTimersByTime(60000);
  expect(res.write).not.toHaveBeenCalled();
});

test('ordinary edits retain normal HTTP response semantics', () => {
  const res = { write: jest.fn() };
  keepalive({ params: { prop: 'hdith_sharh.text_en' }, body: { value: 'Translation' } }, res)();
  jest.advanceTimersByTime(60000);
  expect(res.write).not.toHaveBeenCalled();
});
