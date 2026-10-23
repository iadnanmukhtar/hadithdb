'use strict';
const keepalive = require('../lib/UpdateKeepalive');

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test.each(['hdith_sharh.revise', 'hdith_sharh.text_en', 'hdith_toc_sharh.text_en'])('keeps slow %s requests connected and stops on completion', prop => {
  const res = { status: jest.fn(), setHeader: jest.fn(), write: jest.fn(), once: jest.fn() };
  const stop = keepalive({ params: { prop }, body: { value: '' } }, res);
  jest.advanceTimersByTime(15000);
  expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
  expect(res.write).toHaveBeenCalledWith(' \n');
  stop();
  jest.advanceTimersByTime(30000);
  expect(res.write).toHaveBeenCalledTimes(1);
});

test('ordinary edits retain normal HTTP response semantics', () => {
  const res = { write: jest.fn() };
  keepalive({ params: { prop: 'hdith_sharh.text_en' }, body: { value: 'Translation' } }, res)();
  jest.advanceTimersByTime(60000);
  expect(res.write).not.toHaveBeenCalled();
});
