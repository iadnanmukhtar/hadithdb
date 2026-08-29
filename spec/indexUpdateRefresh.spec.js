'use strict';

const axios = require('axios');
const Index = require('../lib/Index');

describe('Index.update refresh behavior', () => {
  let originalSettings;

  beforeEach(() => {
    originalSettings = global.settings;
    global.settings = {
      search: {
        domain: 'https://search.test',
        reindex: true
      }
    };
    jest.spyOn(axios, 'post').mockResolvedValue({ status: 200 });
  });

  afterEach(() => {
    global.settings = originalSettings;
    jest.restoreAllMocks();
  });

  test('can make an update immediately visible without a separate refresh request', async () => {
    await Index.update('commentaries', {
      id: 42,
      hId: 42,
      ref: 'quran:1:0',
      text_en: 'Updated'
    }, { force: true, refresh: true });

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toBe('https://search.test/commentaries/_update/42?refresh=true');
  });

  test('does not request a refresh by default', async () => {
    await Index.update('commentaries', {
      id: 43,
      hId: 43,
      ref: 'quran:1:1',
      text_en: 'Updated'
    }, { force: true });

    expect(axios.post.mock.calls[0][0]).toBe('https://search.test/commentaries/_update/43');
  });
});
