'use strict';
jest.mock('../lib/Index', () => ({ docsFromQuery: jest.fn(), docsFromQueryFields: jest.fn().mockResolvedValue([]) }));
const Index = require('../lib/Index');
const Search = require('../lib/Search');
const Books = require('../lib/Books');
const { passage, fullTitle } = require('../bin/utils/import-hdith-sirah');
describe('Sirah content', () => {
 beforeEach(() => {
  global.settings = { search: { itemsPerPage: 50 } };
  global.books = [
   {id:101,alias:'ibnhisham',type:'sirah',hidden:0,shortName_en:'Ibn Hisham'},
   {id:102,alias:'history',type:'sirah',hidden:0,shortName_en:'History'}
  ];
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
 test('restores truncated source headings only from matching full titles',()=>{
  expect(fullTitle('وفاة آم…','وفاة آمنة')).toBe('وفاة آمنة');
  expect(()=>fullTitle('وفاة آم…','عنوان آخر')).toThrow('Cannot recover heading');
  expect(fullTitle('عنوان كامل','عنوان آخر')).toBe('عنوان كامل');
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
 test.each([['history'],['sirah'],['ibnhisham']])('History selection %s queries passages',async(selection)=>{
  await Search.a_searchText('=النسب',[selection],0,{generalSearch:true});
  const union=Index.docsFromQuery.mock.calls[0][1].bool.filter[0].bool.should;
  const passageBranch=union.find(branch=>branch.bool.filter.some(filter=>filter.term?.doctype==='sirah'));
  const headingBranch=union.find(branch=>branch.bool.filter.some(filter=>filter.term?.doctype==='toc'));
  expect(passageBranch.bool.filter).toContainEqual({term:{doctype:'sirah'}});
  const expectedAliases = selection === 'sirah' ? ['ibnhisham','history'] : [selection];
  expect(headingBranch.bool.filter).toContainEqual({terms:{book_alias:expectedAliases}});
  if(selection!=='sirah')expect(passageBranch.bool.filter).toContainEqual({terms:{book_alias:expectedAliases}});
 });
});
