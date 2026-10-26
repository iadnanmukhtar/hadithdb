'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Utils = require('../lib/Utils');
const Community = require('../lib/Community');
const Media = require('../lib/CommunityMedia');
const Cache = require('../lib/CommunityMediaCache');
const id = 'a'.repeat(32);
let dir, allowed, blob, metadata;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-cache-test-'));
  allowed = true; blob = Buffer.from('image bytes');
  metadata = { blog_cacheable: 1, mime: 'image/png', bytes: blob.length, created_at: '2026-10-26T12:00:00Z' };
  jest.spyOn(Utils, 'cacheBookDirectory').mockReturnValue(path.join(dir, 'media'));
  jest.spyOn(Utils, 'diskCacheEnabled').mockReturnValue(true);
  jest.spyOn(Community, 'ensure').mockResolvedValue();
  jest.spyOn(Community, 'sql').mockImplementation(async sql => !allowed ? [] : sql.startsWith('SELECT m.mime,m.data') ? [{ mime: metadata.mime, data: blob }] : [metadata]);
});
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });
const blobReads = () => Community.sql.mock.calls.filter(([sql]) => sql.startsWith('SELECT m.mime,m.data')).length;
test('repeated image reads use disk bytes while checking authorization without selecting the blob', async () => {
  expect((await Media.image(id, null)).data).toEqual(blob);
  expect((await Media.image(id, null)).data).toEqual(blob);
  expect(blobReads()).toBe(1);
  expect(Community.sql.mock.calls.filter(([sql]) => sql.startsWith('SELECT m.mime,m.bytes')).length).toBe(2);
  expect(fs.readdirSync(path.join(dir, 'media'))).toEqual([id + '.bin']);
});
test('unpublishing denies cached images and removes their disk entry', async () => {
  await Media.image(id, null);
  allowed = false;
  await expect(Media.image(id, null)).rejects.toMatchObject({ status: 404 });
  expect(fs.existsSync(path.join(dir, 'media', id + '.bin'))).toBe(false);
  expect(blobReads()).toBe(1);
});
test('article invalidation causes bytes to be fetched again, and cover replacement has a different cache ID', async () => {
  await Media.image(id, null);
  await Cache.invalidate();
  await Media.image(id, null);
  await Media.image('b'.repeat(32), null);
  expect(blobReads()).toBe(3);
});
test('metadata changes and damaged cached bytes trigger a fresh blob read', async () => {
  await Media.image(id, null);
  metadata = { ...metadata, mime: 'image/jpeg' };
  expect((await Media.image(id, null)).mime).toBe('image/jpeg');
  fs.writeFileSync(path.join(dir, 'media', id + '.bin'), 'broken');
  expect((await Media.image(id, null)).data).toEqual(blob);
  expect(blobReads()).toBe(3);
});
test('a private owner cache never bypasses access checks for another viewer', async () => {
  await Media.image(id, { uid: 'owner' });
  allowed = false;
  await expect(Media.image(id, { uid: 'other' })).rejects.toMatchObject({ status: 404 });
  const args = Community.sql.mock.calls.at(-1)[1];
  expect(args[1]).toBe('other');
});
test('revoked access between metadata and the initial blob fetch is rejected', async () => {
  Community.sql.mockImplementation(async sql => sql.startsWith('SELECT m.mime,m.data') ? [] : [metadata]);
  await expect(Media.image(id, null)).rejects.toMatchObject({ status: 404 });
  expect(fs.existsSync(path.join(dir, 'media', id + '.bin'))).toBe(false);
});
test('disabled disk caching and invalid identifiers are honored', async () => {
  Utils.diskCacheEnabled.mockReturnValue(false);
  await Media.image(id, null); await Media.image(id, null);
  expect(blobReads()).toBe(2);
  expect(fs.existsSync(path.join(dir, 'media'))).toBe(false);
  await expect(Media.image('../secret', null)).rejects.toMatchObject({ status: 404 });
});

test('ordinary community media is never cached and loses an old blog cache entry', async () => {
  await Media.image(id,null);
  metadata.blog_cacheable=0;
  expect((await Media.image(id,null)).cacheable).toBe(false);
  await Media.image(id,null);
  expect(blobReads()).toBe(3);
  expect(fs.existsSync(path.join(dir,'media',id+'.bin'))).toBe(false);
});
