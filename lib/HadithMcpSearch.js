// @ts-check
'use strict';

const crypto = require('crypto');
const Search = require('./Search');

const CURSOR_VERSION = 1;
const MAX_RAW_RESULTS = 100;
const MAX_LOGICAL_OFFSET = 500;
const MAX_RAW_PAGES_PER_CALL = 6;
const SEARCH_DEADLINE_MS = 10000;
const PAGINATION_DEPTH_ERROR = 'Pagination depth exceeded. Refine the query or restart from an earlier cursor.';

function stableValue(value) {
  if (Array.isArray(value))
    return value.map(stableValue);
  if (!value || typeof value !== 'object')
    return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function searchFingerprint(options) {
  const contract = stableValue({
    scope: options.scope,
    query: options.query,
    filters: options.filters || [],
    searchOptions: options.searchOptions || {}
  });
  return crypto.createHash('sha256').update(JSON.stringify(contract)).digest('hex').slice(0, 24);
}

function encodeCursor(offset, fingerprint) {
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, o: offset, f: fingerprint }), 'utf8').toString('base64url');
}

function decodeCursor(cursor, fingerprint) {
  if (typeof cursor !== 'string' || !cursor || cursor.length > 512)
    throw new Error('Invalid search cursor.');
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed.v !== CURSOR_VERSION || !Number.isInteger(parsed.o) || parsed.o < 0 || parsed.f !== fingerprint)
      throw new Error('Invalid search cursor.');
    return parsed.o;
  } catch (err) {
    throw new Error('Invalid search cursor.');
  }
}

function logicalOffset(options, fingerprint) {
  if (options.cursor !== undefined) {
    if (options.offset !== undefined && options.offset !== 0)
      throw new Error('Use either cursor or offset, not both.');
    return decodeCursor(options.cursor, fingerprint);
  }
  return options.offset || 0;
}

function withDeadline(promise, deadlineAt) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0)
    return Promise.reject(new Error('Search request deadline exceeded.'));
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Search request deadline exceeded.')), remaining);
    })
  ]).finally(() => clearTimeout(timer));
}

async function searchPage(options, context = {}) {
  const fingerprint = searchFingerprint(options);
  const offset = logicalOffset(options, fingerprint);
  if (offset > MAX_LOGICAL_OFFSET)
    throw new Error(PAGINATION_DEPTH_ERROR);
  const search = context.search || Search.a_searchText.bind(Search);
  const results = [];
  const positions = new Map();
  const targetCount = offset + options.limit + 1;
  let rawOffset = 0;
  let rawPagesScanned = 0;
  let rawTotal = null;
  let exhausted = false;
  const deadlineAt = Date.now() + (context.deadlineMs || SEARCH_DEADLINE_MS);
  while (!exhausted && results.length < targetCount && rawPagesScanned < MAX_RAW_PAGES_PER_CALL) {
    const rawResults = await withDeadline(Promise.resolve(search(options.query, options.filters || [], rawOffset, {
      ...(options.searchOptions || {}),
      resultSize: MAX_RAW_RESULTS,
      resultLimit: MAX_RAW_RESULTS * MAX_RAW_PAGES_PER_CALL,
      redactLogs: true
    })), deadlineAt);
    rawPagesScanned += 1;
    const rawPage = Array.isArray(rawResults) ? rawResults : [];
    if (Number.isFinite(rawResults && rawResults.total))
      rawTotal = Math.min(Number(rawResults.total), MAX_RAW_RESULTS * MAX_RAW_PAGES_PER_CALL);
    for (const rawItem of rawPage) {
      const item = options.mapItem(rawItem);
      if (!item)
        continue;
      const key = options.key(item, rawItem);
      if (!key)
        continue;
      if (positions.has(key)) {
        if (options.merge)
          results[positions.get(key)] = options.merge(results[positions.get(key)], item, rawItem);
        continue;
      }
      positions.set(key, results.length);
      results.push(item);
    }
    rawOffset += rawPage.length;
    exhausted = rawPage.length === 0 || (rawTotal !== null ? rawOffset >= rawTotal : rawPage.length < MAX_RAW_RESULTS);
  }
  if (results.length < targetCount && rawPagesScanned >= MAX_RAW_PAGES_PER_CALL && rawOffset >= MAX_RAW_RESULTS * MAX_RAW_PAGES_PER_CALL)
    throw new Error(PAGINATION_DEPTH_ERROR);
  if (offset > results.length)
    throw new Error('Search cursor is past the available results.');
  const pageResults = results.slice(offset, offset + options.limit);
  const nextOffset = offset + pageResults.length;
  const hasMore = nextOffset < results.length;
  return {
    results: pageResults,
    pagination: {
      limit: options.limit,
      returned: pageResults.length,
      offset,
      total_available: exhausted ? results.length : null,
      total_is_exact: exhausted,
      has_more: hasMore,
      next_cursor: hasMore ? encodeCursor(nextOffset, fingerprint) : null
    }
  };
}

module.exports = {
  MAX_LOGICAL_OFFSET,
  MAX_RAW_PAGES_PER_CALL,
  MAX_RAW_RESULTS,
  PAGINATION_DEPTH_ERROR,
  SEARCH_DEADLINE_MS,
  decodeCursor,
  encodeCursor,
  searchFingerprint,
  searchPage
};
