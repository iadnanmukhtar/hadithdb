'use strict';
const { addVirtualReferences } = require('../lib/HadithVirtualReferences');
const ejs = require('ejs');
const path = require('path');
const Utils = require('../lib/Utils');

test('retains distinct numbers in the same alias section, excludes hidden books and resolves actual IDs', async () => {
    const base = { hId_ref: 100, book_alias: 'riyad', book_shortName: 'رياض', book_hidden: 0, h1: 0, h2: 0.01, h1_title_en: 'Introduction', h2_title_en: 'Sincerity' };
    global.query = jest.fn(async () => [
        { ...base, id: 1, num: '1' }, { ...base, id: 2, num: '2a' },
        { ...base, id: 2, num: '2a' }, { ...base, id: 3, num: '3', book_hidden: 1 }
    ]);
    const items = [{ id: 100 }, { id: 1000, actual: { id: 100 }, book_alias: 'riyad', num: '1' }, { id: 200 }];
    await addVirtualReferences(items);
    expect(items[0].virtualReferences.map(r => r.num)).toEqual(['1', '2a']);
    expect(items[0].virtualReferences[1]).toMatchObject({ book_shortName: 'رياض', num_ar: '٢أ' });
    expect(items[0].virtualReferences[1].referencePath).toBe('riyad/0/0.01#2a');
    expect(items[1].virtualReferences.map(r => r.num)).toEqual(['2a']);
    expect(items[2].virtualReferences).toEqual([]);
    expect(global.query.mock.calls[0][0]).toContain('IN (100,200)');
});

test('renders only alias references and headings, with escaped text and no repeated matn', async () => {
    const html = await ejs.renderFile(path.join(__dirname, '../views/sub-views/hadith_also_found.ejs'), {
        i: { body: 'Do not repeat the hadith', virtualReferences: [{ book_alias: 'riyad', book_shortName: 'رياض', num_ar: '٢أ', num: '2a', h1: 0, h2: 0.01, h1_title_en: '<script>bad</script>', h2_title_en: 'Sincerity', h1_title: 'المقدمة', h2_title: 'الإخلاص', path: 'riyad/0/0.01', referencePath: 'riyad/0/0.01#2a' }] },
        metadataBase: 'hadith-metadata-100', req: {}, utils: { ...Utils, formatHadithHeadingNumber: Utils.formatHadithHeadingNumber, urlFor: (_, url) => url }
    });
    expect(html).toContain('riyad:2a');
    expect(html).toContain('رياض:<bdi>٢أ</bdi>');
    expect(html).toContain('href="/riyad/0/0.01#2a"');
    expect(html).toContain('Sincerity');
    expect(html).toContain('الإخلاص');
    expect(html).not.toContain('Do not repeat the hadith');
    expect(html).not.toContain('<script>');
});
