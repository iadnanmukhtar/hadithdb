'use strict';

const crypto = require('crypto');
const { promisify } = require('util');
const { OAuth2Client } = require('google-auth-library');
const createError = require('http-errors');
const Legacy = require('./UserNotebook');
const frontMatter = require('front-matter');
const { normalizeTitle } = require('./NotebookWiki');
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,trashed,parents,appProperties,version,createdTime,modifiedTime,size';
const sourceHash = source => crypto.createHash('sha256').update(source).digest('hex');
const conflict = () => createError(409, 'This note changed elsewhere. Reopen it before saving.');
const unstableRead = () => createError(503, 'Google Drive is still updating this note. Your draft is preserved; try saving again.');
// Drive's version also advances for metadata-only work after an upload.
// Compare editable note content, while retaining If-Match for the actual write.
const revision = note => crypto.createHash('sha256').update(JSON.stringify([
  note.source_key, note.source_title, note.source_url, note.title, note.tags, note.markdown
])).digest('hex');
const connectionError = () => createError(428, 'Connect Google Drive to use your notebook.', { code: 'DRIVE_CONNECT' });
// Do not pass credentials through global.query, which can log SQL statements.
function sql(statement, values = []) {
  return promisify(global.dbPool.query).call(global.dbPool, statement, values);
}
function config() {
  const google = global.settings?.google || {};
  return {
    clientId: process.env.GOOGLE_DRIVE_CLIENT_ID || google.clientId || google.client_id,
    clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET || google.clientSecret || google.client_secret,
    key: process.env.NOTEBOOK_DRIVE_TOKEN_KEY || google.driveTokenKey
  };
}
function configured() {
  const c = config();
  return !!(c.clientId && c.clientSecret && c.key && Buffer.from(c.key, 'base64').length === 32);
}
function requireConfig() {
  if (!configured()) throw createError(503, 'Google Drive storage is not configured yet. Existing notes are preserved.', { code: 'DRIVE_SETUP' });
}
function encrypt(uid, value) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(config().key, 'base64'), iv);
  cipher.setAAD(Buffer.from(uid));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
