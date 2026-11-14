'use strict';
const assert = require('assert/strict');
const crypto = require('crypto');
const manifest = require('../../data/yqsirah-arabic-repairs.json');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const contentHash = entry => digest(JSON.stringify([entry.title, entry.body, entry.footnotes, entry.h1, entry.h2]));
const repairHash = digest(JSON.stringify(manifest));

function repairEntry(entry) {
  const repairs = manifest.repairs.filter(r => r.passage === entry.num);
  if (!repairs.length) return entry;
  assert.equal(contentHash(entry), manifest.original_hashes[entry.num], `Passage ${entry.num}: changed source; refusing repair`);
  const result = {...entry};
  for (const field of ['body', 'footnotes']) {
    const spans = [];
    for (const repair of repairs.filter(r => r.field === field)) {
      let start = result[field].indexOf(repair.old);
      while (start >= 0 && spans.some(s => start < s.end && start + repair.old.length > s.start)) {
        start = result[field].indexOf(repair.old, start + 1);
      }
      assert(start >= 0, `Passage ${entry.num}: missing or overlapping quotation`);
      spans.push({start, end: start + repair.old.length, replacement: repair.new});
    }
    for (const span of spans.sort((a,b) => b.start - a.start)) {
      result[field] = result[field].slice(0, span.start) + span.replacement + result[field].slice(span.end);
    }
    assert.deepEqual(result[field].match(/\[\^[^\]]+\]/g), entry[field].match(/\[\^[^\]]+\]/g), 'Footnote references changed');
    const englishWords = text => text.match(/[A-Za-z]+/g);
    const beforeWords = englishWords(entry[field]), afterWords = englishWords(result[field]);
    // The PDF displaced "I" ahead of the Ta'awwudh sentence in footnote 287.
    if (entry.num === 69 && field === 'footnotes') {
      assert.deepEqual(afterWords.sort(), beforeWords.sort(), 'Ta\'awwudh English words changed');
    } else {
      assert.deepEqual(afterWords, beforeWords, `Passage ${entry.num}: English wording changed`);
    }
  }
  result.provenance = {...entry.provenance, original_content_sha256: entry.sha256 || contentHash(entry), arabic_repair_sha256: repairHash};
  result.sha256 = contentHash(result);
  return result;
}
module.exports = {repairEntry, contentHash, repairHash, manifest};
