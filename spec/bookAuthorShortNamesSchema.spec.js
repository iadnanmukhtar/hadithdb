'use strict';

describe('book author short-name schema', () => {
  const originalQuery = global.query;
  afterEach(() => { global.query = originalQuery; jest.resetModules(); });

  test('creates both missing columns before the commentary catalog query', async () => {
    jest.resetModules();
    global.query = jest.fn().mockImplementation(sql => Promise.resolve(sql.startsWith('SHOW') ? [] : []));
    const Books = require('../lib/Books');
    await Books.allCommentaryBooks();
    expect(global.query.mock.calls.map(call => call[0])).toEqual([
      "SHOW COLUMNS FROM books LIKE 'authorShortName%'",
      'ALTER TABLE books ADD COLUMN authorShortName VARCHAR(255) NULL',
      'ALTER TABLE books ADD COLUMN authorShortName_en VARCHAR(255) NULL',
      expect.stringContaining('SELECT')
    ]);
  });

  test('shares initialization across callers and leaves existing columns intact', async () => {
    jest.resetModules();
    global.query = jest.fn().mockResolvedValue([{ Field: 'authorShortName' }, { Field: 'authorShortName_en' }]);
    const Books = require('../lib/Books');
    await Promise.all([Books.ensureAuthorShortNameColumns(), Books.ensureAuthorShortNameColumns()]);
    expect(global.query).toHaveBeenCalledTimes(1);
  });

  test('tolerates a column created by another worker and retries failed initialization', async () => {
    jest.resetModules();
    global.query = jest.fn().mockResolvedValueOnce([])
      .mockRejectedValueOnce(Object.assign(new Error('already added'), { code: 'ER_DUP_FIELDNAME' }))
      .mockRejectedValueOnce(Object.assign(new Error('temporary failure'), { code: 'ER_LOCK_WAIT_TIMEOUT' }));
    const Books = require('../lib/Books');
    await expect(Books.ensureAuthorShortNameColumns()).rejects.toThrow('temporary failure');
    global.query.mockResolvedValue([{ Field: 'authorShortName' }, { Field: 'authorShortName_en' }]);
    await Books.ensureAuthorShortNameColumns();
    expect(global.query).toHaveBeenCalledTimes(4);
  });
});
