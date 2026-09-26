'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const Utils = require('../lib/Utils');

describe('browser-ready HTML cache artifacts', () => {
  let directory;
  let fragmentsDirectory;
  let cachedFile;
  let req;

  beforeEach(() => {
	jest.spyOn(Utils, 'diskCacheEnabled').mockReturnValue(true);
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hadithdb-browser-cache-'));
    fragmentsDirectory = path.join(directory, 'fragments');
    fs.mkdirSync(fragmentsDirectory);
    cachedFile = path.join(directory, 'page.html');
    fs.writeFileSync(`${cachedFile}.gz`, zlib.gzipSync(Buffer.from('<html><body>cached page</body></html>')));
    jest.spyOn(Utils, 'htmlCacheFragmentDir').mockReturnValue(fragmentsDirectory);
    req = {
      admin: false,
      editMode: false,
      hostname: 'quran.islamunlocked.com',
      headers: { host: 'quran.islamunlocked.com', 'accept-encoding': 'gzip' },
      originalUrl: '/quran/tafsir/mokhtasar/quran:9:94',
      path: '/quran/tafsir/mokhtasar/quran:9:94',
      get: name => name.toLowerCase() === 'accept-encoding' ? 'gzip' : ''
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('reuses the completed gzip without gunzipping the source cache', () => {
    const first = Utils.readCachedHtmlResponse(cachedFile, req);
    expect(first.complete).toBe(true);
    expect(first.encoding).toBe('gzip');
    expect(zlib.gunzipSync(first.body).toString()).toContain('cached page');

    const artifact = Utils.browserReadyHtmlArtifact(cachedFile, req);
    expect(fs.existsSync(artifact.html)).toBe(false);
    expect(fs.existsSync(artifact.gzip)).toBe(true);

    const gunzip = jest.spyOn(zlib, 'gunzipSync');
    const second = Utils.readCachedHtmlResponse(cachedFile, req);
    expect(second.complete).toBe(true);
    expect(second.encoding).toBe('gzip');
    expect(second.body.equals(fs.readFileSync(artifact.gzip))).toBe(true);
    expect(gunzip).not.toHaveBeenCalled();
  });

  test('serves clients without gzip from the compressed artifact', () => {
    Utils.readCachedHtmlResponse(cachedFile, req);
    req.get = () => '';
    const readSource = jest.spyOn(Utils, 'readCachedHtml');
    const response = Utils.readCachedHtmlResponse(cachedFile, req);
    expect(response.encoding).toBeNull();
    expect(response.complete).toBe(true);
    expect(response.body.toString()).toContain('cached page');
    expect(readSource).not.toHaveBeenCalled();
    expect(fs.existsSync(Utils.browserReadyHtmlArtifact(cachedFile, req).html)).toBe(false);
  });

  test('removes an existing original only after successfully writing gzip', () => {
    const artifact = Utils.browserReadyHtmlArtifact(cachedFile, req);
    fs.writeFileSync(artifact.html, 'old original');
    const write = jest.spyOn(Utils, 'writeFileAtomically').mockImplementation(() => { throw new Error('disk full'); });
    expect(() => Utils.writeBrowserReadyHtmlArtifact(artifact, 'new content')).toThrow('disk full');
    expect(fs.readFileSync(artifact.html, 'utf8')).toBe('old original');
    write.mockRestore();
    Utils.writeBrowserReadyHtmlArtifact(artifact, 'new content');
    expect(fs.existsSync(artifact.html)).toBe(false);
    expect(zlib.gunzipSync(fs.readFileSync(artifact.gzip)).toString()).toBe('new content');
  });

  test('does not create a shared artifact for admin requests', () => {
    req.admin = true;
    req.editMode = true;
    expect(Utils.browserReadyHtmlArtifact(cachedFile, req)).toBeNull();

    const response = Utils.readCachedHtmlResponse(cachedFile, req);
    expect(response.complete).toBe(true);
    expect(response.encoding).toBe('gzip');
    expect(fs.readdirSync(directory).some(filename => filename.includes(Utils.BROWSER_HTML_SUFFIX))).toBe(false);
  });

  test('regenerates artifacts after a shared fragment generation changes', () => {
    Utils.readCachedHtmlResponse(cachedFile, req);
    const artifact = Utils.browserReadyHtmlArtifact(cachedFile, req);
    const originalMtime = fs.statSync(artifact.gzip).mtimeMs;
    const future = new Date(Date.now() + 2000);
    fs.utimesSync(fragmentsDirectory, future, future);

    expect(Utils.isBrowserReadyHtmlArtifactFresh(artifact, `${cachedFile}.gz`)).toBe(false);
    Utils.readCachedHtmlResponse(cachedFile, req);
    expect(fs.statSync(artifact.gzip).mtimeMs).toBeGreaterThanOrEqual(originalMtime);
  });
});
