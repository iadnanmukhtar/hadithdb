'use strict';
jest.mock('../lib/GoogleAuth', () => ({ verifyRequest: jest.fn(async req => req.headers.authorization === 'Bearer alice' ? { uid: 'alice' } : null) }));
jest.mock('../lib/Model', () => ({ Item: { itemFromRef: jest.fn() } }));
const { Item } = require('../lib/Model');
const References = require('../lib/NotebookReferences');
const Notebook = require('../lib/UserNotebook');
const express = require('express');
const http = require('http');
let server, base;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use('/api/notebook', require('../routes/notebook'));
  server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/notebook`;
});
afterAll(() => new Promise(resolve => server.close(resolve)));
beforeEach(() => { global.books = [{ alias: 'bukhari' }, { alias: 'muslim' }]; Item.itemFromRef.mockReset(); global.query = jest.fn(async () => []); global.settings = { site: { url: 'https://hadithunlocked.com' } }; });
test('requires authentication and marks all responses private', async () => {
  const response = await fetch(base);
  expect(response.status).toBe(401);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(global.query).not.toHaveBeenCalled();
});
test('reads notes only for the authenticated account, ignoring supplied uid', async () => {
  const response = await fetch(`${base}?source=item:42&uid=bob`, { headers: { Authorization: 'Bearer alice' } });
  expect(response.status).toBe(200);
  expect(global.query.mock.calls.at(-1)[0]).toContain("user_uid='alice' AND source_key='item:42'");
});
test('update and delete are owner scoped and reject stale versions', async () => {
  global.query.mockResolvedValue({ affectedRows: 0 });
  const note = { source_key: 'item:42', source_title: 'Quran 1:1', source_url: '/quran:1:1', markdown: 'سلام', version: 2 };
  await expect(Notebook.save('alice', note)).rejects.toMatchObject({ status: 409 });
  expect(global.query.mock.calls.at(-1)[0]).toContain("user_uid='alice' AND source_key='item:42' AND version=2");
  await expect(Notebook.remove('alice', 'item:42', 2)).rejects.toMatchObject({ status: 409 });
  expect(global.query.mock.calls.at(-1)[0]).toContain("user_uid='alice' AND source_key='item:42' AND version=2");
});
test('new notes do not overwrite an existing note', async () => {
  global.query.mockRejectedValue({ code: 'ER_DUP_ENTRY' });
  await expect(Notebook.save('alice', { source_key: 'heading:12', source_title: 'Chapter', source_url: '/bukhari/1', markdown: 'Note', version: 0 })).rejects.toMatchObject({ status: 409 });
});
test('Markdown supports independent block direction and escapes executable HTML', () => {
  const html = Notebook.render('# العربية\n\nEnglish **note**\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))');
  expect(html).toContain('<h1 dir="auto"><span class="notebook-arabic">العربية</span></h1>');
  expect(html).toContain('<p dir="auto">English <strong>note</strong></p>');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('href="javascript:');
});
test.each(['javascript:alert(1)', '//evil.test', '/\\evil.test', 'https://evil.test/note'])('rejects unsafe source URL %s', url => {
  expect(() => Notebook.sourceUrl(url)).toThrow('Invalid source URL');
});
test('validates content size and source identity', async () => {
  expect(() => Notebook.key('item:1 OR 1=1')).toThrow();
  expect(Notebook.key('tafsir:ar-tabari:2:1')).toBe('tafsir:ar-tabari:2:1');
  await expect(Notebook.save('alice', { source_key: 'item:1', markdown: 'ا'.repeat(33000) })).rejects.toMatchObject({ status: 413 });
});

test('links Quran and hadith references with expand controls, excluding code and URLs', () => {
  const html = Notebook.render('bukhari:100 and quran:2:255. `muslim:1` https://example.com/bukhari:99\n\n```\nbukhari:101\n```');
  expect(html).toContain('href="/bukhari:100"');
  expect(html).toContain('href="/quran:2:255"');
  expect((html.match(/data-notebook-reference=/g) || []).length).toBe(2);
  expect(html).not.toContain('href="/quran:2"');
});
test('supports explicit Markdown reference links without nested anchors', () => {
  const html = Notebook.render('[Read this](/bukhari:100)');
  expect(html).toContain('</a> <button');
  expect(html).toContain('data-notebook-reference="bukhari:100"');
});
test('saved expansions render as permanent quotations without another expand button', () => {
  const html = Notebook.render('bukhari:100\n\n> **[bukhari:100](/bukhari:100 "Expanded reference")**\n>\n> النص العربي\n>\n> English translation');
  expect(html).toContain('<blockquote dir="auto">');
  expect(html).toContain('النص العربي');
  expect(html).not.toContain('data-notebook-reference=');
});
test('expansion looks up the exact reference and saves both languages with the draft', async () => {
  Item.itemFromRef.mockResolvedValue({ ref: 'bukhari:100', ar: { chain: 'السند', body: '*النص*' }, en: { chain: 'Chain', body: 'Translation' } });
  const body = { source_key: 'item:1', source_title: 'My note', source_url: '/quran:1:1', markdown: 'My draft bukhari:100', reference: 'bukhari:100', version: 0 };
  global.query.mockImplementation(async sql => sql.startsWith('SELECT') ? [{ ...body, version: 1 }] : { affectedRows: 1 });
  await Notebook.expand('alice', body);
  expect(Item.itemFromRef).toHaveBeenCalledWith('bukhari:100');
  const insert = global.query.mock.calls.find(([sql]) => sql.startsWith('INSERT'))[0];
  expect(insert).toContain('My draft');
  expect(insert).not.toContain('My draft bukhari:100');
  expect(insert).toContain('السند');
  expect(insert).toContain('النص');
  expect(insert).not.toContain('*النص*');
  expect(insert).toContain('Translation');
  expect(insert).toContain('Expanded reference');
});
test('missing and mismatched references never write a note', async () => {
  Item.itemFromRef.mockResolvedValue({ ref: 'bukhari:101', ar: { body: 'Wrong text' } });
  await expect(References.snapshot('bukhari:100')).rejects.toMatchObject({ status: 404 });
  Item.itemFromRef.mockRejectedValue(new ReferenceError('Not found'));
  await expect(References.snapshot('bukhari:100')).rejects.toMatchObject({ status: 404 });
  await expect(Notebook.expand('alice', { markdown: 'No reference', reference: 'bukhari:100' })).rejects.toMatchObject({ status: 400 });
  expect(global.query).not.toHaveBeenCalled();
});
test('native reference snapshots refresh the exact database record', async () => {
  Item.itemFromRef.mockResolvedValue({ ref: 'quran:2:255', id: 204673, book_id: 0, ar: { body: 'Old' }, en: { body: 'Old' } });
  global.query.mockResolvedValue([{ body: 'اللَّهُ', body_en: 'Current translation', footnote_en: 'Translation footnote' }]);
  const quote = await References.snapshot('quran:2:255');
  expect(global.query.mock.calls[0][0]).toContain('WHERE id=204673 AND bookId=0');
  expect(quote).toContain('Current translation');
  expect(quote).toContain('Translation footnote');
  expect(quote).not.toContain('Old');
});
test('expansion endpoint requires login and rejects references absent from the note', async () => {
  expect((await fetch(`${base}/expand`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401);
  const response = await fetch(`${base}/expand`, { method: 'POST', headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' }, body: JSON.stringify({ markdown: 'Unrelated', reference: 'bukhari:100' }) });
  expect(response.status).toBe(400);
  expect(global.query).not.toHaveBeenCalled();
});
test('note presence lookup is bounded and scoped to the signed-in account', async () => {
  global.query.mockResolvedValue([{ source_key: 'item:1' }]);
  expect(await Notebook.status('alice', ['item:1', 'heading:2'])).toEqual(['item:1']);
  expect(global.query.mock.calls.at(-1)[0]).toContain("WHERE user_uid='alice' AND source_key IN ('item:1', 'heading:2')");
  await expect(Notebook.status('alice', Array(201).fill('item:1'))).rejects.toMatchObject({ status: 400 });
});
test('note presence endpoint requires login', async () => {
  const response = await fetch(`${base}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sources: ['item:1'] }) });
  expect(response.status).toBe(401);
  expect(global.query).not.toHaveBeenCalled();
});

