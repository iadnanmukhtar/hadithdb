'use strict';
const communityName = require('./CommunityName');
const crypto = require('crypto');
const { promisify } = require('util');
const createError = require('http-errors');
const { load } = require('cheerio');
const Frontmatter = require('./NotebookFrontmatter');
const Notebook = require('./UserNotebook');
const UserAvatar = require('./UserAvatar');
let ready;
const sql = (statement, values = [], connection = global.dbPool) => promisify(connection.query).call(connection, statement, values);
async function ensure() {
  if (!ready) ready = (async () => {
    const schema = require('fs').readFileSync(require('path').join(__dirname, '../data/migrations/community.sql'), 'utf8');
    for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) await sql(statement);
    await communityName.migrate(sql);
    await require('./CommunityProfileVisibility').migrate(sql);
    await require('./CommunitySubtitle').migrate(sql);
    await require('./CommunityCover').migrate(sql);
    await require('./CommunityAlerts').migrate(sql);
  })().catch(err => { ready = null; throw err; });
  return ready;
}
async function transaction(work) {
  await ensure();
  const connection = await promisify(global.dbPool.getConnection).call(global.dbPool);
  try {
    await promisify(connection.beginTransaction).call(connection);
    const result = await work((statement, values) => sql(statement, values, connection));
    await promisify(connection.commit).call(connection);
    return result;
  } catch (err) { await promisify(connection.rollback).call(connection); throw err; }
  finally { connection.release(); }
}
function id(value) {
  if (!/^[1-9]\d{0,14}$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw createError(400, 'Invalid ID.');
  return Number(value);
}
function text(value, max, label, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw createError(400, `${label} ${required ? 'is required and ' : ''}must be at most ${max} characters.`);
  return value.trim();
}
function nameFor(user) {
  const name = String(user.name || '').trim();
  return !name || name === user.email || /\S+@\S+/.test(name) ? 'Author' : name.slice(0, 120);
}
function moderator(user) { return !!user?.uid && (process.env.COMMUNITY_MODERATOR_UIDS || '').split(',').map(s => s.trim()).filter(Boolean).includes(user.uid); }
async function admin(user) {return !!user?.uid && (user.admin === true || await require('./UserSettings').isAdminUser(user.uid));}
async function markBlog(user,postId,enabled) {
  if(!await admin(user))throw createError(403,'Administrator access required.');
  if(typeof enabled!=='boolean')throw createError(400,'Choose whether to feature this article on the Blog.');
  await transaction(async q=>{
    const row=(await q('SELECT kind,status FROM community_posts WHERE id=? FOR UPDATE',[id(postId)]))[0];
    if(!row)throw createError(404,'Article not found.');
    if(enabled && (row.kind!=='article'||row.status!=='published'))throw createError(400,'Only published articles can be marked as blog posts.');
    if(enabled)await q('INSERT IGNORE INTO community_blog_posts (post_id,marked_by) VALUES (?,?)',[id(postId),user.uid]);
    else await q('DELETE FROM community_blog_posts WHERE post_id=?',[id(postId)]);
  });
  await require('./BlogPageCache').invalidate();
  return {isBlog:enabled};
}
async function blogPosts() {
  await ensure();
  const rows=await sql(`SELECT p.*,a.handle,a.name, a.custom_name FROM community_blog_posts b JOIN community_posts p ON p.id=b.post_id JOIN community_authors a ON a.uid=p.author_uid WHERE p.kind='article' AND p.status='published' AND NOT EXISTS(SELECT 1 FROM community_blog_imports l WHERE l.post_id=p.id) ORDER BY p.published_at DESC,p.id DESC`);
  return rows.map(row=>{
    const article=postView(row);
    return {postId:row.id,authorHandle:row.handle,title:article.title,subtitle:article.subtitle || article.excerpt,html:article.html,cover:article.coverUrl,published:new Date(row.published_at),lastmod:new Date(row.updated_at),url:article.url,author:communityName(row.name, row.custom_name)};
  });
}
async function authorFor(user) {
  await ensure();
  await sql(`INSERT INTO community_authors (uid, handle, name, email, custom_name) VALUES (?, ?, ?, ?, 0)
    ON DUPLICATE KEY UPDATE email=VALUES(email),
      custom_name=IF(custom_name IS NULL OR custom_name=1, BINARY name<>BINARY VALUES(name), 0)`, [user.uid, 'author-' + crypto.randomBytes(8).toString('hex'), nameFor(user), user.email || null]);
  const author = (await sql('SELECT * FROM community_authors WHERE uid=?', [user.uid]))[0];
  await UserAvatar.decorateAuthors([author]);
  return author;
}
function publicAuthor(row) { return { handle: row.handle, name: communityName(row.name, row.custom_name), photo: row.photo, avatarFallback: row.avatarFallback }; }
async function canonicalHandle(handle) {
  await ensure();
  const rows = await sql('SELECT a.handle FROM community_author_aliases x JOIN community_authors a ON a.uid=x.author_uid WHERE x.handle=?', [handle]);
  return rows[0]?.handle || handle;
}
async function profile(handle, user = null) {
  if (!user?.uid) throw createError(401, 'Please sign in to view profiles.');
  handle = await canonicalHandle(handle);
  const row = (await sql(`SELECT a.uid, a.handle, a.name, a.custom_name, a.profile_visibility, a.bio,
    (SELECT COUNT(*) FROM community_follows f WHERE f.author_uid=a.uid) AS followers,
    (SELECT COUNT(*) FROM community_posts p WHERE p.author_uid=a.uid AND p.status='published') AS posts,
    (SELECT COUNT(*) FROM community_follows f WHERE f.follower_uid=a.uid) AS following,
    ((SELECT COUNT(*) FROM community_comments c JOIN community_posts p ON p.id=c.post_id WHERE c.author_uid=a.uid AND c.deleted=0 AND p.status='published') +
     (SELECT COUNT(*) FROM hadiths_comments c WHERE CONVERT(c.user_uid USING utf8mb4) COLLATE utf8mb4_bin=a.uid AND COALESCE(c.deleted,0)=0 AND c.text IS NOT NULL AND TRIM(c.text)<>'') +
     (SELECT COUNT(*) FROM blog_comments c WHERE CONVERT(c.user_uid USING utf8mb4) COLLATE utf8mb4_bin=a.uid AND COALESCE(c.deleted,0)=0 AND c.text IS NOT NULL AND TRIM(c.text)<>'')) AS comments
    FROM community_authors a WHERE a.handle=?`, [handle]))[0];
  require('./CommunityProfileVisibility').check(row, user);
  await UserAvatar.decorateAuthors([row]);
  const { uid, custom_name, ...result } = row;
  result.publicName = communityName(row.name, custom_name);
  result.name = user?.uid && user.uid === uid ? row.name : communityName(row.name, row.custom_name);
  return result;
}
async function saveProfile(user, input) {
  const photo = require('./CommunityProfilePhoto').parse(input.photo);
  const current = await authorFor(user);
  const name = text(input.name, 120, 'Display name', true);
  if (/\S+@\S+/.test(name)) throw createError(400, 'Use a public display name rather than an email address.');
  const Bio = require('../public/static/js/community-bio');
  const bioInput = input.bio === undefined ? '' : input.bio;
  const bioError = Bio.error(bioInput);
  if (bioError) throw createError(400, bioError);
  const bio = Bio.normalize(bioInput);
  const visibility = require('./CommunityProfileVisibility').value(input.visibility, current.profile_visibility || 'public');
  // Handles are permanent once chosen; generated handles may be replaced once.
  const handle = String(input.handle || current.handle).toLowerCase();
  if (!/^[a-z0-9_.-]{3,40}$/.test(handle) || ['following', 'mine', 'write', 'moderation', 'unsubscribe'].includes(handle)) throw createError(400, 'Choose a handle of 3–40 letters, numbers, periods, underscores, or hyphens.');
  if (handle !== current.handle && /^author-[a-f0-9]{16}$/.test(handle)) throw createError(400, 'Choose a personal handle.');
  if (handle !== current.handle && !/^author-[a-f0-9]{16}$/.test(current.handle)) throw createError(400, 'Your public handle is permanent.');
  try {
    await transaction(async q => {
      const result = await q('UPDATE community_authors SET name=?, bio=?, handle=?, custom_name=?, profile_visibility=? WHERE uid=? AND handle=?', [name, bio, handle, name !== nameFor(user) ? 1 : 0, visibility, user.uid, current.handle]);
      if (!result.affectedRows) throw createError(409, 'Your profile changed. Refresh before saving.');
      await require('./CommunityProfilePhoto').save(q, user.uid, photo);
    });
  }
  catch (err) { if (err.code === 'ER_DUP_ENTRY') throw createError(409, 'This handle is taken.'); throw err; }
  await require('./BlogPageCache').invalidate();
  return profile(handle, user);
}
function content(markdown, excerptLimit = 280) {
  const body = Frontmatter.exportFields(text(markdown, 1000000, 'Content', true)).body;
  if (!body.trim()) throw createError(400, 'Content is required.');
  const $ = load(Notebook.render(body), null, false);
  $('[data-notebook-reference], .notebook-expand-reference').remove();
  $('[data-notebook-wiki]').each((_, el) => $(el).replaceWith($(el).contents()));
  // Published HTML must never expose private Drive files or notebook destinations.
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (/drive\.google\.com|docs\.google\.com|(?:^|\/)notebook(?:[/?#]|$)|[?&]note_source=/i.test(href)) $(el).replaceWith($(el).contents());
    else $(el).attr('rel', 'ugc nofollow noopener');
  });
  $('img').each((_, el) => { if (/drive\.google\.com|docs\.google\.com/i.test($(el).attr('src') || '')) $(el).remove(); });
  require('./CommunityMedia').placeholders($);
  require('./CommunityToc')($, body);
  const html = $.html();
  return { markdown: body, html, excerpt: Array.from($.text().trim().replace(/\s+/g, ' ')).slice(0, excerptLimit).join('') };
}
// Truncate rendered text, not Markdown source or HTML, so formatting stays valid.
function feedMarkup(html, limit) {
  const $ = load(html, null, false);
  // Media is displayed once by the feed's existing media preview region.
  $('img,.community-link-preview').remove();
  let remaining = limit;
  function visit(nodes) {
    for (const node of [...nodes]) {
      if (remaining <= 0) { $(node).remove(); continue; }
      if (node.type === 'text') {
        const chars = Array.from(node.data);
        node.data = chars.slice(0, remaining).join('');
        remaining -= Math.min(chars.length, remaining);
      } else if (node.children) visit(node.children);
    }
  }
  visit($.root()[0].children);
  return $.html();
}
function postView(row, owner = false) {
  const title = owner ? row.title : row.public_title;
  const markdown = owner ? row.markdown : row.public_markdown;
  const rendered = content(markdown || ' ', row.kind === 'note' ? 2000 : 280);
  return { id: row.id, kind: row.kind, isBlog: !!row.is_blog, coverUrl: require('./CommunityCover').url(owner ? row.cover_url : row.public_cover_url), subtitle: (owner ? row.subtitle : row.public_subtitle) || '', title: title || (row.kind === 'note' ? 'Post' : 'Untitled article'), html: rendered.html,
    feedHtml: feedMarkup(rendered.html, row.kind === 'note' ? 2000 : 280), excerpt: rendered.excerpt, tags: (owner ? row.tags : row.public_tags) || '', publishedAt: row.published_at,
    author: { handle: row.handle, name: communityName(row.name, row.custom_name) }, url: `/community/@${row.handle}/${row.id}`,
    ...(owner ? { draftTitle: row.title, markdown: markdown || '', status: row.status, version: row.version, notifyEmail: !!row.notify_email, updatedAt: row.updated_at } : {}) };
}
async function post(postId, user = null, editing = false) {
  await ensure();
  const row = (await sql('SELECT p.*, a.handle, a.name, a.custom_name, EXISTS(SELECT 1 FROM community_hadith_posts hp WHERE hp.post_id=p.id) AS is_hadith_activity, EXISTS(SELECT 1 FROM community_blog_posts b WHERE b.post_id=p.id) AS is_blog FROM community_posts p JOIN community_authors a ON a.uid=p.author_uid WHERE p.id=?', [id(postId)]))[0];
  const owner = !!user && row?.author_uid === user.uid;
  if (!row || row.status === 'deleted' || (row.status !== 'published' && !owner && !moderator(user)) || (editing && !owner)) throw createError(404, 'Post not found.');
  if (editing && row.is_hadith_activity) throw createError(403, 'Generated hadith activity cannot be edited.');
  const result = {...postView(row, editing || row.status !== 'published'), generatedActivity:!!row.is_hadith_activity};
  await UserAvatar.decorateAuthors([result.author]);
  await require('./CommunityBlogImport').decorate([result]);
  return result;
}
async function queueEmails(q, postId) {
  await q(`INSERT IGNORE INTO community_email_outbox (post_id, follower_uid)
    SELECT p.id, f.follower_uid FROM community_posts p JOIN community_follows f ON f.author_uid=p.author_uid
    WHERE p.id=? AND p.status='published' AND p.kind='article' AND p.notify_email=1 AND f.email_enabled=1
    AND f.created_at<=p.published_at`, [postId]);
}
async function savePost(user, input, postId = null) {
  const author = await authorFor(user);
  const kind = input.kind;
  if (!['note', 'article'].includes(kind)) throw createError(400, 'Choose a post or article.');
  const title = text(input.title || '', 240, 'Title', kind === 'article');
  const requestedSubtitle = input.subtitle === undefined ? undefined : text(input.subtitle, 1000, 'Subtitle');
  const markdown = content(input.markdown).markdown;
  const tags = text(input.tags || '', 500, 'Tags');
  const action = input.action || 'draft';
  if (!['draft', 'publish', 'unpublish'].includes(action)) throw createError(400, 'Invalid publication action.');
  const notify = input.notifyEmail === true && kind === 'article';
  const publishingAdmin = action === 'publish' && await admin(user);
  if(action==='publish') await require('./CommunityMedia').prepare(markdown);
  const savedId = await transaction(async q => {
    let row = null;
    if (postId) {
      row = (await q('SELECT * FROM community_posts WHERE id=? FOR UPDATE', [id(postId)]))[0];
      if (!row || row.status === 'deleted' || row.author_uid !== user.uid) throw createError(404, 'Post not found.');
      if (Number(input.version) !== row.version) throw createError(409, 'This post changed in another tab. Reopen it before saving.');
      if (kind !== row.kind && !(row.kind==='note' && kind==='article' && input.convertToArticle===true && row.status!=='hidden')) throw createError(400, 'The post type cannot be changed after saving.');
      if ((await q('SELECT post_id FROM community_hadith_posts WHERE post_id=?',[id(postId)])).length) throw createError(403, 'Generated hadith activity cannot be edited.');
      if (action === 'publish' && !publishingAdmin && (await q('SELECT post_id FROM community_blog_posts WHERE post_id=?',[id(postId)])).length) throw createError(403, 'Only administrators can publish blog articles.');
    }
    if (row?.status === 'hidden' && action === 'publish') throw createError(403, 'A moderator must restore this post before it can be published.');
    let status = row?.status || 'draft';
    if (action === 'publish') status = author.trusted || moderator(user) || publishingAdmin ? 'published' : 'pending';
    if (action === 'unpublish' && status !== 'hidden') status = 'draft';
    if(row?.kind==='note' && kind==='article') status='draft';
    const publishing = action === 'publish' && status === 'published';
    const publishedAt = row?.published_at || null;
    const publishedTimeSql = publishing ? 'COALESCE(?, CURRENT_TIMESTAMP(3))' : '?';
    const version = (row?.version || 0) + 1;
    const subtitle = kind === 'article' ? requestedSubtitle ?? row?.subtitle ?? '' : '';
    const cover = await require('./CommunityCover').validate(q,user,input.coverUrl,row?.cover_url);
    const values = [title, subtitle, cover, markdown, tags, status, version, notify ? 1 : 0,
      publishing ? title : row?.public_title ?? null, publishing ? subtitle : row?.public_subtitle ?? null, publishing ? cover : row?.public_cover_url ?? null, publishing ? markdown : row?.public_markdown ?? null,
      publishing ? tags : row?.public_tags ?? null, publishedAt];
    let saved = postId;
    if (row) await q(`UPDATE community_posts SET title=?, subtitle=?, cover_url=?, markdown=?, tags=?, status=?, version=?, notify_email=?,
      public_title=?, public_subtitle=?, public_cover_url=?, public_markdown=?, public_tags=?, published_at=${publishedTimeSql}, updated_at=CURRENT_TIMESTAMP(3),kind=? WHERE id=?`, [...values, kind, id(postId)]);
    else saved = (await q(`INSERT INTO community_posts (title, subtitle, cover_url, markdown, tags, status, version, notify_email,
      public_title, public_subtitle, public_cover_url, public_markdown, public_tags, published_at, author_uid, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${publishedTimeSql}, ?, ?)`, [...values, user.uid, kind])).insertId;
    await q('INSERT INTO community_revisions (post_id, version, title, subtitle, cover_url, markdown, tags) VALUES (?, ?, ?, ?, ?, ?, ?)', [saved, version, title, subtitle, cover, markdown, tags]);
    if (publishing && !row?.published_at) await queueEmails(q, saved);
    return saved;
  });
  if (kind === 'article') await require('./BlogPageCache').invalidate();
  return post(savedId, user, true);
}
async function deletePost(user, postId, version) {
  await transaction(async q=>{
    const row=(await q('SELECT author_uid,status,version FROM community_posts WHERE id=? FOR UPDATE',[id(postId)]))[0];
    if(!user?.uid || !row || row.author_uid!==user.uid)throw createError(404,'Post not found.');
    if(row.status==='deleted')return;
    if(Number(version)!==row.version)throw createError(409,'This post changed. Reopen it before deleting.');
    await q("UPDATE community_posts SET status='deleted',version=version+1,updated_at=CURRENT_TIMESTAMP(3) WHERE id=?",[id(postId)]);
    const legacy=(await q('SELECT slug FROM community_blog_imports WHERE post_id=?',[id(postId)]))[0];
    if(legacy)await q('UPDATE blog_comments SET deleted=1 WHERE post_slug=?',[legacy.slug]);
    await q("UPDATE community_email_outbox SET status='cancelled' WHERE post_id=? AND status IN ('queued','sending')",[id(postId)]);
  });
  await require('./BlogPageCache').invalidate();
}
async function feed(options = {}, user = null) {
  await ensure();
  const scope = ['everyone', 'following', 'mine'].includes(options.scope) ? options.scope : 'everyone';
  const kind = ['all', 'article', 'note', 'comment', 'like'].includes(options.kind) ? options.kind : 'all';
  if (scope !== 'everyone' && !user) throw createError(401, 'Please sign in to see your wall.');
  const offset = Number(options.offset || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) throw createError(400, 'Invalid page.');
  if (options.author && (typeof options.author !== 'string' || !/^[a-z0-9_.-]{3,40}$/.test(options.author))) throw createError(400, 'Invalid author handle.');
  if (options.author) options = {...options, author:await canonicalHandle(options.author)};
  const author = options.author ? (await sql('SELECT uid, profile_visibility FROM community_authors WHERE handle=?', [options.author]))[0] : null;
  if (options.author) require('./CommunityProfileVisibility').check(author, user);
  const params = [];
  let where = scope === 'mine' ? "p.author_uid=? AND p.status<>'deleted'" : "p.status='published'";
  if (scope === 'mine') params.push(user.uid);
  if (scope === 'following') { where += ' AND EXISTS (SELECT 1 FROM community_follows f WHERE f.author_uid=p.author_uid AND f.follower_uid=?)'; params.push(user.uid); }
  if (author) { where += ' AND p.author_uid=?'; params.push(author.uid); }
  if (kind === 'article' || kind === 'note') { where += ' AND p.kind=?'; params.push(kind); }
  const posts = ['comment','like'].includes(kind) ? [] : await sql(`SELECT p.*, a.handle, a.name, a.custom_name, EXISTS(SELECT 1 FROM community_hadith_posts hp WHERE hp.post_id=p.id) AS is_hadith_activity,
    (SELECT COUNT(*) FROM community_comments c WHERE c.post_id=p.id AND c.deleted=0) AS comment_count
    FROM community_posts p JOIN community_authors a ON a.uid=p.author_uid WHERE ${where}
    ORDER BY ${scope === 'mine' ? 'COALESCE(p.published_at,p.updated_at)' : 'p.published_at'} DESC, p.id DESC LIMIT ?`, [...params, offset + 21]);
  let comments = [];
  if (kind === 'all' || kind === 'comment') {
    let cwhere = "p.status='published' AND c.deleted=0";
    const cparams = [];
    if (scope === 'mine') { cwhere += ' AND c.author_uid=?'; cparams.push(user.uid); }
    if (scope === 'following') { cwhere += ' AND EXISTS (SELECT 1 FROM community_follows f WHERE f.author_uid=c.author_uid AND f.follower_uid=?)'; cparams.push(user.uid); }
    if (author) { cwhere += ' AND c.author_uid=?'; cparams.push(author.uid); }
    comments = await sql(`SELECT c.id, c.markdown, c.created_at, p.id AS post_id, p.public_title AS post_title,
      a.handle, a.name, a.custom_name, pa.handle AS post_handle FROM community_comments c
      JOIN community_posts p ON p.id=c.post_id JOIN community_authors a ON a.uid=c.author_uid
      JOIN community_authors pa ON pa.uid=p.author_uid WHERE ${cwhere}
      ORDER BY c.created_at DESC, c.id DESC LIMIT ?`, [...cparams, offset + 21]);
  }
  const items = posts.map(row => {
    const { html, markdown, ...summary } = postView(row, scope === 'mine');
    return { ...summary, canEdit: !!user && row.author_uid === user.uid && !row.is_hadith_activity, mediaHtml: (summary.coverUrl ? content('![Article cover]('+encodeURI(summary.coverUrl)+')').html : '') + require('./CommunityMedia').extract(html), activity: 'post', commentCount: row.comment_count, activityAt: row.published_at || row.updated_at };
  });
  for (const c of comments) items.push({ id: c.id, activity: 'comment', kind: 'comment', author: { handle: c.handle, name: communityName(c.name, c.custom_name) },
    title: c.post_title || 'Post', excerpt: content(c.markdown).excerpt, html: content(c.markdown).html, activityAt: c.created_at,
    url: `/community/@${c.post_handle}/${c.post_id}#comment-${c.id}` });
  if (kind === 'all' || kind === 'comment') items.push(...await require('./CommunityReflections').feed(sql, { scope, user, author, limit: offset + 21 }));
  if (kind === 'all' || kind === 'like') items.push(...await require('./CommunityLikes').feed(sql, { scope, user, author, limit: offset + 21 }, content));
  if (kind === 'all') items.push(...await require('./CommunityInteractions').feed(sql, {scope,user,author,limit:offset+21},kind));
  items.sort((a, b) => new Date(b.activityAt) - new Date(a.activityAt) || Number(b.id) - Number(a.id) || a.activity.localeCompare(b.activity));
  const pageItems = items.slice(offset, offset + 20);
  await require('./CommunityHadithPosts').decorate(pageItems);
  await require('./CommunityBlogImport').decorate(pageItems);
  await require('./CommunityLikes').decorate(sql, pageItems, user);
  await require('./CommunityInteractions').decorate(sql,pageItems,user);
  await UserAvatar.decorateAuthors(pageItems.map(item=>item.author));
  return { items: pageItems, hasMore: items.length > offset + 20, offset: offset + 20 };
}
async function recordReflectionVote(user, source, targetId, direction) {
  if (!['hadiths_comments','blog_comments'].includes(source)) throw createError(400, 'Invalid reflection source.');
  await authorFor(user);
  if (direction === 'up') await sql('INSERT IGNORE INTO community_likes (source,target_id,user_uid) VALUES (?,?,?)',[source,id(targetId),user.uid]);
  else await sql('DELETE FROM community_likes WHERE source=? AND target_id=? AND user_uid=?',[source,id(targetId),user.uid]);
  await sql('DELETE FROM community_dislikes WHERE source=? AND target_id=? AND user_uid=?', [source,id(targetId),user.uid]);
  if (direction === 'down') await sql('INSERT INTO community_dislikes (source,target_id,user_uid,created_at) VALUES (?,?,?,CURRENT_TIMESTAMP(3))', [source,id(targetId),user.uid]);
}
async function like(user, source, targetId, enabled) {
  if (typeof enabled !== 'boolean') throw createError(400, 'Choose like or unlike.');
  await authorFor(user);
  return transaction(q => require('./CommunityLikes').set(q, source, id(targetId), user, enabled));
}
async function contributors(user = null) {
  await ensure();
  const rows = await sql(`SELECT a.handle,a.name, a.custom_name,SUM(activity.n) AS contributions,
    MAX(f.follower_uid IS NOT NULL) AS following,MAX(COALESCE(f.email_enabled,0)) AS email
    FROM (
      SELECT author_uid AS uid,COUNT(*) AS n FROM community_posts WHERE status='published' GROUP BY author_uid
      UNION ALL SELECT c.author_uid,COUNT(*) FROM community_comments c JOIN community_posts p ON p.id=c.post_id WHERE c.deleted=0 AND p.status='published' GROUP BY c.author_uid
      UNION ALL SELECT CONVERT(user_uid USING utf8mb4) COLLATE utf8mb4_bin,COUNT(*) FROM hadiths_comments WHERE COALESCE(deleted,0)=0 AND text IS NOT NULL AND TRIM(text)<>'' GROUP BY CONVERT(user_uid USING utf8mb4) COLLATE utf8mb4_bin
      UNION ALL SELECT CONVERT(user_uid USING utf8mb4) COLLATE utf8mb4_bin,COUNT(*) FROM blog_comments WHERE COALESCE(deleted,0)=0 AND text IS NOT NULL AND TRIM(text)<>'' GROUP BY CONVERT(user_uid USING utf8mb4) COLLATE utf8mb4_bin
    ) activity JOIN community_authors a ON a.uid=activity.uid
    LEFT JOIN community_follows f ON f.author_uid=a.uid AND f.follower_uid=?
    WHERE a.uid NOT LIKE 'legacy-reflection:%'
    GROUP BY a.uid,a.handle,a.name, a.custom_name ORDER BY contributions DESC,a.name,a.handle LIMIT 5`, [user?.uid || null]);
  await UserAvatar.decorateAuthors(rows);
  return rows.map(row=>({...row,name:communityName(row.name, row.custom_name),contributions:Number(row.contributions),following:!!row.following,email:!!row.email}));
}
async function follow(user, handle, enabled, email) {
  handle = await canonicalHandle(handle);
  const me = await authorFor(user);
  const target = (await sql('SELECT uid FROM community_authors WHERE handle=?', [handle]))[0];
  if (!target) throw createError(404, 'Author not found.');
  if (me.uid === target.uid) throw createError(400, 'You cannot follow yourself.');
  if (enabled && email && !me.email) throw createError(400, 'An account email is required for email subscriptions.');
  if (!enabled) await sql('DELETE FROM community_follows WHERE follower_uid=? AND author_uid=?', [user.uid, target.uid]);
  else await sql(`INSERT INTO community_follows (follower_uid, author_uid, email_enabled, unsubscribe_token) VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE email_enabled=VALUES(email_enabled)`, [user.uid, target.uid, email ? 1 : 0, crypto.randomBytes(32).toString('hex')]);
  return { following: !!enabled, email: !!enabled && !!email };
}
async function relationship(user, handle) {
  handle = await canonicalHandle(handle);
  await ensure();
  const rows = await sql(`SELECT f.email_enabled FROM community_follows f JOIN community_authors a ON a.uid=f.author_uid WHERE f.follower_uid=? AND a.handle=?`, [user.uid, handle]);
  return { following: !!rows.length, email: !!rows[0]?.email_enabled };
}
async function subscriptions(user) {
  await ensure();
  const rows = await sql(`SELECT a.handle, a.name, a.custom_name, f.email_enabled AS email FROM community_follows f JOIN community_authors a ON a.uid=f.author_uid WHERE f.follower_uid=? ORDER BY a.name`, [user.uid]);
  return rows.map(row => ({...row, name: communityName(row.name, row.custom_name)}));
}
async function followers(user, offset = 0) {
  await ensure();
  offset = Number(offset);
  if (!Number.isSafeInteger(offset) || offset < 0) throw createError(400, 'Invalid page.');
  const rows = await sql(`SELECT a.handle, a.name, a.custom_name FROM community_follows f JOIN community_authors a ON a.uid=f.follower_uid WHERE f.author_uid=? ORDER BY a.name, a.handle LIMIT 51 OFFSET ?`, [user.uid, offset]);
  const items = rows.slice(0, 50).map(row => ({...row, name: communityName(row.name, row.custom_name)}));
  await UserAvatar.decorateAuthors(items);
  return {items, hasMore:rows.length > 50};
}
async function unsubscribe(token) {
  await ensure();
  if (!/^[a-f0-9]{64}$/.test(token)) throw createError(400, 'Invalid unsubscribe link.');
  await sql('UPDATE community_follows SET email_enabled=0 WHERE unsubscribe_token=?', [token]);
}
async function comments(postId, user = null) {
  await post(postId); // No draft or hidden discussion may be read publicly.
  const rows = await sql(`SELECT c.*, a.name, a.custom_name, a.handle FROM community_comments c JOIN community_authors a ON a.uid=c.author_uid WHERE c.post_id=? ORDER BY c.created_at, c.id LIMIT 1000`, [id(postId)]);
  const result = rows.map(c => ({ id: c.id, parentId: c.parent_id, deleted: !!c.deleted, html: c.deleted ? '' : content(c.markdown).html,
    author: { handle: c.handle, name: communityName(c.name, c.custom_name) }, likeSource: 'comment', likeId: c.id, createdAt: c.created_at, canDelete: !!user && (user.uid === c.author_uid || moderator(user)) }));
  await require('./CommunityLikes').decorate(sql, result.filter(comment => !comment.deleted), user);
  await require('./CommunityInteractions').decorate(sql, result.filter(comment => !comment.deleted), user);
  await UserAvatar.decorateAuthors(result.map(comment=>comment.author));
  return result;
}
async function addComment(user, postId, input) {
  await authorFor(user);
  const markdown = content(text(input.markdown, 10000, 'Comment', true)).markdown;
  const parent = input.parentId ? id(input.parentId) : null;
  await transaction(async q => {
    const target = (await q('SELECT status FROM community_posts WHERE id=? FOR UPDATE', [id(postId)]))[0];
    if (!target || target.status !== 'published') throw createError(404, 'Post not found.');
    if (parent && !(await q('SELECT id FROM community_comments WHERE id=? AND post_id=? AND deleted=0', [parent, id(postId)])).length) throw createError(400, 'Reply target not found in this discussion.');
    await q('INSERT INTO community_comments (post_id, parent_id, author_uid, markdown) VALUES (?, ?, ?, ?)', [id(postId), parent, user.uid, markdown]);
  });
  return comments(postId, user);
}
async function deleteComment(user, commentId) {
  await ensure();
  const row = (await sql('SELECT author_uid FROM community_comments WHERE id=?', [id(commentId)]))[0];
  if (!row || (row.author_uid !== user.uid && !moderator(user))) throw createError(404, 'Comment not found.');
  await sql('UPDATE community_comments SET deleted=1, markdown=\'\' WHERE id=?', [id(commentId)]);
}
async function report(user, postId, input) {
  await post(postId);
  const reason = text(input.reason, 1000, 'Reason', true);
  const commentId = input.commentId ? id(input.commentId) : 0;
  if (commentId && !(await sql('SELECT id FROM community_comments WHERE id=? AND post_id=? AND deleted=0', [commentId, id(postId)])).length) throw createError(404, 'Comment not found.');
  await sql(`INSERT INTO community_reports (reporter_uid, post_id, comment_id, reason) VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE reason=VALUES(reason), resolved=0`, [user.uid, id(postId), commentId, reason]);
}
async function moderation(user) {
  if (!moderator(user)) throw createError(403, 'Moderator access required.');
  await ensure();
  const pending = await sql(`SELECT p.*, a.handle, a.name, a.custom_name, EXISTS(SELECT 1 FROM community_hadith_posts hp WHERE hp.post_id=p.id) AS is_hadith_activity, EXISTS(SELECT 1 FROM community_blog_posts b WHERE b.post_id=p.id) AS is_blog FROM community_posts p JOIN community_authors a ON a.uid=p.author_uid WHERE p.status IN ('pending','hidden') ORDER BY p.updated_at LIMIT 100`);
  const reports = await sql(`SELECT r.id, r.post_id, r.comment_id, r.reason, p.public_title AS title, a.handle FROM community_reports r JOIN community_posts p ON p.id=r.post_id JOIN community_authors a ON a.uid=p.author_uid WHERE r.resolved=0 ORDER BY r.created_at LIMIT 100`);
  return { pending: pending.map(p => postView(p, true)), reports };
}
async function moderate(user, postId, input) {
  if (!moderator(user)) throw createError(403, 'Moderator access required.');
  if (!['approve', 'hide', 'resolve'].includes(input.action)) throw createError(400, 'Invalid moderation action.');
  await transaction(async q => {
    const row = (await q('SELECT * FROM community_posts WHERE id=? FOR UPDATE', [id(postId)]))[0];
    if (!row || row.status === 'deleted') throw createError(404, 'Post not found.');
    if (input.action === 'approve') {
      if ((await q('SELECT post_id FROM community_blog_posts WHERE post_id=?',[id(postId)])).length && !await admin(user)) throw createError(403, 'Only administrators can publish blog articles.');
      if (!['pending', 'hidden'].includes(row.status)) throw createError(409, 'This post is no longer awaiting approval.');
      if (Number(input.version) !== row.version) throw createError(409, 'The draft changed. Review the latest version.');
      await q(`UPDATE community_posts SET status='published', public_title=title, public_subtitle=subtitle, public_cover_url=cover_url, public_markdown=markdown, public_tags=tags,
        published_at=COALESCE(published_at, CURRENT_TIMESTAMP(3)), version=version+1 WHERE id=?`, [id(postId)]);
      await q('UPDATE community_authors SET trusted=1 WHERE uid=?', [row.author_uid]);
      if (!row.published_at) await queueEmails(q, id(postId));
    } else if (input.action === 'hide') {
      if (input.commentId) await q('UPDATE community_comments SET deleted=1, markdown=\'\' WHERE id=? AND post_id=?', [id(input.commentId), id(postId)]);
      else await q("UPDATE community_posts SET status='hidden', version=version+1 WHERE id=?", [id(postId)]);
    }
    await q('UPDATE community_reports SET resolved=1 WHERE post_id=? AND comment_id=?', [id(postId), input.commentId ? id(input.commentId) : 0]);
  });
  if (!input.commentId && input.action !== 'resolve') await require('./BlogPageCache').invalidate();
}
module.exports = { admin,markBlog,blogPosts,ensure, sql, transaction, id, content, authorFor, publicAuthor, profile, saveProfile, moderator,
  post, postView, savePost, deletePost, feed, like, recordReflectionVote, contributors, follow, relationship, subscriptions, followers, unsubscribe, comments, addComment, deleteComment, report, moderation, moderate };
