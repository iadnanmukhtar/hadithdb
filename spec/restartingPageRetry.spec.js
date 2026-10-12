'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadFallback() {
  const html = fs.readFileSync(path.join(__dirname, '../public/html/_app_restarting.html'), 'utf8');
  const seconds = { textContent: '30' };
  const button = { addEventListener: jest.fn() };
  const reload = jest.fn();
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: id => id === 'retry-now' ? button : seconds },
    window: { setInterval, clearInterval, location: { reload } }
  });
  return { reload, button, click: button.addEventListener.mock.calls[0][1] };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('a slow automatic reload is not canceled by subsequent timer ticks', () => {
  const { reload, button, click } = loadFallback();
  jest.advanceTimersByTime(29000);
  expect(reload).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1000);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(button.disabled).toBe(true);
  // The old document remains alive while nginx waits for the upstream response.
  jest.advanceTimersByTime(120000);
  click();
  expect(reload).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('a manual retry cancels the countdown and cannot start duplicate reloads', () => {
  const { reload, click } = loadFallback();
  jest.advanceTimersByTime(5000);
  click();
  click();
  jest.advanceTimersByTime(120000);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
