'use strict';
const sqlite3 = require('sqlite3');
const { promisify } = require('util');
const Books = require('../lib/Books');
const { Library } = require('../lib/Model');

test('catalog counts preserve physical chapters, virtual ownership, remarks and empty books', async () => {
  const db = new sqlite3.Database(':memory:');
  const exec = promisify(db.exec).bind(db);
  const query = promisify(db.all).bind(db);
  const previousQuery = global.query;
  jest.spyOn(Books, 'ensureBookContentLastmodColumn').mockResolvedValue();
  jest.spyOn(Books, 'ensureAuthorShortNameColumns').mockResolvedValue();
  try {
    await exec(`
      CREATE TABLE books (id INTEGER, alias TEXT, ordinal INTEGER, virtual INTEGER);
      CREATE TABLE hadiths (bookId INTEGER, h1 REAL, remark INTEGER);
      CREATE TABLE v_hadiths_virtual_snapshot (book_id INTEGER, remark INTEGER);
      INSERT INTO books VALUES (1,'physical',2,0),(2,'virtual',1,1),(3,'empty',3,0),(4,'empty-virtual',4,1),(5,'remarks-only',5,0);
      INSERT INTO hadiths VALUES (1,1,0),(1,1,NULL),(1,1.2,0),(1,2,1),(1,0,0),(1,-1,-1),(1,NULL,0),
        (2,9,0),(2,9,0),(2,10,0),(4,1,0),(5,3,1),(5,4,-1);
      INSERT INTO v_hadiths_virtual_snapshot VALUES (2,0),(2,NULL),(2,1),(2,-1),(1,0);
    `);
    global.query = query;
    const books = await Library._allBooks();
    expect(books.map(book => [book.id, book.chapter_count, book.hadith_count])).toEqual([
      [2,2,2], [1,3,5], [3,0,0], [4,1,0], [5,2,0]
    ]);
    expect(books[0].alias).toBe('virtual');
  } finally {
    global.query = previousQuery;
    jest.restoreAllMocks();
    await promisify(db.close).bind(db)();
  }
});
