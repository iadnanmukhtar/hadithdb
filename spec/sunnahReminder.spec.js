const { get } = require('../lib/SunnahReminder');

describe('Daily Sunnah reminder', () => {
  const originalQuery = global.query;
  const midnight = Date.UTC(2026, 10, 25, 5);
  let ids;

  beforeEach(() => {
    ids = [21, 44, 62];
    jest.useFakeTimers().setSystemTime(midnight - 1);
    global.query = jest.fn(async statement => {

      if (statement.includes('ORDER BY SHA2')) {
        expect(statement).toContain("book_alias IN ('mujtaba', 'adhkar', 'yawm-laylah')");
        return ids.map(hId => ({ hId, book_alias: 'adhkar' }));
      }
      expect(statement).toContain("book_alias='adhkar'");
      const id = Number(statement.match(/hId=(\d+) LIMIT 1/)[1]);
      expect(ids).toContain(id);
      return [{ num: id + 'a', body: 'عربي', body_en: 'English' }];
    });
  });

  afterEach(() => {
    global.query = originalQuery;
    jest.useRealTimers();
  });

  test('daily identity survives reload, a manual choice lasts until EST rollover', async () => {
    const daily = await get({});
    expect(await Promise.all(Array.from({length: 100}, () => get({})))).toEqual(Array(100).fill(daily));
    expect(global.query).toHaveBeenCalledTimes(2);
    const another = await get({ id: daily.id, day: String(daily.day), another: true });
    expect(another.id).not.toEqual(daily.id);
    const stored = { id: another.id, day: String(another.day) };
    expect(await get(stored)).toEqual(another);
    jest.setSystemTime(midnight);
    const tomorrow = await get({});
    expect(tomorrow.id).not.toEqual(daily.id);
    expect(await get(stored)).toEqual(tomorrow);
  });

  test('one or zero eligible entries', async () => {
    ids = [44];
    expect(await get({ another: true })).toMatchObject({ id: '44', more: false, num: '44a' });
    ids = [];
    expect(await get({ another: true })).toBeNull();
  });
});
