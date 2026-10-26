'use strict';
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const Utils = require('./Utils');
const directory = () => Utils.cacheBookDirectory('media', 'community');
function filename(id) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid media cache ID');
  return path.join(directory(), id + '.bin');
}
async function remove(id) {
  await fs.rm(filename(id), { force: true });
}
async function invalidate() {
  await fs.rm(directory(), { recursive: true, force: true });
}
async function load(id, metadata, fetchImage) {
  if (!Utils.diskCacheEnabled()) return fetchImage();
  // Uploads/imports use immutable, unique IDs. Replacing a cover creates a new
  // URL. Metadata is checked after authorization on every request, not cached.
  const signature = crypto.createHash('sha256').update(JSON.stringify([id, metadata.mime, metadata.bytes, metadata.created_at])).digest('hex') + '\n';
  const file = filename(id);
  try {
    const cached = await fs.readFile(file);
    if (cached.subarray(0, 65).toString() === signature && cached.length - 65 === Number(metadata.bytes)) return { mime: metadata.mime, data: cached.subarray(65) };
  } catch (error) { if (error.code !== 'ENOENT') log(error); }
  const image = await fetchImage();
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(temporary, Buffer.concat([Buffer.from(signature), image.data]), { mode: 0o600 });
    await fs.rename(temporary, file);
  } catch (error) { log(error); }
  finally { await fs.rm(temporary, { force: true }).catch(log); }
  return image;
}
function log(error) { require('./Debug')('hadithdb:CommunityMediaCache').error(`Media cache: ${error.message}`); }
module.exports = { load, remove, invalidate };
