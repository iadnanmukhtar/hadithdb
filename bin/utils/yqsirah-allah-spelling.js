'use strict';
const {contentHash} = require('./yqsirah-arabic-repairs');
function normalizeAllahSpelling(entry) {
  const count = [entry.body,entry.footnotes].reduce((n,text)=>n+(text.match(/هللا|ﻭﻪﻠﻟﺍ/g)||[]).length,0);
  if (!count) return entry;
  const result = {...entry,body:entry.body.replace(/هللا|ﻭﻪﻠﻟﺍ/g,word=>word==='هللا'?'الله':'والله'),footnotes:entry.footnotes.replace(/هللا|ﻭﻪﻠﻟﺍ/g,word=>word==='هللا'?'الله':'والله')};
  result.provenance = {...entry.provenance,pre_allah_spelling_sha256:contentHash(entry),allah_spelling_replacements:count};
  result.sha256 = contentHash(result);
  return result;
}
module.exports = {normalizeAllahSpelling};
