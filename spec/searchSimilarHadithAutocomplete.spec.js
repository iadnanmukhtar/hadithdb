'use strict';

jest.mock('../lib/Index', () => ({
	docsFromKeyValue: jest.fn(async () => []),
	docsFromQuery: jest.fn(async () => [])
}));

const Index = require('../lib/Index');
const Search = require('../lib/Search');

describe('admin similar hadith autocomplete', () => {
	beforeEach(() => {
		global.books = [];
		Index.docsFromKeyValue.mockReset().mockResolvedValue([]);
		Index.docsFromQuery.mockReset().mockResolvedValue([]);
	});

	test('returns internal hadith ids and excludes the main and existing hadiths in Elasticsearch', async () => {
		Index.docsFromQuery.mockResolvedValueOnce([{
			hId: 456,
			doctype: 'hadith',
			ref: 'muslim:456',
			book_alias: 'muslim',
			book_shortName_en: 'Muslim',
			book_shortName: 'مسلم',
			book_ordinal: 2,
			ordinal: 456,
			h2_title_en: 'Faith',
			h2_title: 'الإيمان',
			body_en: 'The Messenger of Allah said...',
			_highlight: { body_en: ['The <i>Messenger</i> of Allah said...'] }
		}]);

		const suggestions = await Search.a_similarHadithAutocomplete('Messenger Allah', 10, {
			ids: [123, 234],
			refs: ['bukhari:1', 'muslim:234']
		});
		const query = Index.docsFromQuery.mock.calls[0][1];

		expect(query.bool.must.bool.filter.term.doctype).toBe('hadith');
		expect(query.bool.must_not).toContainEqual({ term: { book_alias: 'quran' } });
		expect(query.bool.must_not).toContainEqual({ terms: { hId: [123, 234] } });
		expect(query.bool.must_not).toContainEqual({ terms: { ref: ['bukhari:1', 'muslim:234'] } });
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]).toMatchObject({ id: 456, ref: 'muslim:456', type: 'Hadith' });
	});
});

test('collection and grade filters narrow searches, including browsing without text', async () => {
  global.books = [{ alias: 'bukhari', type: 'hadith' }];
  Index.docsFromQuery.mockReset().mockResolvedValue([]);
  await Search.a_similarHadithAutocomplete('', 12, {}, { books: ['bukhari'], grade: '1' });
  const query = Index.docsFromQuery.mock.calls[0][1];
  expect(query.bool.must).toEqual({ match_all: {} });
  expect(query.bool.filter).toContainEqual({ terms: { book_alias: ['bukhari'] } });
  expect(query.bool.filter).toContainEqual({ term: { grade_id: 1 } });
});

test('exact references cannot bypass collection or grade filters', async () => {
  global.books = [{ id: 1, alias: 'bukhari', type: 'hadith', shortName_en: 'Bukhari' }];
  Index.docsFromQuery.mockReset().mockResolvedValue([]);
  await Search.a_similarHadithAutocomplete('bukhari:1', 12, {}, { books: ['muslim'], grade: '2' });
  expect(Index.docsFromQuery).toHaveBeenCalledTimes(2);
  expect(Index.docsFromQuery.mock.calls[0][1].bool.filter).toContainEqual({ term: { ref: 'bukhari:1' } });
  for (const [, query] of Index.docsFromQuery.mock.calls) {
    expect(query.bool.filter).toContainEqual({ terms: { book_alias: ['muslim'] } });
    expect(query.bool.filter).toContainEqual({ term: { grade_id: 2 } });
  }
});

test('multiple selected books are combined as alternatives while retaining the grade filter', async () => {
  global.books = [{ alias: 'bukhari', type: 'hadith' }, { alias: 'muslim', type: 'hadith' }];
  Index.docsFromQuery.mockReset().mockResolvedValue([]);
  await Search.a_similarHadithAutocomplete('faith', 12, {}, { books: ['bukhari', 'muslim'], grade: '100' });
  const query = Index.docsFromQuery.mock.calls[0][1];
  expect(query.bool.filter).toContainEqual({ terms: { book_alias: ['bukhari', 'muslim'] } });
  expect(query.bool.filter).toContainEqual({ term: { grade_id: 100 } });
});
