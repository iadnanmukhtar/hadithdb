'use strict';

const Utils = require('../lib/Utils');

describe('cached EJS render locals', () => {
  test('includes app and response locals while preserving explicit overrides', () => {
    const googleAnalyticsTagId = jest.fn(() => 'G-HADITH123');
    const req = { path: '/highlights' };
    const res = {
      app: {
        locals: {
          googleAnalyticsTagId,
          shared: 'app'
        }
      },
      locals: {
        req,
        shared: 'response'
      }
    };

    const locals = Utils.cachedRenderLocals(res, {
      page: { title_en: 'Notable Hadiths' },
      shared: 'route'
    });

    expect(locals.googleAnalyticsTagId(locals.req)).toBe('G-HADITH123');
    expect(googleAnalyticsTagId).toHaveBeenCalledWith(req);
    expect(locals.shared).toBe('route');
    expect(locals.page.title_en).toBe('Notable Hadiths');
  });
});
