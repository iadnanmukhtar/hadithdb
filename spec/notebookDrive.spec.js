'use strict';
jest.mock('../lib/Model', () => ({ Item: { itemFromRef: jest.fn() } }));
jest.mock('../lib/GoogleAuth', () => ({ verifyRequest: jest.fn(async req => req.headers.authorization === 'Bearer alice' ? { uid: 'alice', provider: 'google.com' } : null) }));
jest.mock('google-auth-library', () => ({ OAuth2Client: jest.fn() }));
const { OAuth2Client } = require('google-auth-library');
const Drive = require('../lib/NotebookDrive');
const Legacy = require('../lib/UserNotebook');
const express = require('express');
const http = require('http');
let connection, mappings, files, originals, nextId, request, server, base, sqlCalls;
const note = (overrides = {}) => ({ source_key: 'item:42', source_title: 'bukhari:100', source_url: '/bukhari:100', title: 'Reflection', tags: ['صلاة'], markdown: '\n\nالعربية\n\nEnglish #prayer\n', ...overrides });
function db(statement, values) {
  sqlCalls.push({ statement, values });
  if (statement.startsWith('CREATE')) return {};
  if (statement.startsWith('SELECT GET_LOCK')) return [{ acquired: 1 }];
  if (statement.startsWith('SELECT RELEASE_LOCK')) return [{ released: 1 }];
  if (statement.startsWith('SELECT * FROM user_notebook_drive')) return connection && values[0] === 'alice' ? [connection] : [];
  if (statement.startsWith('INSERT INTO user_notebook_drive (')) { connection = { ...connection, user_uid: values[0], google_sub: values[1], token_cipher: values[2] }; return {}; }
  if (statement.startsWith('UPDATE user_notebook_drive SET folder_id')) { connection.folder_id = values[0]; return {}; }
  if (statement.startsWith('UPDATE user_notebook_drive SET migrated')) { connection.migrated = 1; return {}; }
  if (statement.startsWith('UPDATE user_notebook_drive SET token_cipher')) { connection.token_cipher = null; return {}; }
  if (statement.startsWith('SELECT file_id')) return mappings.has(values[1]) && values[0] === 'alice' ? [{ file_id: mappings.get(values[1]) }] : [];
  if (statement.startsWith('SELECT source_key,file_id')) return [...mappings].map(([source_key, file_id]) => ({ source_key, file_id }));
  if (statement.startsWith('INSERT INTO user_notebook_drive_files')) { mappings.set(values[1], values[2]); return {}; }
  if (statement.startsWith('UPDATE user_notebook_drive_files')) { mappings.set(values[2], values[0]); return {}; }
  if (statement.startsWith('SELECT * FROM user_notebook WHERE')) return originals;
  throw Error('Unhandled SQL: ' + statement);
}
function fail(status, error) { throw { response: { status, data: { error } } }; }
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use('/api/notebook', require('../routes/notebook'));
  server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/notebook`;
});
afterAll(() => new Promise(resolve => server.close(resolve)));
beforeEach(() => {
  OAuth2Client.mockClear();
  global.settings = { site: { url: 'https://hadithunlocked.com' }, google: { clientId: 'client', clientSecret: 'secret', driveTokenKey: Buffer.alloc(32, 7).toString('base64') } };
  global.books = [{ alias: 'bukhari' }];
  mappings = new Map(); files = new Map(); originals = []; nextId = 0; sqlCalls = [];
  connection = { user_uid: 'alice', google_sub: 'alice', folder_id: 'folder', migrated: 1, token_cipher: Drive.encrypt('alice', { refresh_token: 'refresh', access_token: 'access' }) };
  files.set('folder', { id: 'folder', mimeType: 'application/vnd.google-apps.folder', trashed: false });
  const query = (statement, values, cb) => { try { cb(null, db(statement, values)); } catch (err) { cb(err); } };
  global.dbPool = { query, getConnection: cb => cb(null, { query, release() {}, destroy() {} }) };
  request = jest.fn(async options => {
    const path = options.url.replace('https://www.googleapis.com/', '');
    if (path.endsWith('files/generateIds')) return { data: { ids: ['new' + ++nextId] } };
    if (path.startsWith('upload/')) {
      const boundary = options.headers['Content-Type'].split('boundary=')[1];
      const parts = options.data.split('--' + boundary);
      const metadata = JSON.parse(parts[1].split('\r\n\r\n')[1].replace(/\r\n$/, ''));
      const body = parts[2].slice(parts[2].indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '');
      const id = metadata.id || path.split('/').at(-1), old = files.get(id);
      if (options.method === 'POST' && old) fail(409);
      if (options.method === 'PUT' && options.headers['If-Match'] !== '"' + old.version + '"') fail(412);
      files.set(id, { ...old, ...metadata, id, body, version: String(Number(old?.version || 0) + 1), modifiedTime: new Date().toISOString(), createdTime: new Date().toISOString(), size: Buffer.byteLength(body) });
      const saved = files.get(id);
      return { data: { id, version: saved.version, modifiedDate: saved.modifiedTime, createdDate: saved.createdTime } };
    }
    if (path === 'drive/v3/files' && options.method === 'POST') { files.set(options.data.id, { ...options.data }); return { data: options.data }; }
    const id = path.split('/').at(-1), file = files.get(id);
    if (!file) fail(404);
    if (options.method === 'PATCH') {
      if (options.headers['If-Match'] !== '"' + file.version + '"') fail(412);
      Object.assign(file, { trashed: options.data.labels.trashed }); return { data: file };
    }
    return { data: options.params?.alt === 'media' ? file.body : { ...file, ...(path.startsWith('drive/v2/') ? { etag: '"' + file.version + '"' } : {}) }, headers: {} };
  });
  OAuth2Client.mockImplementation(() => ({ setCredentials: jest.fn(), request, getToken: async () => ({ tokens: { id_token: 'id', refresh_token: 'refresh', scope: Drive.SCOPE } }), verifyIdToken: async () => ({ getPayload: () => ({ sub: 'alice' }) }) }));
  jest.spyOn(Legacy, 'ensureTable').mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());
test('encrypted credentials are bound to their owner and cannot be tampered with', () => {
  const cipher = Drive.encrypt('alice', { refresh_token: 'private-token' });
  expect(cipher).not.toContain('private-token');
  expect(Drive.decrypt('alice', cipher).refresh_token).toBe('private-token');
  expect(() => Drive.decrypt('bob', cipher)).toThrow();
  const bytes = Buffer.from(cipher, 'base64'); bytes[30] ^= 1;
  expect(() => Drive.decrypt('alice', bytes.toString('base64'))).toThrow();
});
test('Markdown, leading whitespace, Arabic and metadata round-trip exactly', () => {
  expect(Drive.decode(Drive.encode(note()), 'item:42')).toMatchObject(note());
  expect(() => Drive.decode(Drive.encode(note()), 'item:43')).toThrow('identity');
  expect(() => Drive.decode(Drive.encode(note({ source_url: 'https://evil.example' })), 'item:42')).toThrow('URL');
});
test('CRUD uses Drive, preserves owner mapping, and rejects stale edits and deletions', async () => {
  const saved = await Drive.save('alice', { ...note(), version: 0 });
  expect(saved.version).toBe('1'); expect(saved.markdown).toBe(note().markdown);
  expect(saved).not.toHaveProperty('_etag');
  expect(saved.driveFileUrl).toBe('https://drive.google.com/file/d/' + mappings.get('item:42') + '/view');
  expect([...files.values()].find(f => f.mimeType === 'text/markdown').parents).toEqual(['folder']);
  expect(sqlCalls.some(c => /INSERT INTO user_notebook \(/.test(c.statement))).toBe(false);
  const updated = await Drive.save('alice', { ...saved, markdown: 'Updated' });
  expect(updated.version).toBe('2');
  await expect(Drive.save('alice', saved)).rejects.toMatchObject({ status: 409 });
  await expect(Drive.remove('alice', saved.source_key, saved.version)).rejects.toMatchObject({ status: 409 });
  await Drive.remove('alice', updated.source_key, updated.version);
  expect(await Drive.get('alice', updated.source_key)).toBeNull();
  await expect(Drive.get('bob', updated.source_key)).rejects.toMatchObject({ code: 'DRIVE_CONNECT' });
});
test('concurrent external update is protected by conditional upload', async () => {
  const saved = await Drive.save('alice', { ...note(), version: 0 });
  const real = request.getMockImplementation();
  request.mockImplementation(async options => {
    if (options.method === 'PUT' && options.url.includes('/upload/')) {
      const file = files.get(mappings.get('item:42')); file.version = '999';
      file.body = Drive.encode(note({ markdown: 'External edit العربية' }));
    }
    return real(options);
  });
  await expect(Drive.save('alice', { ...saved, markdown: 'stale' })).rejects.toMatchObject({ status: 409 });
  expect(files.get(mappings.get('item:42')).body).toContain('العربية');
});
test('a changing Drive revision retries the entire read and persistent changes fail closed', async () => {
  await Drive.save('alice', { ...note(), version: 0 });
  const real = request.getMockImplementation(); let changes = 1;
  request.mockImplementation(async options => {
    if (options.url.includes('/drive/v2/') && changes-- > 0) {
      const file = files.get(mappings.get('item:42'));
      file.version = String(Number(file.version) + 1);
      file.body = Drive.encode(note({ markdown: 'External edit' }));
    }
    return real(options);
  });
  expect((await Drive.get('alice', 'item:42')).markdown).toBe('External edit');
  changes = 100;
  await expect(Drive.get('alice', 'item:42')).rejects.toMatchObject({ status: 503 });
});
test('missing v2 ETags block update and trash without mutating content', async () => {
  const saved = await Drive.save('alice', { ...note(), version: 0 });
  const real = request.getMockImplementation();
  request.mockImplementation(async options => {
    const response = await real(options);
    if (options.url.includes('/drive/v2/')) delete response.data.etag;
    return response;
  });
  await expect(Drive.save('alice', { ...saved, markdown: 'Blocked' })).rejects.toMatchObject({ status: 503 });
  await expect(Drive.remove('alice', saved.source_key, saved.version)).rejects.toMatchObject({ status: 503 });
  expect(files.get(mappings.get('item:42')).body).toContain('العربية');
});
test('migration retries reuse files, verify originals, and never delete database notes', async () => {
  connection.migrated = 0;
  originals = [{ ...note(), tags: JSON.stringify(note().tags), created_at: new Date('2026-01-01'), version: 3 }];
  const real = request.getMockImplementation(); let interrupt = true;
  request.mockImplementation(async options => {
    const result = await real(options);
    if (interrupt && options.url.includes('/upload/')) { interrupt = false; throw Error('lost response'); }
    return result;
  });
  await expect(Drive.migrate('alice')).rejects.toMatchObject({ status: 503 });
  expect(connection.migrated).toBe(0);
  expect(await Drive.migrate('alice')).toEqual({ done: true, remaining: 0 });
  expect([...files.values()].filter(f => f.mimeType === 'text/markdown')).toHaveLength(1);
  expect(sqlCalls.some(c => /DELETE|UPDATE user_notebook SET/.test(c.statement))).toBe(false);
  expect((await Drive.get('alice', 'item:42')).created_at).toBe('2026-01-01T00:00:00.000Z');
});
test('migration stops on differing remote content without overwriting it', async () => {
  await Drive.save('alice', { ...note(), version: 0 });
  connection.migrated = 0; originals = [{ ...note({ markdown: 'different' }), tags: '[]' }];
  await expect(Drive.migrate('alice')).rejects.toMatchObject({ status: 409 });
  expect(connection.migrated).toBe(0);
});
test('list, tags and ZIP use the Drive note content and preserve filtering', async () => {
  await Drive.save('alice', { ...note(), version: 0 });
  await Drive.save('alice', { ...note({ source_key: 'general', title: 'General reflection', markdown: 'General' }), version: 0 });
  expect((await Drive.list('alice')).notes[0].source_key).toBe('general');
  expect((await Drive.list('alice', 0, 'english', '#prayer')).notes).toHaveLength(1);
  expect(await Drive.tagList('alice')).toEqual(expect.arrayContaining([{ tag: 'prayer', count: 1 }]));
  const zip = new (require('adm-zip'))(await Drive.exportZip('alice'));
  expect(zip.getEntries()).toHaveLength(2);
  expect(zip.getEntries().some(entry => entry.getData().toString().includes('العربية'))).toBe(true);
});
test('revoked access requires reconnect and never falls back to database storage', async () => {
  request.mockRejectedValue({ response: { status: 400, data: { error: 'invalid_grant' } } });
  await expect(Drive.list('alice')).rejects.toMatchObject({ code: 'DRIVE_CONNECT' });
  expect(connection.token_cipher).toBeNull();
});
test('OAuth refuses a different Google identity and does not replace existing credentials', async () => {
  const old = connection.token_cipher;
  await expect(Drive.connect({ uid: 'bob', provider: 'google.com' }, 'code', 'https://hadithunlocked.com')).rejects.toMatchObject({ status: 403 });
  expect(connection.token_cipher).toBe(old);
});
test('production router requires auth and rejects untrusted OAuth origins', async () => {
  expect((await fetch(base)).status).toBe(401);
  const response = await fetch(base + '/drive/connect', { method: 'POST', headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json', Origin: 'https://evil.example', 'X-Requested-With': 'XmlHttpRequest' }, body: '{"code":"secret"}' });
  expect(response.status).toBe(403);
  expect(OAuth2Client).not.toHaveBeenCalled();
});
test('production router ignores supplied ownership and reports connection state', async () => {
  await Drive.save('alice', { ...note(), version: 0 });
  const response = await fetch(base + '?source=item:42&uid=bob', { headers: { Authorization: 'Bearer alice' } });
  expect(response.status).toBe(200); expect((await response.json()).note.markdown).toBe(note().markdown);
  expect(response.headers.get('cache-control')).toContain('no-store');
  connection.token_cipher = null;
  const missing = await fetch(base, { headers: { Authorization: 'Bearer alice' } });
  expect(missing.status).toBe(428); expect((await missing.json()).code).toBe('DRIVE_CONNECT');
});

test('titles are mandatory, delimiter-safe, and unique per notebook on create and rename', async () => {
  for (const title of [null, '', '  ', 'A|B', '[Title]', 'A\nB']) {
    await expect(Drive.save('alice', { ...note({ title }), version: 0 })).rejects.toMatchObject({ status: 400 });
  }
  const first = await Drive.save('alice', { ...note({ title: 'My Reflection' }), version: 0 });
  await expect(Drive.save('alice', { ...note({ source_key: 'general', title: '  MY   reflection ' }), version: 0 })).rejects.toMatchObject({ status: 409 });
  const other = await Drive.save('alice', { ...note({ source_key: 'general', title: 'Other' }), version: 0 });
  await expect(Drive.save('alice', { ...other, title: 'my reflection' })).rejects.toMatchObject({ status: 409 });
  expect((await Drive.save('alice', { ...first, markdown: 'Updated' })).title).toBe('My Reflection');
});
test('wiki suggestions and title resolution stay private and report missing or ambiguous targets', async () => {
  await Drive.save('alice', { ...note(), version: 0 });
  expect(await Drive.links('alice', 're')).toEqual({ notes: [{ title: 'Reflection', source_key: 'item:42' }] });
  expect((await Drive.links('alice', '', ' REFLECTION ')).note.source_key).toBe('item:42');
  await expect(Drive.links('alice', '', 'Missing')).rejects.toMatchObject({ status: 404 });
  await expect(Drive.links('bob', 're')).rejects.toMatchObject({ code: 'DRIVE_CONNECT' });
  expect((await fetch(base + '/links?q=re')).status).toBe(401);
  expect((await (await fetch(base + '/links?q=re', { headers: { Authorization: 'Bearer alice' } })).json()).notes).toHaveLength(1);
  const other = await Drive.save('alice', { ...note({ source_key: 'general', title: 'Other' }), version: 0 });
  files.get(mappings.get(other.source_key)).body = Drive.encode(note({ source_key: 'general' }));
  await expect(Drive.links('alice', '', 'Reflection')).rejects.toMatchObject({ status: 409 });
});

test('metadata-only version changes between autosaves do not cause false conflicts', async () => {
  const first = await Drive.save('alice', { ...note(), version: 0 });
  const file = files.get(mappings.get('item:42'));
  file.version = '10';
  const next = await Drive.save('alice', { ...first, markdown: 'My next edit' });
  expect(next.markdown).toBe('My next edit');
  expect(next.revision).not.toBe(first.revision);
  await expect(Drive.save('alice', { ...first, markdown: 'A genuinely stale edit' })).rejects.toMatchObject({ status: 409 });
});
test('metadata-only ETag races retry conditionally without overriding content changes', async () => {
  const first = await Drive.save('alice', { ...note(), version: 0 });
  const real = request.getMockImplementation(); let bump = true;
  request.mockImplementation(async options => {
    if (bump && options.method === 'PUT') { files.get(mappings.get('item:42')).version = '10'; bump = false; }
    return real(options);
  });
  const next = await Drive.save('alice', { ...first, markdown: 'Next edit' });
  expect(next.markdown).toBe('Next edit');
  const uploads = request.mock.calls.map(([o]) => o).filter(o => o.method === 'PUT');
  expect(uploads).toHaveLength(2);
  expect(uploads[0].headers['If-Match']).not.toBe(uploads[1].headers['If-Match']);
});
test('a lost save response can be retried without another upload or a false conflict', async () => {
  const first = await Drive.save('alice', { ...note(), version: 0 });
  const real = request.getMockImplementation(); let lose = true;
  request.mockImplementation(async options => {
    const response = await real(options);
    if (lose && options.method === 'PUT') { lose = false; throw Error('Lost response'); }
    return response;
  });
  const body = { ...first, markdown: 'Already saved' };
  await expect(Drive.save('alice', body)).rejects.toMatchObject({ status: 503 });
  const result = await Drive.save('alice', body);
  expect(result.markdown).toBe('Already saved');
  expect(request.mock.calls.map(([o]) => o).filter(o => o.method === 'PUT')).toHaveLength(1);
});
test('delete tolerates metadata drift but still rejects changed content', async () => {
  const first = await Drive.save('alice', { ...note(), version: 0 });
  files.get(mappings.get('item:42')).version = '10';
  const real = request.getMockImplementation(); let bump = true;
  request.mockImplementation(async options => {
    if (bump && options.method === 'PATCH') { files.get(mappings.get('item:42')).version = '11'; bump = false; }
    return real(options);
  });
  await Drive.remove('alice', first.source_key, first.version, first.revision);
  expect(await Drive.get('alice', first.source_key)).toBeNull();
  const next = await Drive.save('alice', { ...note(), version: 0 });
  await Drive.save('alice', { ...next, markdown: 'New content' });
  await expect(Drive.remove('alice', next.source_key, next.version, next.revision)).rejects.toMatchObject({ status: 409 });
});

test('frontmatter stores a fresh checksum and reads use it for revision comparisons', () => {
  const original = note();
  const encoded = Drive.encode(original);
  const parsed = require('front-matter')(encoded);
  const checksum = parsed.attributes.hadithunlocked.cksum;
  expect(checksum).toMatch(/^[a-f0-9]{64}$/);
  expect(Drive.decode(encoded, original.source_key).revision).toBe(checksum);
  // Frontmatter is the revision authority; external writers must maintain it.
  expect(Drive.decode(encoded.replace('English', 'External'), original.source_key).revision).toBe(checksum);
  const changed = Drive.encode({ ...original, cksum: checksum, markdown: 'New content' });
  expect(Drive.decode(changed, original.source_key).revision).not.toBe(checksum);
});
test('legacy files without a checksum remain readable; malformed checksums fail clearly', () => {
  const encoded = Drive.encode(note());
  const legacy = encoded.replace(/,"cksum":"[a-f0-9]{64}"/, '');
  expect(Drive.decode(legacy, 'item:42').revision).toBe(Drive.decode(encoded, 'item:42').revision);
  const invalid = encoded.replace(/"cksum":"[a-f0-9]{64}"/, '"cksum":"invalid"');
  expect(() => Drive.decode(invalid, 'item:42')).toThrow('invalid content checksum');
});

test.each(['missing', 'legacy name'])('unchanged saves persist cksum when the field is %s', async kind => {
  const first = await Drive.save('alice', { ...note(), version: 0 });
  const file = files.get(mappings.get(first.source_key));
  file.body = kind === 'missing'
    ? file.body.replace(/,"cksum":"[a-f0-9]{64}"/, '')
    : file.body.replace('"cksum":', '"content_checksum":');
  const old = await Drive.get('alice', first.source_key);
  expect(old.needsChecksum).toBe(true);
  const saved = await Drive.save('alice', old);
  expect(saved.needsChecksum).toBe(false);
  expect(saved.markdown).toBe(old.markdown);
  const stored = files.get(mappings.get(first.source_key));
  const metadata = require('front-matter')(stored.body).attributes.hadithunlocked;
  expect(metadata.cksum).toBe(saved.revision);
  expect(metadata).not.toHaveProperty('content_checksum');
  const uploads = request.mock.calls.filter(([o]) => o.method === 'PUT').length;
  await Drive.save('alice', saved);
  expect(request.mock.calls.filter(([o]) => o.method === 'PUT')).toHaveLength(uploads);
});

test('wiki suggestions match anywhere in titles without case or diacritics', async () => {
  const title = 'Reflections on Ṣalāh and صَلَاة';
  await Drive.save('alice', { ...note({ title }), version: 0 });
  for (const query of ['LECTION', 'SALAH', 'lāh', 'صلاة', 'صَلَاة']) {
    expect((await Drive.links('alice', query)).notes).toEqual([{ title, source_key: 'item:42' }]);
  }
  expect((await Drive.links('alice', 'unrelated')).notes).toEqual([]);
});

test('successful uploads return the accepted revision without a racy readback', async () => {
  const first = await Drive.save('alice', { ...note(), version: 0 });
  const real = request.getMockImplementation(); let uploaded = false;
  request.mockImplementation(async options => {
    if (uploaded && options.url.includes('/files/')) throw Error('Readback temporarily unavailable');
    const response = await real(options);
    if (options.method === 'PUT') uploaded = true;
    return response;
  });
  const saved = await Drive.save('alice', { ...first, markdown: 'Accepted content' });
  expect(saved.markdown).toBe('Accepted content');
  expect(saved.version).toBe('2');
  expect(saved.revision).toBe(Drive.decode(files.get(mappings.get('item:42')).body, 'item:42').revision);
});
test('unchanged titles do not scan other notes during autosave', async () => {
  const first = await Drive.save('alice', { ...note(), version: 0 });
  sqlCalls.length = 0;
  await Drive.save('alice', { ...first, tags: ['mahdi'] });
  expect(sqlCalls.some(call => call.statement.startsWith('SELECT source_key,file_id'))).toBe(false);
});

test('independent general notes can be created without replacing an existing general note', async () => {
  const first = await Drive.save('alice', { ...note({ source_key: 'general', title: 'Original general note' }), version: 0 });
  const second = await Drive.save('alice', { ...note({ source_key: 'general:12345678-1234-4123-8123-123456789abc', title: 'New general note' }), version: 0 });
  expect(second.source_key).not.toBe(first.source_key);
  expect(second.source_title).toBe('General note');
  expect(second.source_url).toBe('/notebook');
  expect((await Drive.get('alice', first.source_key)).title).toBe('Original general note');
  expect((await Drive.get('alice', second.source_key)).title).toBe('New general note');
});

test('optional references round-trip, survive omitted fields, and participate in edit conflicts', async () => {
  const references = [
    {ref:'bukhari:1', label:'bukhari:1', url:'/bukhari:1'},
    {ref:'quran:2:255', label:'quran:2:255', url:'/quran:2:255'}
  ];
  const first = await Drive.save('alice', {...note(), version:0, references});
  expect((await Drive.get('alice', first.source_key)).references).toEqual(references);
  const {references: omitted, ...withoutReferences} = first;
  const second = await Drive.save('alice', {...withoutReferences, markdown:'Changed body'});
  expect(second.references).toEqual(references);
  const removed = await Drive.save('alice', {...second, references:[]});
  expect(removed.references).toEqual([]); expect(removed.revision).not.toBe(second.revision);
  await expect(Drive.save('alice', {...second, references:references.slice(0,1)})).rejects.toMatchObject({status:409});
  expect(Legacy.exportMarkdown({...note(), references})).toContain('references: [{"ref":"bukhari:1"');
  expect(Legacy.exportMarkdown(note())).not.toContain('references:');
});
test('reference validation deduplicates links and rejects unsafe destinations', () => {
  const ref = {ref:'bukhari:1', label:'bukhari:1', url:'/bukhari:1'};
  expect(Drive.validate({...note(), references:[ref,ref]}).references).toEqual([ref]);
  for (const url of ['javascript:alert(1)', '//evil.test', '/\\evil.test', 'https://evil.test']) {
    expect(() => Drive.validate({...note(), references:[{...ref,url}]})).toThrow('Invalid note reference');
  }
  expect(() => Drive.validate({...note(), references:Array(51).fill(ref)})).toThrow('50');
});
test('reference search permits a regular signed-in user but not anonymous callers', async () => {
  const search = jest.spyOn(require('../lib/NotebookAttachments'), 'search').mockResolvedValue([{ref:'bukhari:1',label:'bukhari:1',url:'/bukhari:1'}]);
  expect((await fetch(base+'/references?q=intention')).status).toBe(401);
  expect(search).not.toHaveBeenCalled();
  const response = await fetch(base+'/references?q=intention', {headers:{Authorization:'Bearer alice'}});
  expect(response.status).toBe(200);
  expect((await response.json()).references[0].ref).toBe('bukhari:1');
  expect(search).toHaveBeenCalledWith('intention');
});
