'use strict';

const { isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const zlib = require('zlib');

if (isMainThread)
  throw new Error('recompressCachedHtml.js is a worker-only module');

const sourceFile = workerData && workerData.sourceFile;
const cacheDir = workerData && workerData.cacheDir;
if (!sourceFile && !cacheDir)
  process.exit(0);

const gzipForFile = async (source, target) => {
  const raw = await fsPromises.readFile(source);
  const compressed = zlib.gzipSync(raw);
  await fsPromises.writeFile(target, compressed);
};

const deleteSourceFile = async (source) => {
  try {
    await fsPromises.unlink(source);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT')
      return false;
    throw error;
  }
};

const isUpToDate = async (source, compressed) => {
  try {
    const [sourceStats, compressedStats] = await Promise.all([
      fsPromises.stat(source),
      fsPromises.stat(compressed)
    ]);
    return compressedStats.mtimeMs >= sourceStats.mtimeMs;
  } catch (error) {
    return false;
  }
};

(async () => {
  if (sourceFile) {
    const targetFile = `${sourceFile}.gz`;
    try {
      const needsCompression = !(await isUpToDate(sourceFile, targetFile));
      if (needsCompression)
        await gzipForFile(sourceFile, targetFile);
      await deleteSourceFile(sourceFile);
      parentPort && parentPort.postMessage({ type: 'done', file: path.basename(sourceFile), value: 1 });
      process.exit(0);
    } catch (error) {
      parentPort && parentPort.postMessage({ type: 'error', file: path.basename(sourceFile), error: error.message });
      process.exit(1);
    }
  }

  let count = 0;
  let entries = [];
  try {
    entries = await fsPromises.readdir(cacheDir, { withFileTypes: true });
  } catch (error) {
    parentPort && parentPort.postMessage({ type: 'error', file: 'readdir', error: error.message });
    process.exit(0);
  }

  for (const entry of entries) {
    if (!entry || !entry.isFile())
      continue;
    if (!/\.(html|xml|txt|rss|atom|json)$/i.test(entry.name))
      continue;
    const source = path.join(cacheDir, entry.name);
    const compressedFile = `${source}.gz`;
    try {
      if (await isUpToDate(source, compressedFile))
        await deleteSourceFile(source);
      else {
        await gzipForFile(source, compressedFile);
        await deleteSourceFile(source);
        count += 1;
      }
      parentPort && parentPort.postMessage({ type: 'progress', file: entry.name });
    } catch (error) {
      parentPort && parentPort.postMessage({ type: 'error', file: entry.name, error: error.message });
    }
  }

  parentPort && parentPort.postMessage({ type: 'done', value: count });
  process.exit(0);
})();
