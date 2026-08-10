'use strict';

const HttpRange = require('../lib/HttpRange');

describe('HTTP range errors', () => {
  test('describes the available length for an unsatisfied Quran range', () => {
    const error = HttpRange.notSatisfiable('quran-pages', 604, 'Mushaf page 605 is out of range');

    expect(error.status).toBe(416);
    expect(error.message).toBe('Mushaf page 605 is out of range');
    expect(error.headers).toEqual({
      'Accept-Ranges': 'quran-pages',
      'Content-Range': 'quran-pages */604'
    });
  });
});
