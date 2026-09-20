'use strict';

const { ensureBookSharh, BOOK_INTRO, normalizeHonorifics } = require('../bin/utils/import-shamail-qari-sharh');
const source = { id: 3049, title: 'جمع الوسائل في شرح الشمائل', title_en: 'Jamʿ al-Wasāʾil' };
const opening = { text: 'نص شرح الكتاب كاملا', printedPage: 2 };

test('normalizes vocalized honorifics and paired dashes without losing paragraphs', () => {
	const text = 'النبي - صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ - قال.\n\nعائشة رَضِيَ اللَّهُ عَنْهَا وابن عمر رضي الله عنهما.';
	const normalized = normalizeHonorifics(text);
	expect(normalized).toBe('النبي ﷺ قال.\n\nعائشة ؓ وابن عمر ؓ .');
	expect(normalizeHonorifics(normalized)).toBe(normalized);
});

test.each([
	'صَلَّى اللَّهُ تَعَالَى عَلَيْهِ وَسَلَّمَ',
	'عَلَيْهِ الصَّلَاةُ وَالسَّلَامُ',
	'صَلَّى اللَّهُ -\n\nعَلَيْهِ وَسَلَّمَ -',
	'صَلَّى اللَّهُ عَلَيْهِ -\n\nوَسَلَّمَ -'
])('normalizes the edition-specific blessing %s', phrase => {
	expect(normalizeHonorifics(`النبي ${phrase} قال`)).toBe('النبي ﷺ قال');
});

test('preserves incomplete blessings quoted to discuss their wording', () => {
	const text = 'فلا تقل: صلى الله عليه فقط، ولا عليه السلام فقط';
	expect(normalizeHonorifics(text)).toBe(text);
});

test('moves the legacy commentary to its attributed row and leaves a simple introduction', async () => {
	const query = jest.fn(async (sql, values) => {
		if (sql.startsWith('SELECT ts.')) return [];
		if (sql.startsWith('SELECT * FROM toc')) return [{ id: 166740, intro: opening.text, intro_en: '' }];
		return { affectedRows: 1 };
	});
	expect(await ensureBookSharh(query, 32, source, opening)).toBe(166740);
	const insert = query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO hdith_toc_sharh'));
	expect(insert[1]).toEqual([166740, source.id, -8000000, 2, source.title, source.title_en, opening.text]);
	const update = query.mock.calls.find(([sql]) => sql.startsWith('UPDATE toc'));
	expect(update[1]).toEqual([BOOK_INTRO.title, BOOK_INTRO.titleEn, BOOK_INTRO.text, BOOK_INTRO.textEn, 166740]);
});

test('does not overwrite an edited legacy introduction', async () => {
	const query = jest.fn(async sql => sql.startsWith('SELECT ts.') ? [] : [{ id: 166740, intro: 'Edited text' }]);
	await expect(ensureBookSharh(query, 32, source, opening)).rejects.toThrow('was edited');
	expect(query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
});

test('reimport preserves the existing introduction and avoids duplicate sharh', async () => {
	const query = jest.fn().mockResolvedValue([{ toc_id: 166740, bookId: 32, text: opening.text }]);
	expect(await ensureBookSharh(query, 32, source, opening)).toBe(166740);
	expect(query).toHaveBeenCalledTimes(1);
});

test('creates a placeholder introduction for a fresh import', async () => {
	const query = jest.fn(async sql => {
		if (sql.startsWith('SELECT COALESCE')) return [{ next: 1 }];
		if (sql.startsWith('SELECT')) return [];
		return { insertId: 166740, affectedRows: 1 };
	});
	expect(await ensureBookSharh(query, 32, source, opening)).toBe(166740);
	expect(query.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO toc'))).toHaveLength(2);
	expect(query.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO hdith_toc_sharh'))).toHaveLength(1);
});
