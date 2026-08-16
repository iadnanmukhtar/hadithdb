'use strict';

const Index = require('../lib/Index');
const { Chapter, Section } = require('../lib/Model');

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
