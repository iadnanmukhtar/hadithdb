'use strict';
// Keep legacy database and formatting contracts covered for the migration source.
// Drive persistence and the production router are exercised in notebookDrive.spec.js.
jest.mock('../lib/NotebookDrive', () => jest.requireActual('../lib/UserNotebook'));
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
test('note formatting supports highlights and both underline forms with nested emphasis', () => {
  const html = Notebook.render('==**bold** and *italic*== __underline__ <u>**also bold**</u>');
  expect(html).toContain('<mark><strong>bold</strong> and <em>italic</em></mark>');
  expect(html).toContain('<u><span class="notebook-underline">underline</span></u>');
  expect(html).toContain('<u><strong><span class="notebook-underline">also bold</span></strong></u>');
  expect(Notebook.render('_italic_')).toContain('<em>italic</em>');
});
test('Arabic including diacritics supports bold, italic, highlight and underline', () => {
  const arabic = 'العَرَبِيَّة';
  const span = `<span class="notebook-arabic">${arabic}</span>`;
  for (const [source, tag] of [[`**${arabic}**`, 'strong'], [`*${arabic}*`, 'em'], [`==${arabic}==`, 'mark']]) {
    expect(Notebook.render(source)).toContain(`<${tag}>${span}</${tag}>`);
  }
  expect(Notebook.render(`==**${arabic}**==`)).toContain(`<mark><strong>${span}</strong></mark>`);
  for (const source of [`__${arabic}__`, `<u>${arabic}</u>`]) {
    const html = Notebook.render(source);
    expect(html).toContain('data-notebook-overline');
    expect(html).toContain('\u0305');
    expect(html.replace(/\u0305/g, '')).toContain(arabic);
    expect((html.match(/\u0305/g) || []).length).toBe(7);
  }
  const mixed = Notebook.render('__English العربية__');
  expect(mixed).toContain('<span class="notebook-underline">English </span>');
  expect(mixed).toContain('data-notebook-overline');
});
test('formatting preserves literal code, escaped markers, unmatched markers and unsafe HTML', () => {
  const literal = '==mark== __line__ <u>text</u>';
  expect(Notebook.render('`' + literal + '`')).toContain('<code>==mark== __line__ &lt;u&gt;text&lt;/u&gt;</code>');
  expect(Notebook.render('```\n' + literal + '\n```')).not.toMatch(/<(mark|u)>/);
  expect(Notebook.render('\\=\\=literal\\=\\= \\_\\_literal\\_\\_ \\<u>literal</u>')).not.toMatch(/<(mark|u)>/);
  expect(Notebook.render('==unfinished <u>unfinished')).not.toMatch(/<(mark|u)>/);
  const html = Notebook.render('<u onclick="alert(1)">bad</u> <img src=x onerror=alert(1)> ==<script>alert(1)</script>==');
  expect(html).not.toMatch(/<(u|img|script)[ >]/);
  expect(html).toContain('&lt;script&gt;');
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
test('explicit Markdown links do not receive expand controls in their labels or destinations', () => {
  const html = Notebook.render('[Read this](/bukhari:100) [quran:2:255](/quran:2:255) [bukhari:100](https://example.com)');
  expect(html).toContain('href="/bukhari:100"');
  expect(html).toContain('href="/quran:2:255"');
  expect(html).not.toContain('data-notebook-reference=');
  const mixed = Notebook.render('[Read this](/bukhari:100) and bukhari:100');
  expect((mixed.match(/data-notebook-reference=/g) || [])).toHaveLength(1);
});
test.each(['', ' "Expanded reference"'])('saved expansions render as permanent quotations without another expand button (%s)', title => {
  const html = Notebook.render(`> **[bukhari:100](/bukhari:100${title})**\n>\n> النص العربي\n>\n> English translation`);
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
  expect(insert).not.toContain('السند');
  expect(insert).toContain('النص');
  expect(insert).not.toContain('*النص*');
  expect(insert).toContain('Translation');
  expect(insert).not.toContain('Expanded reference');
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
    const exported = require('front-matter')(entry.getData().toString('utf8'));
    expect(exported.body).toBe(row.markdown);
    expect(exported.attributes).toEqual({ tags: [], reference: row.source_key });
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

test('expanded source text is flattened before applying quotation formatting', async () => {
  Item.itemFromRef.mockResolvedValue({ ref: 'bukhari:100', ar: { body: '# عنوان\n\n**النص** و*شرح* و`كلمة`' }, en: { body: '## Heading\n\n**Bold** and *italic*, [label](https://example.com), ~~deleted~~, ==highlight==.\n\n- First\n- Second' } });
  const quote = await References.snapshot('bukhari:100');
  expect(quote).toContain('> عنوان');
  expect(quote).toContain('> النص وشرح وكلمة');
  expect(quote).toContain('> *Bold and italic, label, deleted, highlight.*');
  expect(quote).toContain('> *First');
  expect(quote).toContain('> *Second*');
  expect(quote).not.toContain('## Heading');
  expect(quote).not.toContain('https://example.com');
  expect(Notebook.render(quote)).toContain('<em>');
  expect(quote).not.toContain('Expanded reference');
});

test('ayah menu resolves the canonical note source before Drive authorization', async () => {
  Item.itemFromRef.mockResolvedValue({ ref: 'quran:2:255', id: 204673 });
  const response = await fetch(`${base}/ayah?reference=quran:2:255`, { headers: { Authorization: 'Bearer alice' } });
  expect(response.status).toBe(200);
  expect((await response.json()).source.source_key).toBe('item:204673');
  expect(global.query).not.toHaveBeenCalled();
  expect((await fetch(`${base}/ayah?reference=quran:2:255`)).status).toBe(401);
});
test('ayah menu rejects mismatched source records', async () => {
  Item.itemFromRef.mockResolvedValue({ ref: 'quran:2:254', id: 42 });
  expect((await fetch(`${base}/ayah?reference=quran:2:255`, { headers: { Authorization: 'Bearer alice' } })).status).toBe(404);
  expect(global.query).not.toHaveBeenCalled();
});

test('normalizes Arabic and Latin diacritics without changing saved Markdown', async () => {
  expect(Notebook.normalizeSearch('صَلَاة Café Ṣalāh')).toBe('صلاة cafe salah');
  await Notebook.save('alice', { source_key: 'general', markdown: 'صَلَاة Café #صَلَاة #Café', version: 0 });
  const sql = global.query.mock.calls.find(([sql]) => sql.startsWith('INSERT'))[0];
  expect(sql).toContain('صَلَاة Café #صَلَاة #Café');
  expect(sql).toContain('صلاة cafe #صلاة #cafe');
});
test('extracts distinct multilingual hashtags, excluding headings, code and URL fragments', () => {
  expect(Notebook.hashtags('# Heading\n\n#prayer #صَلَاة #Café #cafe #prayer_times #daily-notes `#code` https://example.org/#fragment\n\n```\n#fenced\n```')).toEqual(['prayer', 'صَلَاة', 'cafe', 'prayer_times', 'daily-notes']);
});
test('search and exact hashtag conditions run in SQL before pagination and remain owner scoped', async () => {
  const response = await fetch(`${base}?q=${encodeURIComponent('Ṣalāh 100%_')}&tag=${encodeURIComponent('#صَلَاة')}&offset=12&uid=bob`, { headers: { Authorization: 'Bearer alice' } });
  expect(response.status).toBe(200);
  const sql = global.query.mock.calls.at(-1)[0];
  expect(sql).toContain("user_uid='alice' AND LOCATE('salah 100%_', search_text)>0 AND LOCATE('\\nصلاة\\n', search_tags)>0");
  expect(sql).toContain('LIMIT 13 OFFSET 12');
});
test.each(['tag=a%25', 'q[x]=bad', 'tag=a%20b'])('rejects malformed notebook filters: %s', async query => {
  const response = await fetch(`${base}?${query}`, { headers: { Authorization: 'Bearer alice' } });
  expect(response.status).toBe(400);
  expect(global.query).not.toHaveBeenCalled();
});

test('accepts space-delimited tags and normalizes duplicate identities', () => {
  expect(Notebook.parseTags('prayer #صَلَاة Café cafe')).toEqual(['prayer', 'صَلَاة', 'cafe']);
  expect(() => Notebook.parseTags('bad,tag')).toThrow();
});
test('separate tags are stored and included in exact hashtag search metadata', async () => {
  await Notebook.save('alice', { source_key: 'general', markdown: 'My note #inline', tags: 'prayer #صَلَاة', version: 0 });
  const sql = global.query.mock.calls.find(([sql]) => sql.startsWith('INSERT'))[0];
  expect(sql).toContain('[\\"prayer\\",\\"صَلَاة\\"]');
  expect(sql).toContain('\\ninline\\nprayer\\nصلاة\\n');
});
test('tag rail aggregates all owned notes independently of pagination', async () => {
  global.query.mockResolvedValue([{ search_tags: '\nprayer\nصلاة\n' }, { search_tags: '\nprayer\n' }]);
  const response = await fetch(`${base}/tags?uid=bob`, { headers: { Authorization: 'Bearer alice' } });
  expect(response.status).toBe(200);
  expect((await response.json()).tags).toEqual(expect.arrayContaining([{ tag: 'prayer', count: 2 }, { tag: 'صلاة', count: 1 }]));
  expect(global.query.mock.calls.at(-1)[0]).toBe("SELECT search_tags FROM user_notebook WHERE user_uid='alice'");
  expect((await fetch(`${base}/tags`)).status).toBe(401);
});

test('Markdown exports include Obsidian tags and canonical references without changing the body', () => {
  const body = '# Test Note\n\nExact **text**. #inline';
  const exported = Notebook.exportMarkdown({ source_key: 'item:42', source_url: '/bukhari:100?x=1', markdown: body, tags: 'action angels attributes inline true 123 صلاة' });
  const parsed = require('front-matter')(exported);
  expect(parsed.attributes).toEqual({ tags: ['inline', 'action', 'angels', 'attributes', 'true', '123', 'صلاة'], reference: 'bukhari:100' });
  expect(parsed.body).toBe(body);
  expect(exported).toContain('reference: bukhari:100\n---');
});
test('general export reference is general and empty tags remain a YAML list', () => {
  const exported = Notebook.exportMarkdown({ source_key: 'general', source_url: '/notebook', markdown: 'My thoughts', tags: [] });
  expect(require('front-matter')(exported).attributes).toEqual({ tags: [], reference: 'general' });
});
test('individual export includes current draft tags and text and requires authentication', async () => {
  const draft = { source_key: 'item:42', source_url: '/quran:2:255', markdown: 'Unsaved draft', tags: 'reflection صلاة' };
  const response = await fetch(`${base}/download`, { method: 'POST', headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
  expect(response.status).toBe(200);
  const parsed = require('front-matter')((await response.json()).markdown);
  expect(parsed.attributes).toEqual({ tags: ['reflection', 'صلاة'], reference: 'quran:2:255' });
  expect(parsed.body).toBe('Unsaved draft');
  expect(global.query).not.toHaveBeenCalled();
  expect((await fetch(`${base}/download`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })).status).toBe(401);
});

test('ZIP frontmatter includes stored and inline tags with canonical references', async () => {
  global.query.mockResolvedValue([{ source_key: 'item:1', source_title: 'Ayah', source_url: '/quran/quran:2:255', tags: '["reflection","صلاة"]', markdown: 'Text #faith' }]);
  const zip = new (require('adm-zip'))(await Notebook.exportZip('alice'));
  expect(require('front-matter')(zip.getEntries()[0].getData().toString('utf8')).attributes).toEqual({ tags: ['faith', 'reflection', 'صلاة'], reference: 'quran:2:255' });
});

test('optional title is independently stored and searchable while source identity stays intact', async () => {
  await Notebook.save('alice', { source_key: 'general', title: 'Ṣalāh reflection', markdown: 'My note', tags: [], version: 0 });
  const sql = global.query.mock.calls.find(([sql]) => sql.startsWith('INSERT'))[0];
  expect(sql).toContain("'General note', '/notebook'");
  expect(sql).toContain('Ṣalāh reflection');
  expect(sql).toContain('salah reflection');
  expect(sql).toContain('created_at');
  expect(sql).toContain('CURRENT_TIMESTAMP(3)');
});
test('editing a title updates modification time without changing creation time', async () => {
  global.query.mockImplementation(async sql => sql.startsWith('UPDATE') ? { affectedRows: 1 } : []);
  await Notebook.save('alice', { source_key: 'general', title: 'New title', markdown: 'Note', tags: [], version: 1 });
  const sql = global.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE'))[0];
  expect(sql).toContain('title=\'New title\'');
  expect(sql).toContain('updated_at=CURRENT_TIMESTAMP(3)');
  expect(sql).not.toContain('created_at');
});
test('title-only notes save, oversized titles fail, and exported titles are YAML safe', async () => {
  await expect(Notebook.save('alice', { source_key: 'general', title: 'Title only', markdown: '', version: 0 })).resolves.toBeNull();
  await expect(Notebook.save('alice', { source_key: 'general', title: 'a'.repeat(501), markdown: 'Note', version: 0 })).rejects.toMatchObject({ status: 400 });
  const exported = Notebook.exportMarkdown({ source_key: 'general', title: 'Thoughts: "today"', markdown: 'Note', tags: [] });
  expect(require('front-matter')(exported).attributes.title).toBe('Thoughts: "today"');
});

test('all note links open safely in a new tab, including wiki links and references', () => {
  const html = Notebook.render('[External](https://example.com) [Hadith](/bukhari:100) bukhari:100 [[Another note|Alias]]');
  const links = [...html.matchAll(/<a\b[^>]*>/g)].map(match => match[0]);
  expect(links).toHaveLength(4);
  for (const link of links) {
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
  }
});

test('notes render footnotes with local references and return links', () => {
  const html = Notebook.render('A statement[^source], cited twice[^source].\n\n[^source]: Supporting **detail** and العربية.');
  expect(html).toContain('href="#fn-notebook-1"');
  expect(html).toContain('id="fn-notebook-1"');
  expect(html).toContain('href="#fnref-notebook-1"');
  expect(html).toContain('href="#fnref-notebook-1:1"');
  expect(html).toContain('<strong>detail</strong>');
  expect(html).toContain('notebook-arabic');
  expect(html).not.toContain('target="_blank"');
});
test('inline footnotes support note links while code stays literal', () => {
  const html = Notebook.render('Text^[See [[Another note]] and [source](https://example.com).] `[^literal]`');
  expect(html).toContain('class="footnotes"');
  expect(html).toContain('data-notebook-wiki="Another note"');
  expect(html).toContain('target="_blank"');
  expect(html).toContain('<code>[^literal]</code>');
});

test.each([['١٢', '12'], ['۱۲', '12']])('preserves %s in references and uses English digits in the footnote list', (label, number) => {
  const html = Notebook.render(`نص[^${label}] ومرة أخرى[^${label}].\n\n[^${label}]: الشرح.`);
  expect((html.match(new RegExp(`\\[${label}\\]`, 'g')) || [])).toHaveLength(2);
  expect(html).toContain(`<li value="${number}" id="fn-notebook-1"`);
  expect(html).toContain('href="#fnref-notebook-1:1"');
  expect(html).not.toContain(`[${number}]`);
});
test('mixed footnote numeral styles retain correct individual list numbers', () => {
  const html = Notebook.render('First[^٣] then second[^named].\n\n[^٣]: First detail.\n[^named]: Second detail.');
  expect(html).toContain('>[٣]</a>');
  expect(html).toContain('>[2]</a>');
  expect(html).toContain('<li value="3" id="fn-notebook-1"');
  expect(html).toContain('<li value="2" id="fn-notebook-2"');
});

test('Quran ayah ranges receive one link and expansion control each', () => {
  const html = Notebook.render('quran:11:15-16\nquran:17:18-20');
  expect(html).toContain('href="/quran:11:15-16"');
  expect(html).toContain('data-notebook-reference="quran:17:18-20"');
  expect((html.match(/data-notebook-reference=/g) || [])).toHaveLength(2);
  expect(Notebook.render('[passage](/quran:11:15-16) `quran:11:15-16`')).not.toContain('data-notebook-reference=');
});
test('range expansion fetches every exact ayah in order and replaces the reference in place', async () => {
  Item.itemFromRef.mockImplementation(async ref => ({ ref, ar: { body: 'النص' }, en: { body: `Translation ${ref}` } }));
  const result = await Notebook.expandedDraft({ markdown: 'Before\n\nquran:17:18-20\n\nAfter\n\nbukhari:100', reference: 'quran:17:18-20' });
  expect(Item.itemFromRef.mock.calls.map(([ref]) => ref)).toEqual(['quran:17:18', 'quran:17:19', 'quran:17:20']);
  expect(result.markdown.indexOf('Before')).toBeLessThan(result.markdown.indexOf('Translation quran:17:18'));
  expect(result.markdown.indexOf('Translation quran:17:18')).toBeLessThan(result.markdown.indexOf('Translation quran:17:19'));
  expect(result.markdown.indexOf('Translation quran:17:20')).toBeLessThan(result.markdown.indexOf('After'));
  expect(result.markdown).toMatch(/After\n\nbukhari:100$/);
  expect(Notebook.render(result.markdown)).not.toContain('data-notebook-reference="quran:17:18-20"');
});
test('single references expand at their position without modifying code, links or surrounding prose', async () => {
  Item.itemFromRef.mockResolvedValue({ ref: 'bukhari:100', en: { body: 'Expanded text' } });
  const result = await Notebook.expandedDraft({ markdown: 'Before bukhari:100 after.\n\n`bukhari:100` [source](/bukhari:100)\n\n```\nbukhari:100\n```', reference: 'bukhari:100' });
  expect(result.markdown).toContain('Before \n\n> النص العربي غير متوفر ([bukhari ١٠٠](/bukhari:100))');
  expect(result.markdown).toContain('*Expanded text*\n\n after.');
  expect(result.markdown).toContain('`bukhari:100` [source](/bukhari:100)\n\n```\nbukhari:100\n```');
});
test.each(['quran:11:16-15', 'quran:0:1-2', 'quran:115:1-2', 'quran:11:1-999'])('invalid range %s fails before a lookup', async ref => {
  await expect(References.snapshot(ref)).rejects.toMatchObject({ status: 400 });
  expect(Item.itemFromRef).not.toHaveBeenCalled();
});
test('a missing ayah aborts range expansion without saving a partial quotation', async () => {
  Item.itemFromRef.mockImplementation(async ref => ref === 'quran:11:15' ? { ref, en: { body: 'Text' } } : null);
  await expect(Notebook.expand('alice', { markdown: 'quran:11:15-16', reference: 'quran:11:15-16' })).rejects.toMatchObject({ status: 404 });
  expect(global.query).not.toHaveBeenCalled();
});

test.each(['quran:1:1', 'quran:1:1-2'])('Quran quotation %s uses one decorative pair and a trailing Arabic citation', async ref => {
  Item.itemFromRef.mockImplementation(async reference => ({ ref: reference, ar: { h1_title: 'الفاتحة', body: reference.endsWith(':1') ? 'بسم الله' : 'الحمد لله' }, en: { body: reference.endsWith(':1') ? 'In the name of Allah.' : 'Praise be to Allah.' } }));
  const result = await References.snapshot(ref);
  expect(result.match(/﴿/g)).toHaveLength(1);
  expect(result.match(/﴾/g)).toHaveLength(1);
  expect(result).toContain('﴿ بسم الله ۝١');
  if (ref.endsWith('-2')) {
    expect(result).toContain('۝١ الحمد لله ۝٢ ﴾ ([الفاتحة ١:١-٢](/quran:1:1-2))');
    expect(result).toContain('> 1:1 In the name of Allah. 2 Praise be to Allah.');
  } else {
    expect(result).toContain('۝١ ﴾ ([الفاتحة ١:١](/quran:1:1))');
    expect(result).toContain('> In the name of Allah.');
  }
  expect(Notebook.render(result)).not.toContain('data-notebook-reference=');
  expect(result).not.toContain('Expanded reference');
});
test('hadith expansion has a title, trailing Arabic source and grade, and English below', async () => {
  Item.itemFromRef.mockResolvedValue({ ref: 'bukhari:1', en: { title: 'Deeds depend on intentions', chain: 'Umar reported:', body: 'Deeds depend on intentions.' }, ar: { body: '«إنما الأعمال بالنيات»', book_shortName: 'البخاري', grade_grade: 'متفق عليه' } });
  const result = await References.snapshot('bukhari:1');
  expect(result).toBe('**Hadith: Deeds depend on intentions**\n\n> «إنما الأعمال بالنيات» ([البخاري ١](/bukhari:1) متفق عليه)\n> \n> Umar reported: *Deeds depend on intentions.*');
});

test.each(['quran:1:1', 'quran:1:1-2'])('Quran expansion %s uses ordinary script from the current database record', async ref => {
  Item.itemFromRef.mockImplementation(async reference => ({ ref: reference, id: Number(reference.split(':')[2]), book_id: 0, ar: { body: 'Cached Uthmani', body_alt: 'Cached ordinary' } }));
  global.query.mockResolvedValue([{ body: 'ٱلْحَمْدُ لِلَّهِ', body_ar_alt: 'الْحَمْدُ لِلَّهِ', body_en: 'Praise be to Allah.' }]);
  const result = await References.snapshot(ref);
  expect(result).toContain('الْحَمْدُ لِلَّهِ');
  expect(result).not.toContain('ٱلْحَمْدُ');
  expect(result).not.toContain('Cached');
  expect(result.match(/الْحَمْدُ/g)).toHaveLength(ref.endsWith('-2') ? 2 : 1);
  expect(result).toContain('﴿');
  expect(result).toContain('﴾');
});

test.each(['quran:17:18', 'quran:17:18-20'])('plain %s remains expandable when another citation uses the same reference', async ref => {
  const citation = `> ﴿ النص ﴾ ([الإسراء](/${ref}))`;
  const markdown = `${citation}\n\n${ref}`;
  expect(Notebook.render(markdown)).toContain(`data-notebook-reference="${ref}"`);
  Item.itemFromRef.mockImplementation(async reference => ({ ref: reference, ar: { body: 'النص' }, en: { body: 'Translation' } }));
  const result = await Notebook.expandedDraft({ markdown, reference: ref });
  expect(result.markdown).toContain(citation);
  expect(result.markdown).toContain('Translation');
  expect(Notebook.render(result.markdown)).not.toContain('data-notebook-reference=');
});
test('a citation alone is not an expandable plain reference', async () => {
  await expect(Notebook.expandedDraft({ markdown: '> النص ([source](/quran:17:18))', reference: 'quran:17:18' })).rejects.toMatchObject({ status: 400 });
  expect(Item.itemFromRef).not.toHaveBeenCalled();
});