function decrypt(uid, value) {
  const bytes = Buffer.from(value, 'base64'), decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(config().key, 'base64'), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(uid)); decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
}
let ready;
function ensureTable() {
  if (!ready) ready = (async () => {
    await sql(`CREATE TABLE IF NOT EXISTS user_notebook_drive (
      user_uid VARCHAR(128) COLLATE utf8mb4_bin PRIMARY KEY,
      google_sub VARCHAR(128) COLLATE utf8mb4_bin NULL,
      token_cipher MEDIUMTEXT NULL,
      folder_id VARCHAR(128) NULL,
      migrated TINYINT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await sql(`CREATE TABLE IF NOT EXISTS user_notebook_drive_files (
      user_uid VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
      source_key VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
      file_id VARCHAR(128) NOT NULL,
      PRIMARY KEY(user_uid, source_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await sql(`CREATE TABLE IF NOT EXISTS user_notebook_creations (
      user_uid VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
      file_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
      recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_uid, file_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  })().catch(err => { ready = null; throw err; });
  return ready;
}
async function recordCreation(uid, fileId) {
  await ensureTable();
  // Drive IDs identify creations, so retries/edits cannot increment the total.
  await sql('INSERT IGNORE INTO user_notebook_creations (user_uid, file_id) VALUES (?, ?)', [uid, fileId]);
}
async function creationCount(uid) {
  await ensureTable();
  return Number((await sql('SELECT COUNT(*) AS lifetime_created FROM user_notebook_creations WHERE user_uid=?', [uid]))[0].lifetime_created);
}
async function stats(uid) {
  await ensureTable();
  const pending = await sql(`SELECT f.source_key, f.file_id FROM user_notebook_drive_files f
    LEFT JOIN user_notebook_creations c ON c.user_uid=f.user_uid AND c.file_id=f.file_id
    WHERE f.user_uid=? AND c.file_id IS NULL`, [uid]);
  let backfillIncomplete = false;
  if (pending.length) {
    try {
      const store = await clientFor(uid);
      for (let i = 0; i < pending.length; i += 5) {
        await Promise.all(pending.slice(i, i + 5).map(async entry => {
          try {
            const file = (await store.request(`drive/v3/files/${entry.file_id}`, { params: { fields: 'id,mimeType,appProperties' } })).data;
            // Include trashed notes, but never count an ID reserved by a failed save.
            if (file.mimeType === 'text/markdown' && file.appProperties?.source_hash === sourceHash(entry.source_key))
              await recordCreation(uid, entry.file_id);
            else backfillIncomplete = true;
          } catch (err) { if (err.status !== 404) throw err; backfillIncomplete = true; }
        }));
      }
    } catch (err) {
      if (![428, 503].includes(err.status)) throw err;
      backfillIncomplete = true;
    }
  }
  return { lifetime_created: await creationCount(uid), backfill_incomplete: backfillIncomplete };
}
async function row(uid) {
  await ensureTable();
  return (await sql('SELECT * FROM user_notebook_drive WHERE user_uid=?', [uid]))[0];
}
async function locked(uid, operation) {
  const connection = await promisify(global.dbPool.getConnection).call(global.dbPool);
  const query = promisify(connection.query).bind(connection);
  const name = 'notebook-drive:' + crypto.createHash('sha256').update(uid).digest('hex').slice(0, 40);
  let acquired = false;
  try {
    acquired = (await query('SELECT GET_LOCK(?, 5) AS acquired', [name]))[0].acquired === 1;
    if (!acquired) throw createError(409, 'Another notebook operation is in progress. Please retry.');
    return await operation();
  } finally {
    // A broken connection must not be returned to the pool with an advisory lock.
    try { if (acquired) await query('SELECT RELEASE_LOCK(?)', [name]); connection.release(); }
    catch (_) { connection.destroy(); }
  }
}
async function connectionStatus(uid) {
  if (!configured()) return { configured: false, connected: false, migrated: false };
  const record = await row(uid);
  return { configured: true, clientId: config().clientId, connected: !!record?.token_cipher, migrated: !!record?.migrated,
    folderUrl: record?.folder_id ? `https://drive.google.com/drive/folders/${record.folder_id}` : null };
}
async function connect(user, code, origin) {
  requireConfig();
  if (typeof code !== 'string' || !code || code.length > 4096) throw createError(400, 'Invalid authorization code.');
  await ensureTable();
  return locked(user.uid, async () => {
    const { clientId, clientSecret } = config();
    const client = new OAuth2Client(clientId, clientSecret, origin);
    let tokens, identity;
    try {
      ({ tokens } = await client.getToken(code));
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
      identity = ticket.getPayload();
    } catch (_) { throw createError(400, 'Could not authorize Google Drive. Please connect again.'); }
    if (!identity?.sub || !tokens.scope?.split(' ').includes(SCOPE)) throw createError(403, 'Allow access to Hadith Unlocked files in Google Drive.');
    const record = await row(user.uid);
    // Google login users must use their signed-in identity; other logins bind once.
    if ((user.provider === 'google.com' && identity.sub !== user.uid) || (record?.google_sub && identity.sub !== record.google_sub))
      throw createError(403, 'Choose the Google account already associated with this notebook.');
    const previous = record?.token_cipher ? decrypt(user.uid, record.token_cipher) : {};
    tokens.refresh_token ||= previous.refresh_token;
    if (!tokens.refresh_token) throw createError(400, 'Google did not grant ongoing access. Remove the app from Google account permissions, then connect again.');
    await sql(`INSERT INTO user_notebook_drive (user_uid, google_sub, token_cipher) VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE google_sub=VALUES(google_sub), token_cipher=VALUES(token_cipher)`,
    [user.uid, identity.sub, encrypt(user.uid, tokens)]);
    return connectionStatus(user.uid);
  });
}
async function disconnect(uid) {
  requireConfig(); await ensureTable();
  await locked(uid, () => sql('UPDATE user_notebook_drive SET token_cipher=NULL WHERE user_uid=?', [uid]));
  // Retain identity and file mappings, so reconnection cannot switch or duplicate notebooks.
}
async function clientFor(uid, allowMigration = false) {
  requireConfig();
  const record = await row(uid);
  if (!record?.token_cipher) throw connectionError();
  if (!allowMigration && !record.migrated) throw createError(428, 'Finish moving your existing notes to Google Drive.', { code: 'DRIVE_MIGRATE' });
  const { clientId, clientSecret } = config();
  const client = new OAuth2Client(clientId, clientSecret);
  client.setCredentials(decrypt(uid, record.token_cipher));
  // The refresh token is stable. Access tokens are request-local and never sent to the browser.
  return new Store(uid, record, client);
}
function validate(body, previous = {}) {
  const source = Legacy.key(body.source_key);
  if ((source === 'general' || source.startsWith('general:'))) body = { ...body, source_title: 'General note', source_url: '/notebook' };
  const title = body.title === undefined ? previous.title || null : body.title;
  if (title !== null && (typeof title !== 'string' || title.length > 500)) throw createError(400, 'Titles can contain up to 500 characters.');
  if (typeof body.markdown !== 'string' || (!body.markdown.trim() && !title?.trim())) throw createError(400, 'Write a note before saving.');
  if (Buffer.byteLength(body.markdown, 'utf8') > 65535) throw createError(413, 'Notes can contain up to 64 KB of Markdown.');
  if (typeof body.source_title !== 'string' || !body.source_title.trim() || body.source_title.length > 500) throw createError(400, 'Invalid source title.');
  return { source_key: source, source_title: body.source_title, source_url: Legacy.sourceUrl(body.source_url),
    title: title?.trim() || null, tags: Legacy.parseTags(body.tags === undefined ? previous.tags : body.tags), markdown: body.markdown };
}
function encode(note) {
  const { markdown, title, tags, needsChecksum, ...metadata } = note;
  // Compute when writing; subsequent reads use the stored checksum.
  // Never accept a caller-supplied checksum for new content.
  delete metadata.content_checksum;
  metadata.cksum = revision(note);
  return `---\ntitle: ${JSON.stringify(title || null)}\ntags: ${JSON.stringify(tags || [])}\nhadithunlocked: ${JSON.stringify(metadata)}\n---\n${markdown}`;
}
function decode(text, source) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 100000) throw createError(422, 'The Drive note is too large to open.');
  let parsed;
  try { parsed = frontMatter(text); } catch (_) { throw createError(422, 'The Drive note has invalid metadata. Restore its metadata before editing.'); }
  const metadata = parsed.attributes?.hadithunlocked;
  if (!metadata || metadata.source_key !== source) throw createError(422, 'The Drive note identity is missing or changed. Restore its metadata before editing.');
  const header = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  if (!header) throw createError(422, 'The Drive note has invalid metadata.');
  // front-matter trims leading blank lines in body; preserve the exact user's Markdown.
  const note = validate({ ...metadata, title: parsed.attributes.title, tags: parsed.attributes.tags, markdown: text.slice(header[0].length) });
  const checksum = metadata.cksum !== undefined ? metadata.cksum : metadata.content_checksum;
  if (checksum !== undefined && (typeof checksum !== 'string' || !/^[a-f0-9]{64}$/.test(checksum)))
    throw createError(422, 'The Drive note has an invalid content checksum.');
  // Even an unchanged save upgrades older files to the canonical checksum field.
  return { ...note, needsChecksum: metadata.cksum === undefined, revision: checksum || revision(note), created_at: metadata.created_at || null };
}
function filename(note) {
  return `${(note.title || note.source_title).replace(/[^\p{L}\p{N} _-]/gu, '-').slice(0, 80).trim() || 'Note'} (${note.source_key.replace(/:/g, '-')}).md`;
}
class Store {
  constructor(uid, record, client) { this.uid = uid; this.record = record; this.client = client; }
  async request(path, options = {}) {
    try {
      return await this.client.request({ url: `https://www.googleapis.com/${path}`, timeout: 20000, retry: false, ...options });
    } catch (err) {
      const status = err.response?.status, reason = err.response?.data?.error;
      if (status === 401 || reason === 'invalid_grant') {
        await sql('UPDATE user_notebook_drive SET token_cipher=NULL WHERE user_uid=? AND token_cipher=?', [this.uid, this.record.token_cipher]);
        throw connectionError();
      }
      if (status === 404) throw createError(404, 'The note or folder is missing from Google Drive. Restore it in Drive and retry.');
      if (status === 409 || status === 412) throw conflict();
      if (status === 403) throw createError(503, 'Google Drive access is unavailable. Check permissions, storage space, and whether the Drive API is enabled.');
      if (status === 429) throw createError(503, 'Google Drive is busy. Please retry shortly.');
      throw createError(503, 'Could not reach Google Drive. Your changes have not been confirmed saved. Please retry.');
    }
  }
  async generateId() { return (await this.request('drive/v3/files/generateIds', { params: { count: 1, space: 'drive', type: 'files' } })).data.ids[0]; }
  async folder() {
    const id = this.record.folder_id;
    if (!id) throw createError(428, 'Finish setting up your Google Drive notebook.', { code: 'DRIVE_MIGRATE' });
    const file = (await this.request(`drive/v3/files/${id}`, { params: { fields: 'id,mimeType,trashed' } })).data;
    if (file.trashed || file.mimeType !== FOLDER) throw createError(409, 'Restore the Hadith Unlocked folder in Google Drive to continue.');
    return id;
  }
  async ensureFolder() {
    if (!this.record.folder_id) {
      this.record.folder_id = await this.generateId();
      await sql('UPDATE user_notebook_drive SET folder_id=? WHERE user_uid=?', [this.record.folder_id, this.uid]);
    }
    try { return await this.folder(); } catch (err) { if (err.status !== 404) throw err; }
    await this.request('drive/v3/files', { method: 'POST', data: { id: this.record.folder_id, name: 'Hadith Unlocked', mimeType: FOLDER, appProperties: { application: 'hadithunlocked' } } });
    return this.record.folder_id;
  }
  async mapping(source) { return (await sql('SELECT file_id FROM user_notebook_drive_files WHERE user_uid=? AND source_key=?', [this.uid, source]))[0]?.file_id; }
  async reserve(source) {
    let id = await this.mapping(source);
    if (!id) {
      id = await this.generateId();
      await sql('INSERT INTO user_notebook_drive_files (user_uid,source_key,file_id) VALUES (?,?,?)', [this.uid, source, id]);
    }
    return id;
  }
  async read(id, source, attempt = 0) {
    const response = await this.request(`drive/v3/files/${id}`, { params: { fields: FIELDS } });
    const file = response.data;
    if (file.trashed) return null;
    if (!file.parents?.includes(this.record.folder_id) || file.appProperties?.source_hash !== sourceHash(source) || file.mimeType !== 'text/markdown')
      throw createError(409, 'The Drive note was moved or its identity changed. Restore it before editing.');
    if (Number(file.size) > 100000) throw createError(422, 'The Drive note is too large to open.');
    const content = await this.request(`drive/v3/files/${id}`, { params: { alt: 'media' }, responseType: 'text' });
    // Metadata before and after the body must describe the same revision.
    // v3 omits ETags and ignores If-Match. Use v2's revision marker and
    // conditional mutation endpoints to protect edits made outside this app.
    const check = await this.request(`drive/v2/files/${id}`, { params: { fields: 'version,etag' } });
    if (file.version !== check.data.version) {
      // Drive can advance metadata again just after a completed upload.
      // Re-read the whole snapshot rather than attach a newer ETag to old text.
      if (attempt < 2) return this.read(id, source, attempt + 1);
      throw unstableRead();
    }
    const note = decode(content.data, source);
    const etag = check.data.etag;
    return { ...note, version: file.version, updated_at: file.modifiedTime, created_at: note.created_at || file.createdTime,
      html: Legacy.render(note.markdown), hashtags: [...new Map([...Legacy.hashtags(note.markdown), ...note.tags].map(tag => [Legacy.normalizeSearch(tag), tag])).values()], _etag: etag, _id: id };
  }
  async get(source) {
    Legacy.key(source); await this.folder();
    const id = await this.mapping(source);
    return id ? this.read(id, source) : null;
  }
  async all() {
    await this.folder();
    const mappings = await sql('SELECT source_key,file_id FROM user_notebook_drive_files WHERE user_uid=?', [this.uid]);
    const notes = [];
    for (let i = 0; i < mappings.length; i += 5) {
      const batch = await Promise.all(mappings.slice(i, i + 5).map(async entry => {
        try { return await this.read(entry.file_id, entry.source_key); }
        catch (err) { if (err.status === 404) return null; throw err; }
      }));
      notes.push(...batch.filter(Boolean));
    }
    return notes;
  }
  async upload(id, note, existing, create = false) {
    if (!create && !existing?._etag) throw createError(503, 'Google Drive did not provide a revision marker. Reopen the note before editing.');
    const boundary = 'notebook_' + crypto.randomBytes(16).toString('hex');
    const metadata = create
      ? { name: filename(note), mimeType: 'text/markdown', appProperties: { source_hash: sourceHash(note.source_key), application: 'hadithunlocked' },
        id, parents: [this.record.folder_id], ...(note.updated_at ? { modifiedTime: note.updated_at } : {}) }
      : { title: filename(note), mimeType: 'text/markdown' };
    const data = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${encode(note)}\r\n--${boundary}--`;
    const response = await this.request(create ? 'upload/drive/v3/files' : `upload/drive/v2/files/${id}`, { method: create ? 'POST' : 'PUT', params: { uploadType: 'multipart', fields: create ? 'id,version,modifiedTime,createdTime' : 'id,version,modifiedDate,createdDate' },
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}`, ...(!create ? { 'If-Match': existing._etag } : {}) }, data });
    return response.data;
  }
  async save(body) {
    const source = Legacy.key(body.source_key);
    if (!(body.version === 0 || (typeof body.version === 'string' && /^\d+$/.test(body.version)))) throw createError(400, 'Invalid note version.');
    await this.folder();
    let previous = null;
    const id = await this.mapping(source);
    if (id) {
      try { previous = await this.read(id, source); } catch (err) { if (err.status !== 404 || body.version !== 0) throw err; }
    }
    const note = { ...validate(body, previous || {}), created_at: previous?.created_at || new Date().toISOString() };
    if (previous) {
      await recordCreation(this.uid, previous._id);
      // A retry after a successful upload with a lost response needs no rewrite.
      if (revision(note) === previous.revision && !previous.needsChecksum) return previous;
      if (body.revision ? body.revision !== previous.revision : previous.version !== body.version) throw conflict();
    } else if (body.version !== 0) throw conflict();
    if (!note.title) throw createError(400, 'Enter a title for this note.');
    if (/[\[\]|\r\n]/.test(note.title)) throw createError(400, 'Note titles cannot contain brackets, pipes, or line breaks.');
    if ((!previous || normalizeTitle(previous.title) !== normalizeTitle(note.title)) &&
      (await this.all()).some(other => other.source_key !== source && normalizeTitle(other.title) === normalizeTitle(note.title)))
      throw createError(409, 'You already have a note with this title. Choose a different title.');
    let fileId = id;
    if (!previous && id) {
      // A deleted file cannot reuse its ID. Reserve a fresh ID before writing.
      fileId = await this.generateId();
      await sql('UPDATE user_notebook_drive_files SET file_id=? WHERE user_uid=? AND source_key=?', [fileId, this.uid, source]);
    }
    fileId ||= await this.reserve(source);
    let uploaded;
    for (let attempt = 0; ; ++attempt) {
      try { uploaded = await this.upload(fileId, note, previous, !previous); break; }
      catch (err) {
        if (!previous || err.status !== 409 || attempt >= 2) throw err;
        const fresh = await this.read(fileId, source);
        if (!fresh || fresh.revision !== previous.revision) throw conflict();
        // Only retry metadata drift; an actual content change remains a conflict.
        previous = fresh;
      }
    }
    // A successful upload is authoritative. A subsequent GET can lag behind it
    // or observe Drive's metadata churn, leaving the editor with an old revision.
    await recordCreation(this.uid, fileId);
    return { ...note, version: uploaded.version, revision: revision(note), needsChecksum: false,
      updated_at: uploaded.modifiedTime || uploaded.modifiedDate, _id: fileId,
      html: Legacy.render(note.markdown), hashtags: [...new Map([...Legacy.hashtags(note.markdown), ...note.tags].map(tag => [Legacy.normalizeSearch(tag), tag])).values()] };
  }
  async remove(source, version, contentRevision) {
    let note = await this.get(source);
    if (!note || (contentRevision ? note.revision !== contentRevision : note.version !== version)) throw conflict();
    await recordCreation(this.uid, note._id);
    for (let attempt = 0; ; ++attempt) {
      if (!note._etag) throw createError(503, 'Google Drive did not provide a revision marker. Reopen the note before deleting.');
      try {
        await this.request(`drive/v2/files/${note._id}`, { method: 'PATCH', headers: { 'If-Match': note._etag }, data: { labels: { trashed: true } } });
        return;
      } catch (err) {
        if (err.status !== 409 || attempt >= 2) throw err;
        const fresh = await this.get(source);
        if (!fresh || fresh.revision !== note.revision) throw conflict();
        note = fresh;
      }
    }
  }
}
function publicNote(note) {
  if (!note) return null;
  const { _etag, _id, ...result } = note;
  return { ...result, driveFileUrl: `https://drive.google.com/file/d/${encodeURIComponent(_id)}/view` };
}
async function get(uid, source) { return publicNote(await (await clientFor(uid)).get(source)); }
async function save(uid, body) {
  return locked(uid, async () => {
    const note = publicNote(await (await clientFor(uid)).save(body));
    return { ...note, lifetime_created: await creationCount(uid) };
  });
}
async function remove(uid, source, version, contentRevision) { return locked(uid, async () => (await clientFor(uid)).remove(source, version, contentRevision)); }
async function list(uid, offset = 0, query = '', tag = '') {
  if (typeof query !== 'string' || query.length > 500 || typeof tag !== 'string' || tag.length > 200) throw createError(400, 'Invalid note search.');
  const search = Legacy.normalizeSearch(query.trim()), filter = Legacy.normalizeSearch(tag.trim().replace(/^#/, ''));
  if (filter && !/^[\p{L}\p{N}_][\p{L}\p{M}\p{N}_-]*$/u.test(filter)) throw createError(400, 'Invalid hashtag.');
  const notes = (await (await clientFor(uid)).all()).filter(note => (!search || Legacy.normalizeSearch(`${note.source_title}\n${note.title || ''}\n${note.markdown}`).includes(search)) && (!filter || note.hashtags.some(t => Legacy.normalizeSearch(t) === filter)));
  notes.sort((a, b) => (b.source_key === 'general') - (a.source_key === 'general') || b.updated_at.localeCompare(a.updated_at) || a.source_key.localeCompare(b.source_key));
  return { notes: notes.slice(offset, offset + 12).map(publicNote), hasMore: notes.length > offset + 12 };
}
async function tagList(uid) {
  const counts = new Map();
  for (const note of await (await clientFor(uid)).all()) for (const tag of new Set(note.hashtags.map(Legacy.normalizeSearch))) counts.set(tag, (counts.get(tag) || 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([tag, count]) => ({ tag, count }));
}
async function links(uid, query = '', title) {
  if (typeof query !== 'string' || query.length > 500 || (title !== undefined && (typeof title !== 'string' || title.length > 500)))
    throw createError(400, 'Invalid note title.');
  const notes = (await (await clientFor(uid)).all()).filter(note => note.title);
  if (title !== undefined) {
    const matches = notes.filter(note => normalizeTitle(note.title) === normalizeTitle(title));
    if (!matches.length) throw createError(404, 'This linked note was renamed or deleted, or does not exist yet.');
    if (matches.length > 1) throw createError(409, 'Multiple Drive notes have this title. Give them unique titles before following this link.');
    return { note: publicNote(matches[0]) };
  }
  const searchTitle = value => normalizeTitle(value).normalize('NFKD').replace(/\p{M}/gu, '');
  const term = searchTitle(query);
  return { notes: notes.filter(note => searchTitle(note.title).includes(term))
    .sort((a, b) => a.title.localeCompare(b.title)).slice(0, 20).map(note => ({ title: note.title, source_key: note.source_key })) };
}
async function status(uid, sources) {
  if (!Array.isArray(sources) || sources.length > 200) throw createError(400, 'Invalid note sources.');
  const store = await clientFor(uid), result = [];
  await store.folder();
  for (const source of [...new Set(sources.map(Legacy.key))]) {
    const id = await store.mapping(source);
    if (!id) continue;
    try {
      const file = (await store.request(`drive/v3/files/${id}`, { params: { fields: 'trashed,parents' } })).data;
      if (!file.trashed && file.parents?.includes(store.record.folder_id)) result.push(source);
    } catch (err) { if (err.status !== 404) throw err; }
  }
  return result;
}
async function migrate(uid) {
  return locked(uid, async () => {
    const store = await clientFor(uid, true);
    if (store.record.migrated) return { done: true, remaining: 0 };
    await store.ensureFolder();
    await Legacy.ensureTable();
    // Copy small resumable batches; never remove the original database notes.
    const rows = await sql('SELECT * FROM user_notebook WHERE user_uid=? ORDER BY source_key', [uid]);
    let processed = 0;
    for (const row of rows) {
      const id = await store.reserve(row.source_key);
      let note;
      try { note = await store.read(id, row.source_key); } catch (err) { if (err.status !== 404) throw err; }
      const original = { ...validate({ ...row, tags: row.tags ? JSON.parse(row.tags) : [] }), created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
        updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null };
      if (!note) {
        await store.upload(id, original, null, true);
        note = await store.read(id, row.source_key);
        ++processed;
      }
      if (!note || note.markdown !== original.markdown || note.title !== original.title || note.source_title !== original.source_title || note.source_url !== original.source_url || JSON.stringify(note.tags) !== JSON.stringify(original.tags))
        throw createError(409, 'An existing Drive note differs from the original. Migration stopped without overwriting either copy.');
      await recordCreation(uid, id);
      if (processed >= 20) return { done: false, copied: processed };
    }
    await sql('UPDATE user_notebook_drive SET migrated=1 WHERE user_uid=?', [uid]);
    return { done: true, remaining: 0 };
  });
}
async function exportZip(uid) {
  const zip = new (require('adm-zip'))();
  for (const note of await (await clientFor(uid)).all()) zip.addFile(filename(note), Buffer.from(Legacy.exportMarkdown(note), 'utf8'));
  return zip.toBufferPromise();
}
module.exports = { connectionStatus, connect, disconnect, migrate, get, save, remove, list, status, stats, tagList, links, exportZip,
  expand: async (uid, body) => save(uid, await Legacy.expandedDraft(body)), render: Legacy.render, exportMarkdown: Legacy.exportMarkdown,
  // Pure format and encryption helpers are exported for focused contract tests.
  encode, decode, encrypt, decrypt, validate, Store, SCOPE };
