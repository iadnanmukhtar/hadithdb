'use strict';

const Research = require('./HadithMcpResearch');

const pick = (row, keys) => Object.fromEntries(keys.filter(key => row[key] != null).map(key => [key, row[key]]));
const distinct = rows => [...new Map(rows.map(row => [JSON.stringify(row), row])).values()];

function normalize(metadata = {}, reference, { text = true, maxChars } = {}) {
  const inventory = Research.inventory(metadata, reference);
  return {
    grades: distinct((metadata.grades || []).map(row => ({
      ...pick(row, ['grade', 'grade_en', 'primary', 'source_name', 'book_page', 'source_url']),
      grader: row.grader_name || row.grader || null,
      grader_en: row.grader_name_en || row.grader_en || null
    }))),
    narrators: (metadata.narrators || []).map(row => ({
      ...pick(row, ['id', 'ordinal', 'name_ala_lc', 'reliability', 'death_text', 'generation_name', 'formula', 'flags', 'source_url']),
      name: row.vocalized_name || row.name_tashkil || row.name || null,
      fullname: row.display_fullname || row.fullname || null
    })),
    related_reports: [...new Set(inventory.related_reports.map(entry => entry.reference))],
    sharh: (metadata.sharh || []).map((entry, index) => {
      const commentary = { id: inventory.commentaries[index].id, source: inventory.commentaries[index].source };
      if (entry.source_url) commentary.source_url = entry.source_url;
      if (text) {
        commentary.text_arabic = entry.text ? entry.text.slice(0, maxChars) : null;
        commentary.text_english = entry.text_en ? entry.text_en.slice(0, maxChars) : null;
        commentary.truncated = Boolean(maxChars && (entry.text?.length > maxChars || entry.text_en?.length > maxChars));
      }
      return commentary;
    })
  };
}

// Keep the internal model unchanged; expose one public metadata representation.
function publicJson(value) {
  if (Array.isArray(value)) return value.map(publicJson);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (/hdith/i.test(key) || key === 'similarBooks') continue;
    if (['similar', 'shawahid', 'takhrij'].includes(key) && Array.isArray(child)) {
      output[key] = [...new Set(child.map(entry => typeof entry === 'string' ? entry :
        entry.internal_ref || entry.ref || (entry.book_alias && entry.num ? `${entry.book_alias}:${entry.num}` : null)).filter(Boolean))];
    } else output[key] = publicJson(child);
  }
  if (value.hdithMetadata) {
    output.metadata = normalize(value.hdithMetadata, value.ref);
    output.metadata.related_reports = [...new Set([
      ...output.metadata.related_reports,
      ...['similar', 'shawahid', 'takhrij'].flatMap(key => output[key] || [])
    ])];
    if (output.id != null && output.hId === output.id) delete output.hId;
    for (const key of Object.keys(output)) {
      if (/^(grade_|grader_)/.test(key) || ['similar', 'shawahid', 'takhrij', 'grade', 'grader', 'en', 'ar'].includes(key)) delete output[key];
    }
  }
  return output;
}

module.exports = { normalize, publicJson };