test('Arabic prose and inline backticks use the Arabic font without changing English code', () => {
  const html = Notebook.render('العربية هنا\n\nEnglish with العربية and `بِسْمِ اللَّهِ` and `const x = 1`.');
  expect(html).toContain('<span class="notebook-arabic">العربية هنا</span>');
  expect(html).toContain('<code dir="auto" class="notebook-arabic">');
  expect(html).toContain('<code>const x = 1</code>');
  expect(Notebook.render('`العربية <script>alert(1)</script>`')).not.toContain('<script>');
});

test.each(['intro:42', 'sharh:42', 'heading-sharh:42'])('keeps %s notes independently scoped to the signed-in user', async source => {
  const response = await fetch(`${base}?source=${source}`, { headers: { Authorization: 'Bearer alice' } });
  expect(response.status).toBe(200);
  expect(global.query.mock.calls.at(-1)[0]).toContain(`user_uid='alice' AND source_key='${source}'`);
});

test('notebook ZIP requires authentication', async () => {
  const response = await fetch(`${base}/download`);
  expect(response.status).toBe(401);
  expect(global.query).not.toHaveBeenCalled();
});
test('exports the entire owned notebook as distinct UTF-8 Markdown files', async () => {
  const rows = Array.from({ length: 57 }, (_, i) => ({ source_key: `intro:${i + 1}`, source_title: '../ Same / عنوان', markdown: `# ملاحظة ${i}\n\n**Saved** text\n` }));
  global.query.mockResolvedValue(rows);
  const response = await fetch(`${base}/download?uid=bob`, { headers: { Authorization: 'Bearer alice' } });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/zip');
  expect(response.headers.get('content-disposition')).toContain('My Notebook.zip');
  expect(response.headers.get('cache-control')).toContain('no-store');
  const zip = new (require('adm-zip'))(Buffer.from(await response.arrayBuffer()));
  const entries = zip.getEntries();
  expect(entries).toHaveLength(57);
  expect(new Set(entries.map(entry => entry.entryName)).size).toBe(57);
  for (const row of rows) {
    const entry = entries.find(entry => entry.entryName.endsWith(`(${row.source_key.replace(/:/g, '-')}).md`));
    expect(entry.entryName).not.toMatch(/[\\/]/);
    expect(entry.getData().toString('utf8')).toBe(row.markdown);
  }
  expect(global.query.mock.calls.at(-1)[0]).toContain("WHERE user_uid='alice'");
  expect(global.query.mock.calls.at(-1)[0]).not.toContain('LIMIT');
});

