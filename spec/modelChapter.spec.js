'use strict';

const Index = require('../lib/Index');
const { Book, Chapter, Section, Subsection, Library } = require('../lib/Model');

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
