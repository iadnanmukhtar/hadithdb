'use strict';
const assert = require('assert/strict');
const crypto = require('crypto');
const manifest = require('../../data/yqsirah-hierarchy.json');
const {contentHash} = require('./yqsirah-arabic-repairs');
const revision = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');

function arrange(plan) {
 assert.equal(plan.chapters.length, manifest.chapters.length);
 for (const [index, chapter] of plan.chapters.entries()) {
  const {h1, starts} = manifest.chapters[index];
  assert.equal(h1, index + 1);
  assert.equal(starts[0], chapter.start);
  assert(starts.every((n,i) => n <= chapter.end && (!i || n > starts[i-1])));
  let h2 = 0, h3 = 0;
  for (const entry of chapter.sections) {
   assert.equal(entry.h1, h1);
   const original = {h1:entry.h1, h2:entry.h2, title:entry.title};
   if (starts.includes(entry.num)) { h2++; h3 = 0; } else h3++;
   entry.h2 = h2;
   entry.h3 = h3 || null;
   entry.level = h3 ? 3 : 2;
   const rename = manifest.titles[entry.num];
   if (rename) { assert.equal(entry.title, rename.from); entry.title = rename.to; }
   entry.start = entry.num;
   entry.end = h3 ? entry.num : (starts[h2] || chapter.end + 1) - 1;
   entry.count = entry.end - entry.start + 1;
   // Number within the chapter retains the original passage order, not H2 rank.
   entry.numInChapter = entry.num - chapter.start + 1;
   entry.provenance = {...entry.provenance, hierarchy:{revision, original}};
   entry.sha256 = contentHash(entry);
  }
  assert.equal(h2, starts.length);
 }
 assert(Object.keys(manifest.titles).every(n => plan.entries.some(e => e.num === Number(n))));
 return plan;
}
module.exports = {arrange, revision};
