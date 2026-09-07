'use strict';
const CommentaryHeadings = require('../lib/CommentaryHeadings');
const ejs = require('ejs');
const path = require('path');
const Utils = require('../lib/Utils');
const Tafsir = require('../lib/Tafsir');
const previousQuery = global.query;
afterEach(() => { global.query = previousQuery; });

test('deletes only an introduction article with no linked hadiths', async () => {
 global.query = jest.fn().mockResolvedValueOnce([{ id: 91, bookId: 50 }])
  .mockResolvedValueOnce([{ id: 50, type: 'hadith' }])
  .mockResolvedValueOnce([]).mockResolvedValueOnce({ affectedRows: 1 });
 await expect(CommentaryHeadings.deleteIntroductionArticle(91)).resolves.toMatchObject({ value: { id: 91, bookId: 50, deleted: true } });
 expect(global.query.mock.calls[0][0]).toContain('AND level=2 AND h1=0');
 expect(global.query.mock.calls[2][0]).toContain('hadiths_virtual');
 expect(global.query.mock.calls[3][0]).toContain('DELETE FROM toc WHERE id=91 AND level=2 AND h1=0');
});

test('refuses to delete a heading containing physical or virtual hadiths', async () => {
 global.query = jest.fn().mockResolvedValueOnce([{ id: 91, bookId: 50 }])
  .mockResolvedValueOnce([{ id: 50, type: 'hadith' }]).mockResolvedValueOnce([{ id: 5 }]);
 await expect(CommentaryHeadings.deleteIntroductionArticle(91)).rejects.toThrow('contains hadiths');
 expect(global.query).toHaveBeenCalledTimes(3);
});

test('rejects invalid ids and ordinary chapter headings', async () => {
 global.query = jest.fn().mockResolvedValue([]);
 await expect(CommentaryHeadings.deleteIntroductionArticle('91 OR 1=1')).rejects.toThrow('Invalid');
 expect(global.query).not.toHaveBeenCalled();
 await expect(CommentaryHeadings.deleteIntroductionArticle(91)).rejects.toThrow('not found');
 expect(global.query).toHaveBeenCalledTimes(1);
});

test.each([[false, 0, false], [true, 0, true], [true, 4, false]])('delete control respects edit mode %s and hadith count %s', async (editMode, count, visible) => {
 const html = await ejs.renderFile(path.join(__dirname, '../views/sub-views/quran_commentary_article.ejs'), {
  utils: Utils, Tafsir, site: { editMode }, article: { id: 91, h2: 2, count, intro: 'مقدمة' }
 });
 expect(html.includes('data-delete-introduction-article="91"')).toBe(visible);
});
