'use strict';
const SharhBooks = require('../lib/SharhBooks');
const Sharh = require('../lib/Sharh');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

afterEach(() => { delete global.query; delete global.dbPool; delete global.books; });
function connectionWith(responder) {
 const connection = { release: jest.fn(), query: jest.fn((sql, params, cb) => {
  if (typeof params === 'function') { cb=params; params=[]; }
  Promise.resolve().then(() => responder(sql, params)).then(value => cb(null,value), cb);
 }) };
 global.query = jest.fn(async () => [{ Field: 'book_id' }]);
 global.dbPool = { getConnection: cb => cb(null, connection) };
 return connection;
}
test('selection links only the requested entry to an existing book, preserving imported source data', async () => {
 const book = { id: 100417, type: 'sharh', alias: 'mushkil', shortName: 'مشكل' };
 const db = connectionWith(sql => sql.includes('GET_LOCK') ? [{ acquired: 1 }] : sql.includes('SELECT * FROM books') ? [book] : { affectedRows: 1 });
 expect(await SharhBooks.assignEntryBook('hadith',94195,{bookId:100417})).toEqual(book);
 expect(db.query.mock.calls.some(([sql,args]) => sql === 'UPDATE hdith_hadith_sharh SET book_id=? WHERE id=?' && args[0]===100417 && args[1]===94195)).toBe(true);
 expect(db.query.mock.calls.some(([sql]) => /SET.*source_id|SET.*title=/.test(sql))).toBe(false);
});
test('new book is created and heading linked in the same transaction', async () => {
 const book = {id:200,shortName:'جديد',shortName_en:'New'};
 const db = connectionWith(sql => sql.includes('GET_LOCK') ? [{acquired:1}] : sql.includes('MAX(id)') ? [{id:199}] : sql==='SELECT * FROM books WHERE id=?' ? [book] : sql.includes('SELECT * FROM books') ? [] : {affectedRows:1});
 await SharhBooks.assignEntryBook('heading',8,{title:'جديد',title_en:'New'});
 expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO books'))).toBe(true);
 expect(db.query.mock.calls.some(([sql,args]) => sql.startsWith('UPDATE hdith_toc_sharh SET book_id') && args[0]===200)).toBe(true);
 expect(db.query.mock.calls.some(([sql]) => sql==='COMMIT')).toBe(true);
});
test('explicit book association and its edited names win over legacy source titles', () => {
 global.books=[{id:200,type:'sharh',alias:'new',shortName:'عنوان',shortName_en:'Title'}];
 expect(Sharh.decorate({id:3,sharh_book_id:200,title:'Old',source_id:55,hadith_ref:'bukhari:100'})).toMatchObject({title:'عنوان',title_en:'Title',full_page_url:'/sharh/new/bukhari:100'});
});
test('book page shows metadata and description without commentary entries or pagination', () => {
 const filename=path.join(__dirname,'../views/sharh_books.ejs');
 const html=ejs.render(fs.readFileSync(filename,'utf8'),{global:{settings:{site:{}}},req:{},sharhBook:{id:200,alias:'new',shortName_en:'Title',shortName:'عنوان',author:'Author',description:'Description text'},books:[],coveredBooks:[],offset:0,entries:[{id:3,reference:'must not appear'}],utils:{sharhDisplayName: require('../lib/SharhDisplayName').displayName, sharhAuthorSuffix: require('../lib/SharhDisplayName').authorSuffix,markdownToHtml:s=>s},include:(name,data)=>name==='sub-views/book_metadata.ejs' ? ejs.render(fs.readFileSync(path.join(__dirname,'../views',name),'utf8'),{...data,utils:{sharhDisplayName: require('../lib/SharhDisplayName').displayName, sharhAuthorSuffix: require('../lib/SharhDisplayName').authorSuffix,emptyIfNull:s=>s||'',markdownToHtml:s=>s}}) : ''},{filename});
 expect(html).toContain('Author');expect(html).toContain('Description text');expect(html).not.toContain('must not appear');expect(html).not.toContain('Pagination');
});

 test('merged source identities resolve to the surviving book without relying on editable names', () => {
 const book={id:100424,type:'sharh',alias:'merged',properties:{sharh:{source_id:2981,source_title:'first'},sharh_sources:[{source_id:2981,source_title:'second'}]}};
 global.books=[book];
 for(const source_title of ['first','second']) expect(Sharh.decorate({id:1,source_id:2981,source_book_id:-1,source_title}).sharh_book).toBe(book);
});
