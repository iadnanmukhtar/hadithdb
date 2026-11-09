'use strict';
const Downloads = require('../lib/BookDownloads');
const Metadata = require('../lib/HdithMetadata');
const Utils = require('../lib/Utils');
const AdmZip = require('adm-zip');
const book = { id: 100, alias: 'sample-sharh', type: 'sharh', name_en: 'Sample commentary', name: 'شرح', lang: 'ar-en' };
afterEach(() => jest.restoreAllMocks());

test('separate sharh exports preserve commentary languages and canonical hadith references without metadata hydration', async () => {
  const previous = global.query;
  global.query = jest.fn(async () => [
    { id: 1, kind: 'heading', source_alias: 'bukhari', body: 'مقدمة', body_en: 'Introduction' },
    { id: 1, kind: 'hadith', source_alias: 'bukhari', ref: 'bukhari:1a', num: '1a', body: 'شرح الحديث', body_en: 'Explanation' }
  ]);
  const metadata = jest.spyOn(Metadata, 'forHadiths');
  try {
    const rows = await Downloads.sharhBookRows(book);
    let text = '';
    for await (const chunk of Downloads.streamBookJson(book, rows)) text += chunk;
    const doc = JSON.parse(text);
    expect(doc.book.downloads.json).toContain('/sharh/sample-sharh.json');
    expect(doc.chapters[0].items[0].path).toContain('/sharh/sample-sharh/heading/1');
    expect(doc.chapters[0].items[1]).toMatchObject({ ref: 'bukhari:1a', number: '1a', text: { ar: 'شرح الحديث', en: 'Explanation' } });
    expect(doc.chapters[0].items[1].path).toContain('/sharh/sample-sharh/bukhari:1a');
    expect(metadata).not.toHaveBeenCalled();
    const epub = Utils.toEpub(book, doc);
    const zip = new AdmZip(epub);
    const html = zip.getEntries().filter(entry => entry.entryName.endsWith('.xhtml')).map(entry => zip.readAsText(entry)).join('\n');
    expect(html).toContain('bukhari:1a');
    expect(html).toContain('Explanation');
    if (process.env.SHARH_TEST_EPUB) require('fs').writeFileSync(process.env.SHARH_TEST_EPUB, epub);
  } finally { global.query = previous; }
});