test('notebook pages return twelve notes and detect the next batch', async () => {
  global.query.mockResolvedValue(Array.from({ length: 13 }, (_, i) => ({ source_key: `item:${i}`, markdown: 'Note' })));
  const result = await Notebook.list('alice', 12);
  expect(result.notes).toHaveLength(12);
  expect(result.hasMore).toBe(true);
  expect(global.query.mock.calls.at(-1)[0]).toContain("user_uid='alice'");
  expect(global.query.mock.calls.at(-1)[0]).toContain('LIMIT 13 OFFSET 12');
});

test('general notes are private, unattached, and sorted before reading notes', async () => {
  await Notebook.save('alice', { source_key: 'general', markdown: 'Private thoughts', version: 0 });
  const insert = global.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO user_notebook'))[0];
  expect(insert).toContain("'alice', 'general', 'General note', '/notebook'");
  await Notebook.list('alice');
  expect(global.query.mock.calls.at(-1)[0]).toContain("ORDER BY (source_key='general') DESC");
  await Notebook.get('bob', 'general');
  expect(global.query.mock.calls.at(-1)[0]).toContain("user_uid='bob' AND source_key='general'");
});

 test('expansion controls are accessible icons', () => {
  const html = Notebook.render('bukhari:100');
  expect(html).toContain('bi-arrows-angle-expand');
  expect(html).toContain('aria-label="Expand bukhari:100"');
  expect(html).not.toContain('>Expand</button>');
});
test('removes prose references and Markdown reference links without changing code or other URLs', () => {
  const md = new (require('markdown-it'))();
  const text = 'Before bukhari:100 after [Read this](/bukhari:100).\n\n`bukhari:100` https://example.com/bukhari:100 bukhari:1000\n\n```\nbukhari:100\n```';
  expect(References.removeReference(text, 'bukhari:100', md)).toBe('Before  after .\n\n`bukhari:100` https://example.com/bukhari:100 bukhari:1000\n\n```\nbukhari:100\n```');
});

test('expanded source text and translations omit Markdown formatting', async () => {
  Item.itemFromRef.mockResolvedValue({ ref: 'bukhari:100', ar: { body: '# عنوان\n\n**النص** و*شرح* و`كلمة`' }, en: { body: '## Heading\n\n**Bold** and *italic*, [label](https://example.com), ~~deleted~~, ==highlight==.\n\n- First\n- Second' } });
  const quote = await References.snapshot('bukhari:100');
  expect(quote).toContain('> عنوان');
  expect(quote).toContain('> النص وشرح وكلمة');
  expect(quote).toContain('> Bold and italic, label, deleted, highlight.');
  expect(quote).toContain('> First');
  expect(quote).toContain('> Second');
  expect(quote).not.toContain('## Heading');
  expect(quote).not.toContain('https://example.com');
  expect(Notebook.render(quote)).not.toContain('<em>');
  expect(quote).toContain('"Expanded reference"');
});

test('ayah menu resolves the existing canonical note for the signed-in user', async () => {
  Item.itemFromRef.mockResolvedValue({ ref: 'quran:2:255', id: 204673 });
  const response = await fetch(`${base}/ayah?reference=quran:2:255`, { headers: { Authorization: 'Bearer alice' } });
  expect(response.status).toBe(200);
  expect((await response.json()).source.source_key).toBe('item:204673');
  expect(global.query.mock.calls.at(-1)[0]).toContain("user_uid='alice' AND source_key='item:204673'");
  expect((await fetch(`${base}/ayah?reference=quran:2:255`)).status).toBe(401);
});
test('ayah menu rejects mismatched source records', async () => {
  Item.itemFromRef.mockResolvedValue({ ref: 'quran:2:254', id: 42 });
  expect((await fetch(`${base}/ayah?reference=quran:2:255`, { headers: { Authorization: 'Bearer alice' } })).status).toBe(404);
  expect(global.query).not.toHaveBeenCalled();
});
