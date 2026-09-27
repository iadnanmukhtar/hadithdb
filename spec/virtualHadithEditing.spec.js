'use strict';
const Editing = require('../lib/VirtualHadithEditing');
const originalPool = global.dbPool;
let connection, rows, target;
beforeEach(() => {
  rows = [{ id: 10, bookId: 61, tocId: 90, ordinal: 5, num: '5', num0: 5, numInChapter: 2, hadithId: 100, note: 'Preserve' },
    { id: 11, bookId: 61, tocId: 91, ordinal: 6, num: '5a', hadithId: 101 }];
  target = { id: 200, alias: 'muslim', num: '12a', type: 'hadith', virtual: 0 };
  connection = { beginTransaction: jest.fn(cb => cb(null)), commit: jest.fn(cb => cb(null)), rollback: jest.fn(cb => cb(null)), release: jest.fn(),
    query: jest.fn((sql, args, cb) => {
      let result = [];
      if (sql.startsWith('SELECT b.id')) result = [{ id: 61, alias: 'riyad', virtual: 1 }];
      else if (sql.startsWith('SELECT * FROM hadiths_virtual')) result = rows;
      else if (sql.startsWith('SELECT h.id')) result = target ? [target] : [];
      else if (sql.startsWith('SELECT id,books')) result = [{ id: 100, books: '{riyad}{other}' }, { id: 200, books: '{another}' }];
      else if (sql.startsWith('SELECT DISTINCT hadithId')) result = [{ hadithId: 200 }];
      else if (sql.startsWith('INSERT')) result = { insertId: 12 };
      cb(null, result);
    }) };
  global.dbPool = { getConnection: cb => cb(null, connection) };
});
afterEach(() => { global.dbPool = originalPool; });
test.each(['10,11', '1 OR 1=1', 0, '1.2'])('rejects invalid anchor %s', async id => {
  await expect(Editing.selectHadith(id, 200, 'replace_selected', 'admin')).rejects.toThrow('Invalid hadith ID');
  expect(connection.beginTransaction).not.toHaveBeenCalled();
});
test('replacement preserves virtual reference and notes and repairs only collection membership', async () => {
  await expect(Editing.selectHadith(10, 200, 'replace_selected', 'admin')).resolves.toMatchObject({ id: 10, hadithIds: [100,200] });
  const mutation = connection.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE hadiths_virtual'));
  expect(mutation[0]).not.toMatch(/\b(num|note|ordinal|tocId)=/);
  expect(mutation[1]).toEqual([200,'muslim:12a','muslim','admin',10]);
  expect(connection.query.mock.calls).toContainEqual([expect.stringContaining('UPDATE hadiths SET books='), ['{other}',100,'{other}'], expect.any(Function)]);
  expect(connection.commit).toHaveBeenCalledTimes(1);
  expect(connection.release).toHaveBeenCalledTimes(1);
});
test('add allocates an unused reference, preserves existing numbers, and shifts only this book', async () => {
  await Editing.selectHadith(10, 200, 'add_selected', 'admin');
  const insert = connection.query.mock.calls.find(([sql]) => sql.startsWith('INSERT'));
  expect(insert[1]).toEqual([61,90,6,3,'5a2',5,200,'muslim:12a','muslim','admin']);
  const shift = connection.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE hadiths_virtual'));
  expect(shift[0]).toContain('WHERE bookId=? AND ordinal>?');
  expect(shift[1]).toEqual([90,61,5]);
});
test.each([null, { id: 200, alias: 'quran', type: 'hadith' }, { id: 200, alias: 'riyad', virtual: 1, type: 'hadith' }, { id: 200, alias: 'tafsir', type: 'tafsir' }])('rejects invalid source records', async value => {
  target = value;
  await expect(Editing.selectHadith(10, 200, 'replace_selected', 'admin')).rejects.toThrow('Select an original hadith');
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.rollback).toHaveBeenCalledTimes(1);
});
test('rolls back insertion and ordering changes on a database failure', async () => {
  const normal = connection.query.getMockImplementation();
  connection.query.mockImplementation((sql,args,cb) => sql.startsWith('INSERT') ? cb(new Error('insert failed')) : normal(sql,args,cb));
  await expect(Editing.selectHadith(10,200,'add_selected','admin')).rejects.toThrow('insert failed');
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(connection.commit).not.toHaveBeenCalled();
});
