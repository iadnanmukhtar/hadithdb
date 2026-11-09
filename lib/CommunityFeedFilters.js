'use strict';
const createError = require('http-errors');
function normalize(options = {}) {
  const category = require('./CommunityTaxonomy').category(options.category) || '';
  if (options.tag !== undefined && (typeof options.tag !== 'string' || options.tag.length > 500 || options.tag.includes(','))) throw createError(400, 'Invalid article tag.');
  return {category, tag:(options.tag || '').trim().toLowerCase()};
}
function predicate(filters, scope, params) {
  const clauses = ["p.kind='article'"], prefix = scope === 'mine' ? '' : 'public_';
  if (filters.category) { clauses.push(`p.${prefix}category=?`); params.push(filters.category); }
  if (filters.tag) {
    clauses.push(`LOWER(p.${prefix}tags) REGEXP ?`);
    params.push('(^|,)[[:space:]]*' + filters.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[[:space:]]*(,|$)');
  }
  return clauses.join(' AND ');
}
module.exports = {normalize, predicate};
