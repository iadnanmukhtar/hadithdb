'use strict';
jest.mock('../lib/Model', () => ({ Item: { itemFromRef: jest.fn() } }));
jest.mock('../lib/GoogleAuth', () => ({ verifyRequest: jest.fn(async req => req.headers.authorization === 'Bearer alice' ? { uid: 'alice', provider: 'google.com' } : null) }));
jest.mock('google-auth-library', () => ({ OAuth2Client: jest.fn() }));
jest.mock('../lib/NotebookShare', () => ({ rememberAuthor: jest.fn(async () => {}) }));
const { OAuth2Client } = require('google-auth-library');
const Drive = require('../lib/NotebookDrive');
const Legacy = require('../lib/UserNotebook');
const express = require('express');
const http = require('http');
let linkModes, attachmentIndex, connection, mappings, files, originals, nextId, request, server, base, sqlCalls, creations;
const note = (overrides = {}) => ({ source_key: 'item:42', source_title: 'bukhari:100', source_url: '/bukhari:100', title: 'Reflection', tags: ['صلاة'], markdown: '\n\nالعربية\n\nEnglish #prayer\n', ...overrides });
function db(statement, values) {
  sqlCalls.push({ statement, values });
  if (statement.startsWith('CREATE')) return {};
  if (statement.startsWith('INSERT IGNORE INTO user_notebook_link_modes')) { linkModes.add(JSON.stringify(values)); return {}; }
  if (statement.startsWith('SELECT source_key FROM user_notebook_link_modes')) return values[1].filter(source => linkModes.has(JSON.stringify([values[0], source]))).map(source_key => ({ source_key }));
  if (statement.startsWith('INSERT IGNORE INTO user_notebook_attachments')) { attachmentIndex.set(JSON.stringify(values), values); return {}; }
  if (statement.startsWith('DELETE FROM user_notebook_attachments')) {
    for (const [key, [uid, source, target]] of attachmentIndex) if (uid === values[0] && source === values[1] && !values[2]?.includes(target)) attachmentIndex.delete(key);
    return {};
  }
  if (statement.startsWith('SELECT DISTINCT source_key FROM user_notebook_attachments')) return [...new Set([...attachmentIndex.values()].filter(([uid, , target]) => uid === values[0] && values[1].includes(target)).map(([, source]) => source))].map(source_key => ({ source_key }));
  if (statement.startsWith('INSERT IGNORE INTO user_notebook_creations')) { creations.add(values[0] + ':' + values[1]); return {}; }
  if (statement.startsWith('SELECT COUNT(*) AS lifetime_created')) return [{ lifetime_created: [...creations].filter(key => key.startsWith(values[0] + ':')).length }];
  if (statement.startsWith('SELECT f.source_key')) return values[0] === 'alice' ? [...mappings].filter(([, id]) => !creations.has('alice:' + id)).map(([source_key, file_id]) => ({ source_key, file_id })) : [];
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
  require('../lib/Model').Item.itemFromRef.mockImplementation(async ref => ({ ref, id: ref.startsWith('quran:') ? 77 : 42 }));
  linkModes = new Set(); attachmentIndex = new Map(); mappings = new Map(); files = new Map(); originals = []; nextId = 0; sqlCalls = []; creations = new Set();
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
      // Drive v2 uses properties[]; a v3 appProperties object is not saved there.
      if (path.includes('/v2/')) {
        delete metadata.appProperties;
        if (metadata.properties) metadata.appProperties = Object.fromEntries(metadata.properties
          .filter(property => property.visibility === 'PRIVATE').map(property => [property.key, property.value]));
      }
      const id = metadata.id || path.split('/').at(-1), old = files.get(id);
      if (options.method === 'POST' && old) fail(409);
      if (options.method === 'PUT' && options.headers['If-Match'] !== '"' + old.version + '"') fail(412);
      files.set(id, { ...old, ...metadata, id, body, version: String(Number(old?.version || 0) + 1), modifiedTime: new Date().toISOString(), createdTime: new Date().toISOString(), size: Buffer.byteLength(body) });
      const saved = files.get(id);
      return { data: { id, version: saved.version, modifiedDate: saved.modifiedTime, createdDate: saved.createdTime } };
    }
    if (path === 'drive/v3/files' && !options.method) return { data: { files: [...files.values()].filter(file => file.parents?.includes('folder') && !file.trashed).map(file => ({ ...file })) } };
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
  jest.spyOn(Drive.Store.prototype, 'scheduleDiscovery').mockImplementation(() => Promise.resolve());
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
test('recently created and edited notes outrank the original general note, including across pages', async () => {
  await Drive.save('alice', { ...note({ source_key: 'general', title: 'Siege of the Kaabah' }), version: 0 });
  files.get(mappings.get('general')).modifiedTime = '2026-09-22T14:01:00.000Z';
  for (let i = 1; i <= 13; i++) {
    const source_key = i === 13 ? 'general:12345678-1234-4123-8123-123456789abc' : `item:${i}`;
    await Drive.save('alice', { ...note({ source_key, title: `Note ${i}` }), version: 0 });
    files.get(mappings.get(source_key)).modifiedTime = `2026-10-${String(i).padStart(2, '0')}T12:00:00.000Z`;
  }
  const first = await Drive.list('alice');
  expect(first.notes).toHaveLength(12);
  expect(first.hasMore).toBe(true);
  expect(first.notes[0].source_key).toBe('general:12345678-1234-4123-8123-123456789abc');
  expect(first.notes.some(note => note.source_key === 'general')).toBe(false);
  expect((await Drive.list('alice', 12)).notes.map(note => note.source_key)).toEqual(['item:1', 'general']);
  const saved = await Drive.get('alice', 'item:1');
  await Drive.save('alice', { ...saved, markdown: 'Edited today' });
  files.get(mappings.get('item:1')).modifiedTime = '2026-10-14T12:00:00.000Z';
  expect((await Drive.list('alice')).notes[0].source_key).toBe('item:1');
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
  for (const query of ['LECTION', 'SALAH', 'lāh', 'صلاة', 'صَلَاة', 'salah reflections', 'صلاة salah']) {
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
test('lifetime count increments once per creation and survives edits, retries, deletion and recreation', async () => {
  expect((await Drive.stats('alice')).lifetime_created).toBe(0);
  const first = await Drive.save('alice', { ...note(), version: 0 });
  expect(first.lifetime_created).toBe(1);
  const retry = await Drive.save('alice', { ...note(), version: 0 });
  expect(retry.lifetime_created).toBe(1);
  const edited = await Drive.save('alice', { ...first, markdown: 'Changed text' });
  expect(edited.lifetime_created).toBe(1);
  await Drive.remove('alice', edited.source_key, edited.version, edited.revision);
  expect((await Drive.stats('alice')).lifetime_created).toBe(1);
  const recreated = await Drive.save('alice', { ...note(), version: 0 });
  expect(recreated.lifetime_created).toBe(2);
  expect((await Drive.stats('alice')).lifetime_created).toBe(2);
  expect((await Drive.stats('bob')).lifetime_created).toBe(0);
});
test('lifetime backfill includes existing trashed notes and is idempotent', async () => {
  const first = await Drive.save('alice', { ...note(), version: 0 });
  const second = await Drive.save('alice', { ...note({ source_key: 'general', title: 'Another note' }), version: 0 });
  await Drive.remove('alice', first.source_key, first.version, first.revision);
  creations.clear(); // Simulate files created before lifetime tracking was installed.
  expect(await Drive.stats('alice')).toEqual({ lifetime_created: 2, backfill_incomplete: false });
  expect((await Drive.stats('alice')).lifetime_created).toBe(2);
  expect((await Drive.get('alice', second.source_key)).version).toBe(second.version);
  await Drive.disconnect('alice');
  expect((await Drive.stats('alice')).lifetime_created).toBe(2);
});
test('failed uploads and reserved IDs do not count as created notes', async () => {
  const normalRequest = request.getMockImplementation();
  request.mockImplementation(async options => {
    if (options.url.includes('/upload/')) fail(503);
    return normalRequest(options);
  });
  await expect(Drive.save('alice', { ...note(), version: 0 })).rejects.toMatchObject({ status: 503 });
  expect((await Drive.stats('alice')).lifetime_created).toBe(0);
  expect(creations.size).toBe(0);
});
test('stats endpoint is private and ignores a supplied account ID', async () => {
  await Drive.save('alice', { ...note(), version: 0 });
  expect((await fetch(base + '/stats')).status).toBe(401);
  const response = await fetch(base + '/stats?uid=bob', { headers: { Authorization: 'Bearer alice' } });
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect((await response.json()).lifetime_created).toBe(1);
});

test('one general note attaches to multiple items without replacing their own notes', async () => {
  const targets = [
    { source_key: 'item:42', source_title: 'bukhari:100', source_url: '/bukhari:100' },
    { source_key: 'item:77', source_title: 'quran:2:255', source_url: '/quran:2:255' }
  ];
  const original = await Drive.save('alice', { ...note(), version: 0 });
  const general = await Drive.save('alice', { ...note({ source_key: 'general', title: 'Shared reflection', attachments: targets }), version: 0 });
  expect(general.source_key).toBe('general');
  expect((await Drive.get('alice', 'general')).attachments).toEqual(targets);
  expect((await Drive.related('alice', 'item:77')).map(n => n.source_key)).toEqual(['general']);
  expect(new Set(await Drive.status('alice', ['item:42', 'item:77']))).toEqual(new Set(['item:42', 'item:77']));
  expect((await Drive.get('alice', 'item:42')).markdown).toBe(original.markdown);
  const { attachments, ...oldClient } = general;
  const edited = await Drive.save('alice', { ...oldClient, markdown: oldClient.markdown.replace('English', 'New text') });
  expect(edited.attachments).toEqual(targets);
  const detached = await Drive.save('alice', { ...edited, attachments: [targets[0]], attachment_edit: true });
  expect(detached.revision).not.toBe(edited.revision);
  await expect(Drive.save('alice', { ...edited, markdown: 'Stale' })).rejects.toMatchObject({ status: 409 });
  expect(await Drive.related('alice', 'item:77')).toEqual([]);
  expect(await Drive.status('alice', ['item:77'])).toEqual([]);
  await expect(Drive.related('bob', 'item:42')).rejects.toMatchObject({ code: 'DRIVE_CONNECT' });
  await Drive.remove('alice', detached.source_key, detached.version, detached.revision);
  expect(await Drive.related('alice', 'item:42')).toEqual([]);
  expect(await Drive.status('alice', ['item:42'])).toEqual(['item:42']);
});
test('attachments deduplicate and validate metadata and legacy checksums still read', () => {
  const source = { source_key: 'item:77', source_title: 'Quran', source_url: '/quran:2:255' };
  expect(Drive.validate(note({ attachments: [source, source] })).attachments).toEqual([source]);
  expect(() => Drive.validate(note({ attachments: [{ ...source, source_key: 'general' }] }))).toThrow();
  expect(() => Drive.validate(note({ attachments: [{ ...source, source_url: 'javascript:alert(1)' }] }))).toThrow();
  expect(() => Drive.validate(note({ attachments: Array(101).fill(source) }))).toThrow();
  expect(Drive.decode(Drive.encode(note()), 'item:42').attachments).toEqual([]);
});
test('attachment lookup resolves canonical item identity and associated endpoint requires authentication', async () => {
  const { Item } = require('../lib/Model');
  Item.itemFromRef.mockResolvedValue({ ref: 'quran:2:255', id: 77 });
  const response = await fetch(base + '/attachment?reference=quran:2:255', { headers: { Authorization: 'Bearer alice' } });
  expect(response.status).toBe(200);
  expect((await response.json()).source.source_key).toBe('item:77');
  const missing = await fetch(base + '/attachment?reference=bukhari:1', { headers: { Authorization: 'Bearer alice' } });
  expect(missing.status).toBe(404);
  expect((await fetch(base + '/associated?source=item:77')).status).toBe(401);
});

test('editing YAML attachments updates associations and removing the field detaches', async () => {
  const markdown = '---\nauthor: أحمد\ncustom:\n  reviewed: false\nattachments:\n  - bukhari:100\n  - quran:2:255\n---\n\nReflection';
  const saved = await Drive.save('alice', { ...note({ source_key: 'general', markdown }), version: 0 });
  expect(require('../lib/NotebookFrontmatter').parse(saved.markdown).body).toBe('\nReflection');
  expect(saved.attachments.map(entry => entry.source_key)).toEqual(['item:42', 'item:77']);
  expect((await Drive.related('alice', 'item:77'))[0].source_key).toBe('general');
  const edited = await Drive.save('alice', { ...saved, markdown: markdown.replace('  - quran:2:255\n', '') });
  expect(await Drive.related('alice', 'item:77')).toEqual([]);
  expect(edited.attachments).toHaveLength(1);
  const detached = await Drive.save('alice', { ...edited, markdown: require('../lib/NotebookFrontmatter').serialize({ title: edited.title, tags: edited.tags, author: 'أحمد' }, '\nReflection') });
  expect(detached.attachments).toEqual([]);
  expect(await Drive.status('alice', ['item:42', 'item:77'])).toEqual([]);
  expect(detached.markdown).toContain('author: أحمد');
});
test('attachment buttons write portable YAML and keep custom fields and body', async () => {
  const saved = await Drive.save('alice', { ...note({ source_key: 'general', markdown: '---\nproject: Research\npriority: 2\n---\n\nReflection' }), version: 0 });
  const attached = await Drive.save('alice', { ...saved, attachment_edit: true, attachments: [{ source_key: 'item:77', source_title: 'quran:2:255', source_url: '/quran:2:255' }] });
  const frontmatter = require('../lib/NotebookFrontmatter').parse(attached.markdown);
  expect(frontmatter.attributes).toEqual({ project: 'Research', priority: 2, title: 'Reflection', tags: ['صلاة'], links: ['quran:2:255'] });
  expect(frontmatter.body).toBe('\nReflection');
  expect((await Drive.get('alice', 'general')).markdown).toBe(attached.markdown);
});
test('invalid YAML or unresolved references never overwrite a saved note', async () => {
  const saved = await Drive.save('alice', { ...note(), version: 0 });
  for (const markdown of ['---\nbroken: [\n---\nBody', '---\nattachments: wrong\n---\nBody'])
    await expect(Drive.save('alice', { ...saved, markdown })).rejects.toMatchObject({ status: 400 });
  require('../lib/Model').Item.itemFromRef.mockResolvedValue(null);
  await expect(Drive.save('alice', { ...saved, markdown: '---\nattachments: [bukhari:999999]\n---\nBody' })).rejects.toMatchObject({ status: 400 });
  expect((await Drive.get('alice', saved.source_key)).markdown).toBe(saved.markdown);
});

test('single-note and ZIP downloads use the same merged frontmatter', async () => {
  const saved = await Drive.save('alice', { ...note({ source_key: 'general', markdown: '---\nauthor: أحمد\ntags: [custom]\nattachments: [quran:2:255]\n---\n\nReflection' }), version: 0 });
  const response = await fetch(base + '/download', { method: 'POST', headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' }, body: JSON.stringify(saved) });
  expect(response.status).toBe(200);
  const single = (await response.json()).markdown;
  const zip = new (require('adm-zip'))(await Drive.exportZip('alice'));
  expect(zip.getEntries()[0].getData().toString('utf8')).toBe(single);
  const parsed = require('../lib/NotebookFrontmatter').parse(single);
  expect(parsed.attributes).toMatchObject({ title: 'Reflection', author: 'أحمد', tags: ['custom'], links: ['quran:2:255'] });
  expect(parsed.body).toBe('\nReflection');
  expect(single.match(/^---$/gm)).toHaveLength(2);
});

test('editable metadata synchronizes between frontmatter and controls in both directions', async () => {
  const fm = require('../lib/NotebookFrontmatter');
  const saved = await Drive.save('alice', { ...note({ source_key: 'general', markdown: '---\nauthor: أحمد\n---\nBody' }), version: 0 });
  expect(fm.parse(saved.markdown).attributes).toEqual({ author: 'أحمد', title: 'Reflection', tags: ['صلاة'], links: [] });
  const controls = await Drive.save('alice', { ...saved, title: 'Edited control', tags: ['changed'] });
  expect(fm.parse(controls.markdown).attributes).toMatchObject({ title: 'Edited control', tags: ['changed'], author: 'أحمد' });
  const yaml = await Drive.save('alice', { ...controls, markdown: fm.serialize({ ...fm.parse(controls.markdown).attributes, title: 'Edited YAML', tags: ['frontmatter'] }, 'Body') });
  expect(yaml.title).toBe('Edited YAML'); expect(yaml.tags).toEqual(['frontmatter']);
  expect((await Drive.get('alice', 'general')).title).toBe('Edited YAML');
});
test.each(['version', 'revision', 'source_key', 'source_url', 'created_at', 'cksum', 'reference'])('system frontmatter field %s cannot be changed by saving', async field => {
  const saved = await Drive.save('alice', { ...note(), version: 0 });
  await expect(Drive.save('alice', { ...saved, markdown: `---\n${field}: changed\n---\nBody` })).rejects.toMatchObject({ status: 400 });
  expect((await Drive.get('alice', saved.source_key)).revision).toBe(saved.revision);
});

test('original and later items share one editable links list and detached identity stays accessible', async () => {
  const fm = require('../lib/NotebookFrontmatter');
  const saved = await Drive.save('alice', { ...note({ markdown: '---\nauthor: Ahmad\n---\nBody' }), version: 0 });
  expect(fm.parse(saved.markdown).attributes.links).toEqual(['bukhari:100']);
  const linked = await Drive.save('alice', { ...saved, markdown: fm.serialize({ links: ['bukhari:100', 'quran:2:255'] }, 'Body') });
  expect(linked.attachments.map(item => item.source_key)).toEqual(['item:42', 'item:77']);
  const detached = await Drive.save('alice', { ...linked, markdown: fm.serialize({ links: ['quran:2:255'] }, 'Body') });
  expect(await Drive.status('alice', ['item:42', 'item:77'])).toEqual(['item:77']);
  expect((await Drive.get('alice', 'item:42')).driveFileUrl).toBe(saved.driveFileUrl);
  expect((await Drive.related('alice', 'item:77'))[0].source_key).toBe('item:42');
  const exported = fm.parse(Drive.exportMarkdown(detached)).attributes;
  expect(exported.links).toEqual(['quran:2:255']);
  expect(exported).not.toHaveProperty('reference');
  expect(exported).not.toHaveProperty('attachments');
  const response = await fetch(base + '?source=item:42&context=1', { headers: { Authorization: 'Bearer alice' } });
  const draft = await response.json();
  expect(draft.note).toBeNull();
  expect(draft.source.source_key).toMatch(/^general:/);
  await Drive.save('alice', { ...draft.source, title: 'New contextual note', markdown: 'New contextual note' });
  expect((await Drive.get('alice', 'item:42')).revision).toBe(detached.revision);
  expect(await Drive.status('alice', ['item:42'])).toEqual(['item:42']);
});

test('legacy additional links migrate alongside the original item without changing identity', async () => {
  const created = await Drive.save('alice', { ...note(), version: 0 });
  const legacy = note({ markdown: '---\nattachments: [quran:2:255]\n---\nBody', attachments: [{ source_key: 'item:77', source_title: 'quran:2:255', source_url: '/quran:2:255' }] });
  files.get(mappings.get('item:42')).body = Drive.encode(legacy);
  const loaded = await Drive.get('alice', 'item:42');
  expect(loaded.attachments.map(item => item.source_key)).toEqual(['item:42', 'item:77']);
  const migrated = await Drive.save('alice', loaded);
  expect(require('../lib/NotebookFrontmatter').parse(migrated.markdown).attributes.links).toEqual(['bukhari:100', 'quran:2:255']);
  expect(migrated.driveFileUrl).toBe(created.driveFileUrl);
  expect(migrated.markdown).not.toContain('attachments:');
});


test('discovers a directly saved Markdown file and standardizes its frontmatter without replacing the original note', async () => {
  await Drive.save('alice', { ...note(), version: 0 });
  const body = '---\ntitle: Riyad 1 v2\ntags: [intention, riyad]\nlinks: ["bukhari:1"]\ncustom: preserve me\n---\n\nArabic العربية and audience notes.\n';
  files.set('direct', { id: 'direct', name: 'Riyad 1 v2.md', mimeType: 'text/plain', parents: ['folder'], version: '1', body,
    createdTime: '2026-10-16T00:00:00Z', modifiedTime: '2026-10-16T00:00:00Z', size: Buffer.byteLength(body) });
  await new Drive.Store('alice', connection, { request }).discover();
  const result = await Drive.list('alice');
  const imported = result.notes.find(entry => entry.title === 'Riyad 1 v2');
  expect(imported).toMatchObject({ tags: ['intention', 'riyad'], attachments: [{ source_key: 'item:42' }] });
  expect(imported.source_key).toMatch(/^general:/);
  expect(imported.markdown).toContain('custom: preserve me');
  expect(imported.markdown).toContain('\n\nArabic العربية and audience notes.\n');
  expect(mappings.get('item:42')).not.toBe('direct');
  expect(files.get('direct').name).toBe('Riyad 1 v2.md');
  expect(files.get('direct').mimeType).toBe('text/markdown');
  expect(files.get('direct').body).toContain('hadithunlocked:');
  await Drive.list('alice');
  expect(mappings.size).toBe(2);
});

test('imports Markdown without frontmatter using its filename and ignores other file types', async () => {
  for (const [id, name] of [['plain', 'Untitled.MD'], ['other', 'image.png']])
    files.set(id, { id, name, mimeType: 'text/plain', parents: ['folder'], version: '1', body: 'Note content\n',
      createdTime: '2026-10-16T00:00:00Z', modifiedTime: '2026-10-16T00:00:00Z' });
  await new Drive.Store('alice', connection, { request }).discover();
  const result = await Drive.list('alice');
  expect(result.notes).toHaveLength(1);
  expect(result.notes[0]).toMatchObject({ title: 'Untitled', tags: [] });
  expect(files.get('plain').body).toContain('title: Untitled');
  expect(files.get('other').version).toBe('1');
});

test('does not rewrite a directly saved note if Drive changes during discovery', async () => {
  files.set('direct', { id: 'direct', name: 'Direct.md', mimeType: 'text/plain', parents: ['folder'], version: '1', body: 'Before' });
  const originalRequest = request.getMockImplementation();
  request.mockImplementation(async options => {
    if (options.params?.alt === 'media' && options.url.endsWith('/direct')) files.get('direct').version = '2';
    return originalRequest(options);
  });
  await expect(new Drive.Store('alice', connection, { request }).discover()).rejects.toThrow('still updating');
  expect(mappings.size).toBe(0);
  expect(files.get('direct').body).toBe('Before');
});

test('connection status offers limited reconnection for old full-access grants', async () => {
  connection.token_cipher = Drive.encrypt('alice', { refresh_token: 'refresh', scope: 'https://www.googleapis.com/auth/drive' });
  expect(await Drive.connectionStatus('alice')).toMatchObject({ connected: true, needsDriveAccess: true, scope: Drive.SCOPE });
  await Drive.connect({ uid: 'alice', provider: 'google.com' }, 'code', 'http://localhost:3004');
  expect(await Drive.connectionStatus('alice')).toMatchObject({ connected: true, needsDriveAccess: false });
});

test('registered notes load while background discovery is blocked, and concurrent requests share one job', async () => {
  await Drive.save('alice', { ...note(), version: 0 });
  Drive.Store.prototype.scheduleDiscovery.mockRestore();
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let started;
  const running = new Promise(resolve => { started = resolve; });
  const discover = jest.spyOn(Drive.Store.prototype, 'discover').mockImplementation(async () => { started(); await blocked; });
  const store = new Drive.Store('alice', connection, { request });
  const first = await Drive.list('alice');
  expect(first.notes).toHaveLength(1);
  await running;
  const second = await Drive.list('alice');
  expect(second.notes).toHaveLength(1);
  expect(discover).toHaveBeenCalledTimes(1);
  release();
  await store.scheduleDiscovery();
  await store.scheduleDiscovery();
  expect(discover).toHaveBeenCalledTimes(1);
});

test('a failed background discovery does not reject page loads or produce an unhandled rejection', async () => {
  connection.folder_id = 'failure-folder';
  files.set('failure-folder', { id: 'failure-folder', mimeType: 'application/vnd.google-apps.folder' });
  Drive.Store.prototype.scheduleDiscovery.mockRestore();
  jest.spyOn(Drive.Store.prototype, 'discover').mockRejectedValue(new Error('Drive unavailable'));
  const store = new Drive.Store('alice', connection, { request });
  await expect(Drive.list('alice')).resolves.toMatchObject({ notes: [] });
  await expect(store.scheduleDiscovery()).resolves.toBeUndefined();
  await expect(Drive.list('alice')).resolves.toMatchObject({ notes: [] });
});

function pickedFile(id, overrides = {}) {
  return { id, name: 'Riyad 1 v2.md', mimeType: 'text/plain', parents: ['folder'], version: '1',
    body: '---\ntitle: Riyad 1 v2\ntags: [riyad]\nlinks: ["bukhari:1"]\ncustom: keep\n---\n\nAudience text العربية\n',
    createdTime: '2026-10-16T00:00:00Z', modifiedTime: '2026-10-16T00:00:00Z', ...overrides };
}
test('picker import normalizes the same file in place and repeated selection is idempotent', async () => {
  const saved = await Drive.save('alice', { ...note(), version: 0 });
  files.set('picked', pickedFile('picked'));
  const first = await Drive.importFiles('alice', ['picked', 'picked']);
  expect(first.notes).toHaveLength(1);
  expect(first.notes[0]).toMatchObject({ title: 'Riyad 1 v2', attachments: [{ source_key: 'item:42' }] });
  expect(first.notes[0].driveFileUrl).toContain('/picked/');
  expect(first.notes[0].source_key).not.toBe(saved.source_key);
  expect(first.notes[0].markdown).toContain('custom: keep');
  expect(first.notes[0].markdown).toContain('\n\nAudience text العربية\n');
  const version = files.get('picked').version;
  const second = await Drive.importFiles('alice', ['picked']);
  expect(second.notes[0].source_key).toBe(first.notes[0].source_key);
  expect(files.get('picked').version).toBe(version);
  expect(files.size).toBe(3); // folder, original, selected file
  expect(mappings.size).toBe(2);
  expect(request.mock.calls.filter(([o]) => o.url.includes('upload/') && o.method === 'POST')).toHaveLength(1); // original only
});
test('picker imports validate actual Drive metadata before mutating files', async () => {
  files.set('valid', pickedFile('valid'));
  files.set('outside', pickedFile('outside', { parents: ['another-folder'] }));
  await expect(Drive.importFiles('alice', ['valid', 'outside'])).rejects.toThrow('Hadith Unlocked folder');
  expect(files.get('valid').version).toBe('1');
  expect(mappings.size).toBe(0);
  await expect(Drive.importFiles('alice', ['invalid/path'])).rejects.toThrow('1 and 20');
  await expect(Drive.importFiles('alice', [])).rejects.toThrow('1 and 20');
});
test('picker imports require authentication and expose only public metadata', async () => {
  files.set('picked', pickedFile('picked'));
  const unauthorized = await fetch(base + '/drive/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileIds: ['picked'] }) });
  expect(unauthorized.status).toBe(401);
  const response = await fetch(base + '/drive/import', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer alice' }, body: JSON.stringify({ fileIds: ['picked'] }) });
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.notes[0].title).toBe('Riyad 1 v2');
  expect(data.notes[0]._etag).toBeUndefined();
  expect(data.notes[0]._id).toBeUndefined();
});

test('shared Google API key and project number configure Picker without duplicate settings', async () => {
  global.settings.google.apiKey = 'shared-browser-key';
  global.settings.google.projectNumber = '123456789';
  const state = await Drive.connectionStatus('alice');
  expect(state.picker).toEqual({ apiKey: 'shared-browser-key', appId: '123456789' });
  expect(state.clientId).toBe('client');
});

test('large Drive notes save and reopen without a note size cap', async () => {
  const markdown = 'ا'.repeat(60000);
  const saved = await Drive.save('alice', { ...note({ markdown }), version: 0 });
  expect(saved.markdown).toBe(markdown);
  expect((await Drive.get('alice', saved.source_key)).markdown).toBe(markdown);
});
