'use strict';

const Index = require('../lib/Index');
const { Book, Chapter, Section, Subsection, Library } = require('../lib/Model');

describe('Book.getChapters', () => {
  const originalQuery = global.query;

  afterEach(() => {
    jest.restoreAllMocks();
    global.query = originalQuery;
  });

  test.each(['sirah','hadith'])('%s TOC includes H3 titles and stable passage starts under their H2 parent', async type => {
    const search = jest.spyOn(Index, 'docsFromQueryFields').mockResolvedValue([])
      .mockResolvedValueOnce([{level:1,book_alias:'yqsirah',h1:11,h1_title_en:'Opposition'}])
      .mockResolvedValueOnce([{level:2,book_alias:'yqsirah',h1:11,h2:3,h2_title_en:'Proposing a Bargain',h2_start:'89',h2_count:4}])
      .mockResolvedValueOnce([{level:3,book_alias:'yqsirah',h1:11,h2:3,h3:1,h3_title_en:'The Phenomenon of Abu Talib',h3_start:'90',h3_count:1}]);
    const chapters = await new Book({alias:'yqsirah',type}).getChapters();
    const children = chapters[0].sections[0].subsections;
    expect(children).toHaveLength(1);
    expect(children[0]).toBeInstanceOf(Subsection);
    expect(children[0]).toMatchObject({level:3,h3:1,title_en:'The Phenomenon of Abu Talib',start:'90',count:1});
    expect(search.mock.calls[2][2]).toEqual(expect.arrayContaining(['h3_title_en','h3_start','h3_count']));
  });

  test('loads the TOC chapter rail source from Elasticsearch without querying the DB', async () => {
    global.query = jest.fn(() => {
      throw new Error('TOC heading rails must not query the DB');
    });
    const search = jest.spyOn(Index, 'docsFromQueryFields').mockResolvedValue([])
      .mockResolvedValueOnce([{
        ordinal: 1,
        level: 1,
        book_alias: 'bukhari',
        h1: 1,
        path: 'bukhari/1',
        h1_title_en: 'Revelation'
      }])
      .mockResolvedValueOnce([{
        ordinal: 2,
        level: 2,
        book_alias: 'bukhari',
        h1: 1,
        h2: 1,
        path: 'bukhari/1/1',
        h2_title_en: 'How the Divine Revelation started'
      }]);

    const chapters = await new Book({ alias: 'bukhari' }).getChapters();

    expect(chapters).toHaveLength(1);
    expect(chapters[0].sections).toHaveLength(1);
    expect(search).toHaveBeenCalledTimes(3);
    expect(search.mock.calls.map(call => [call[0], call[1].bool.filter[1], call[5]])).toEqual([
      ['toc', { term: { level: 1 } }, 'ordinal, tId'],
      ['toc', { term: { level: 2 } }, 'ordinal, tId'],
      ['toc', { term: { level: 3 } }, 'ordinal, tId']
    ]);
    expect(global.query).not.toHaveBeenCalled();
  });
});

describe('Chapter.getFirstSection', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('selects only positive sections for chapter redirects', async () => {
    const docsFromQueryString = jest.spyOn(Index, 'docsFromQueryString').mockResolvedValue([{
      book_alias: 'hakim',
      level: 2,
      h1: 23,
      h2: 1,
      h2_count: 1,
      path: 'hakim/23/1'
    }]);
    const chapter = new Chapter({
      book_alias: 'hakim',
      level: 1,
      h1: 23,
      path: 'hakim/23'
    });

    const section = await chapter.getFirstSection();

    expect(docsFromQueryString).toHaveBeenCalledWith(
      'toc',
      'book_alias:hakim AND level:2 AND h1:23 AND h2:[1 TO *]',
      0,
      1,
      'ordinal'
    );
    expect(section).toBeInstanceOf(Section);
    expect(section.path).toBe('hakim/23/1');
  });

  test('skips an empty section and redirects an integer parent to its first populated decimal chapter', async () => {
    const docsFromQueryString = jest.spyOn(Index, 'docsFromQueryString').mockResolvedValueOnce([{
        book_alias: 'ahmad',
        level: 2,
        h1: 1,
        h2: 1,
        h2_count: 0,
        path: 'ahmad/1/1'
      }]);
    const docsFromQuery = jest.spyOn(Index, 'docsFromQuery').mockResolvedValueOnce([{
        book_alias: 'ahmad',
        level: 1,
        h1: 1.2,
        h1_count: 81,
        path: 'ahmad/1.20'
      }]);
    const chapter = new Chapter({
      book_alias: 'ahmad',
      level: 1,
      h1: 1,
      path: 'ahmad/1'
    });

    const first = await chapter.getFirstSection();

    expect(docsFromQuery).toHaveBeenCalledWith(
      'toc',
      { bool: { filter: [
        { term: { book_alias: 'ahmad' } },
        { term: { level: 1 } },
        { range: { h1: { gt: 1, lt: 2 } } }
      ] } },
      0,
      100,
      'ordinal'
    );
    expect(first).toBeInstanceOf(Chapter);
    expect(first.path).toBe('ahmad/1.20');
  });
});

describe('Heading.getItems ordering', () => {
  beforeEach(() => {
    global.settings = { search: { itemsPerPage: 100 } };
    Library._singleton._initialized = true;
    Library._singleton._books = [new Book({ id: 15, alias: 'adab', virtual: 0 })];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    [new Section({ book_id: 15, book_alias: 'adab', level: 2, h1: 1, h2: 9 }), 'book_alias:adab AND h1:1 AND h2:9'],
    [new Subsection({ book_id: 15, book_alias: 'adab', level: 3, h1: 1, h2: 9, h3: 1 }), 'book_alias:adab AND h1:1 AND h2:9 AND h3:1']
  ])('sorts section-scoped items by source number with deterministic tie-breakers', async (heading, query) => {
    const docsFromQueryString = jest.spyOn(Index, 'docsFromQueryString').mockResolvedValue([]);

    await heading.getItems();

    expect(docsFromQueryString).toHaveBeenCalledWith(
      'hadiths',
      query,
      0,
      101,
      'numInChapter, ordinal, hId'
    );
  });

  test('keeps chapter pagination in canonical ordinal order with a stable tie-breaker', async () => {
    const docsFromQueryString = jest.spyOn(Index, 'docsFromQueryString').mockResolvedValue([]);
    const chapter = new Chapter({ book_id: 15, book_alias: 'adab', level: 1, h1: 1 });
    chapter.sections = [];

    await chapter.getItems();

    expect(docsFromQueryString).toHaveBeenCalledWith(
      'hadiths',
      'book_alias:adab AND h1:1',
      0,
      101,
      'ordinal, hId'
    );
  });
});
