'use strict';

const Community = require('./Community');
const Search = require('./HadithMcpSearch');

const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const string = { type: 'string' }, nullableString = { type: ['string', 'null'] };
const postSchema = object({
  id: { type: 'integer' }, title: string, url: string, author: nullableString,
  published_at: nullableString, updated_at: nullableString,
  source_type: { type: 'string', enum: ['editorial_blog'] },
  text: string, truncated: { type: 'boolean' }
});
const DEFINITIONS = [
  { name: 'search_blog', title: 'Search blog',
    description: 'Search published HadithDB blog articles by words or phrases in their public titles and text. Results are editorial discovery candidates, distinct from Quran, hadith, tafsir and shuruh. Verify any cited reports with the source lookup tools. Use lookup_blog_post for complete article text.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', minLength: 1, maxLength: 200 },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
      cursor: { type: 'string', minLength: 1 }
    }, required: ['query'], additionalProperties: false },
    outputProperties: { query: string, results: { type: 'array', items: postSchema }, pagination: object({
      limit: { type: 'integer' }, returned: { type: 'integer' }, offset: { type: 'integer' },
      total_available: { type: ['integer', 'null'] }, total_is_exact: { type: 'boolean' },
      has_more: { type: 'boolean' }, next_cursor: nullableString
    }) } },
  { name: 'lookup_blog_post', title: 'Look up blog post',
    description: 'Retrieve a published blog article by its ID from search_blog. Preserves its author, canonical URL and public Markdown. Editorial interpretation is not independently authenticated scripture. Default bounds text to 6000 characters; full returns the complete article.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'integer', minimum: 1 },
      response_profile: { type: 'string', enum: ['compact', 'default', 'full'], default: 'default' }
    }, required: ['id'], additionalProperties: false },
    outputProperties: { post: postSchema } }
];

// Only public snapshots are readable: pending edits and unfeatured community
// articles must never enter the blog lookup surface.
const FROM = `FROM community_blog_posts b
  JOIN community_posts p ON p.id=b.post_id
  JOIN community_authors a ON a.uid=p.author_uid
  LEFT JOIN community_blog_imports l ON l.post_id=p.id
  WHERE p.status='published' AND p.kind='article'`;
const SELECT = 'SELECT p.id,p.public_title,p.public_markdown,p.published_at,p.updated_at,a.name, a.custom_name,a.handle,l.slug ';
const iso = value => value ? new Date(value).toISOString() : null;
function normalize(row, baseUrl, maxChars) {
  const text = row.public_markdown || '';
  const path = row.slug ? '/blog/' + encodeURIComponent(row.slug) : '/community/@' + encodeURIComponent(row.handle) + '/' + row.id;
  return { id: Number(row.id), title: row.public_title || '', url: new URL(path, baseUrl).href,
    author: require('./CommunityName')(row.name, row.custom_name), published_at: iso(row.published_at), updated_at: iso(row.updated_at),
    source_type: 'editorial_blog', text: text.slice(0, maxChars), truncated: text.length > maxChars };
}
async function searchRows(query, filters, offset, options) {
  const terms = query.split(/\s+/u).filter(Boolean);
  const where = terms.map(() => " AND (p.public_title LIKE ? ESCAPE '!' OR p.public_markdown LIKE ? ESCAPE '!')").join('');
  const values = terms.flatMap(term => {
    const pattern = '%' + term.replace(/[!%_]/g, '!$&') + '%';
    return [pattern, pattern];
  });
  const rows = await Community.sql(SELECT + FROM + where + ' ORDER BY p.published_at DESC,p.id DESC LIMIT ? OFFSET ?', [...values, options.resultSize, offset]);
  // A short page proves exhaustion; otherwise searchPage reads one more page.
  return rows;
}
async function call(name, args, context) {
  await Community.ensure();
  if (name === 'lookup_blog_post') {
    const rows = await Community.sql(SELECT + FROM + ' AND p.id=?', [args.id]);
    if (rows.length !== 1) throw new Error(`Published blog post ${args.id} was not found.`);
    const limit = args.response_profile === 'full' ? Infinity : args.response_profile === 'compact' ? 1500 : 6000;
    return { post: normalize(rows[0], context.baseUrls.hadith, limit) };
  }
  const query = args.query.trim();
  if (!query) throw new Error('query must not be blank.');
  const page = await Search.searchPage({ scope: 'blog', query, limit: args.limit || 10, cursor: args.cursor,
    mapItem: row => normalize(row, context.baseUrls.hadith, 1000), key: post => String(post.id)
  }, { search: searchRows, deadlineMs: context.deadlineMs });
  return { query, ...page };
}

module.exports = { DEFINITIONS, call };
