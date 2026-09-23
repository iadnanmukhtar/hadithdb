'use strict';
jest.mock('../lib/Model', () => ({Item:{itemFromRef:jest.fn()}}));
jest.mock('../lib/Search', () => ({ a_autocomplete: jest.fn() }));
const Search = require('../lib/Search');
const Attachments = require('../lib/NotebookAttachments');
test('reference search uses public corpus search and excludes whole-book navigation', async () => {
  Search.a_autocomplete.mockResolvedValue([
    {ref:'bukhari:1',url:'/bukhari:1',label:'Intentions',type:'Hadith',fragment:'Actions depend on intentions'},
    {ref:'quran:2:255',url:'/quran:2:255',label:'Ayat al-Kursi',type:'Ayah'},
    {ref:'bukhari',url:'/bukhari',label:'Bukhari',type:'Book'}
  ]);
  const results = await Attachments.search('intention');
  expect(results.map(item => item.ref)).toEqual(['bukhari:1','quran:2:255']);
  expect(Search.a_autocomplete).toHaveBeenCalledWith('intention',[],12);
});

test('an exact reference resolves the actual item instead of unrelated text matches', async () => {
  const Item = require('../lib/Model').Item;
  Item.itemFromRef.mockResolvedValue({ref:'bukhari:1',body_en:'Actions depend on intentions'});
  expect(await Attachments.search('bukhari:1')).toEqual([expect.objectContaining({ref:'bukhari:1',url:'/bukhari:1',fragment:'Actions depend on intentions'})]);
  Item.itemFromRef.mockRejectedValue(new ReferenceError('Not found'));
  expect(await Attachments.search('bukhari:999999')).toEqual([]);
});
