'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('Mushaf refits when print media applies after beforeprint, then restores screen fitting', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/static/js/script.js'), 'utf8');
  const start = source.indexOf('function initQuranMushafLineFitting(');
  const end = source.indexOf('function quranMushafAyahSelection', start);
  const events = {}, mediaEvents = {};
  const document = { documentElement: { dataset: {} } };
  const fit = jest.fn(), schedule = jest.fn();
  const context = {
    document, fitQuranMushafLines: fit, scheduleQuranMushafLineFit: schedule,
    window: {
      addEventListener: (name, handler) => { events[name] = handler; },
      matchMedia: query => {
        expect(query).toBe('print');
        return { addEventListener: (name, handler) => { mediaEvents[name] = handler; } };
      }
    }
  };
  vm.runInNewContext(source.slice(start, end) + ';initQuranMushafLineFitting(document);', context);
  events.beforeprint();
  expect(fit).toHaveBeenCalledTimes(1);
  mediaEvents.change({ matches: true });
  expect(fit).toHaveBeenCalledTimes(2);
  expect(fit).toHaveBeenLastCalledWith(document);
  schedule.mockClear();
  mediaEvents.change({ matches: false });
  expect(schedule).toHaveBeenCalledWith(document);
  schedule.mockClear();
  events.afterprint();
  expect(schedule).toHaveBeenCalledWith(document);
});
