'use strict';

const axios = require('axios');
const Index = require('../lib/Index');

describe('Index.distinctTermsFromQuery', () => {
  let originalSettings;

  beforeEach(() => {
    originalSettings = global.settings;
    global.settings = { search: { domain: 'https://search.test', itemsPerPage: 20 } };
  });

  afterEach(() => {
    global.settings = originalSettings;
    jest.restoreAllMocks();
  });

  test('returns aggregation keys without fetching matching documents', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: {
        hits: { total: { value: 42 } },
        aggregations: { values: { buckets: [{ key: 'bukhari' }, { key: 'muslim' }] } }
      }
    });

    await expect(Index.distinctTermsFromQuery('hadiths', { exists: { field: 'body_en' } }, 'book_alias', 100))
      .resolves.toEqual(['bukhari', 'muslim']);

    const payload = JSON.parse(axios.post.mock.calls[0][1]);
    expect(payload).toEqual(expect.objectContaining({
      size: 0,
      query: { exists: { field: 'body_en' } },
      aggs: { values: { terms: { field: 'book_alias', size: 100 } } }
    }));
  });

  test('rejects unsafe field names', async () => {
    await expect(Index.distinctTermsFromQuery('hadiths', { match_all: {} }, 'book_alias;drop', 10))
      .rejects.toThrow('Invalid Elasticsearch aggregation field');
  });
});
