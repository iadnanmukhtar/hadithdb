'use strict';
jest.mock('../lib/Index', () => ({ docsFromQuery: jest.fn(), docsFromQueryFields: jest.fn().mockResolvedValue([]) }));
const Index = require('../lib/Index');
const Search = require('../lib/Search');
const Books = require('../lib/Books');
const { passage } = require('../bin/utils/import-hdith-sirah');
describe('Sirah content', () => {
 beforeEach(() => {
  global.settings = { search: { itemsPerPage: 50 } };
  global.books = [{id:101,alias:'ibnhisham',type:'sirah',hidden:0,shortName_en:'Sirat Ibn Hisham'}];
  Index.docsFromQuery.mockReset();
  Index.docsFromQuery.mockResolvedValue(Object.assign([], {total:0}));
 });
 test('preserves source text and rejects mismatched identities and non-passages',()=>{
  const source={id:813787,book:{slug:'b-81'},entry_kind:'passage',matn:'بِسْمِ اللَّهِ\n\nالنص  ',chapter_text:'عنوان'};
  expect(passage(source,813787).text).toBe(source.matn);
  expect(()=>passage(source,813788)).toThrow('Wrong source identity');
  expect(()=>passage({...source,entry_kind:'hadith'},813787)).toThrow();
  expect(()=>passage({...source,matn:''},813787)).toThrow('Empty passage');
 });
 test('catalog model remains sirah',()=>{
  expect(Books.normalizeBook(global.books[0],'books').book_model).toBe('sirah');
 });
 test('general default contains Sirah and explicit Hadith excludes it',async()=>{
  expect(Search.generalContentFilters([])).toContain('sirah');
  await Search.a_searchText('=النسب', ['hadith'],0,{generalSearch:true});
  const union=Index.docsFromQuery.mock.calls[0][1].bool.filter[0].bool.should;
  expect(union).toHaveLength(1);
  expect(union[0].bool.filter).toContainEqual({term:{doctype:'hadith'}});
 });
 test.each([['sirah'],['ibnhisham']])('Sirah selection %s queries passages',async(selection)=>{
  await Search.a_searchText('=النسب',[selection],0,{generalSearch:true});
  const union=Index.docsFromQuery.mock.calls[0][1].bool.filter[0].bool.should;
  expect(union).toHaveLength(1);
  expect(union[0].bool.filter).toContainEqual({term:{doctype:'sirah'}});
  if(selection==='ibnhisham')expect(union[0].bool.filter).toContainEqual({terms:{book_alias:['ibnhisham']}});
 });
});
