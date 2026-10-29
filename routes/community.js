'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const GoogleAuth = require('../lib/GoogleAuth');
const Community = require('../lib/Community');
const router = express.Router();
router.use(require('../lib/BlogPageCache').middleware({ community: true }));
const api = express.Router();
const wrap = work => (req, res, next) => Promise.resolve(work(req, res)).catch(next);
const writeLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: req => req.user.uid, message: { error: 'Too many changes. Please try again shortly.' } });
api.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); res.set('X-Robots-Tag', 'noindex'); next(); });
api.use(async (req, res, next) => {
  try {
    req.user = await GoogleAuth.verifyRequest(req);
    if (req.method !== 'GET' && !req.user) return res.status(401).json({ error: 'Please sign in to participate.' });
    next();
  } catch (_) {
    // An expired session must not block public reading; private GET handlers still enforce ownership.
    if (req.method === 'GET') { req.user = null; return next(); }
    res.status(401).json({ error: 'Please sign in again.' });
  }
});
api.use((req, res, next) => req.method === 'GET' ? next() : writeLimit(req, res, next));
function signed(req) { if (!req.user) throw require('http-errors')(401, 'Please sign in.'); return req.user; }
api.get('/me', wrap(async (req, res) => {
  const author = await Community.authorFor(signed(req));
  res.json({ author: await Community.profile(author.handle, req.user), moderator: Community.moderator(req.user), admin: await Community.admin(req.user), subscriptions: await Community.subscriptions(req.user) });
}));
const Alerts = require('../lib/CommunityAlerts');
api.get('/alerts', wrap(async (req, res) => res.json(await Alerts.unread(signed(req)))));
api.put('/alerts/read', wrap(async (req, res) => res.json(await Alerts.markRead(signed(req), req.body.through))));
api.get('/me/followers', wrap(async (req, res) => res.json(await Community.followers(signed(req), req.query.offset))));
api.put('/profile', wrap(async (req, res) => res.json({ author: await Community.saveProfile(req.user, req.body) })));
api.put('/likes/:source/:id', wrap(async (req, res) => res.json(await Community.like(req.user, req.params.source, req.params.id, req.body.liked))));
const Interactions = require('../lib/CommunityInteractions');
const Media = require('../lib/CommunityMedia');
api.post('/media', express.raw({type:()=>true,limit:'5mb'}), wrap(async(req,res)=>res.status(201).json(await Media.upload(signed(req),req.body))));
// Older cached cards may still request the retired generated artwork URL.
api.get('/source-preview-image', (req,res)=>{
  const data=require('../lib/CommunitySourcePreview').preview(req.query.url);
  if(!data)return res.status(404).end();
  res.redirect(data.image);
});
api.get('/link-preview-image', (req,res)=>{
  const data=require('../lib/CommunitySourcePreview').preview(req.query.url);
  if(!data)return res.status(404).end();
  res.redirect(data.image);
});
api.get('/link-preview',wrap(async(req,res)=>res.json(await Media.preview(req.query.url))));
api.post('/link-preview',wrap(async(req,res)=>res.json(await Media.preview(req.body.url,true))));
api.put('/votes/:source/:id', wrap(async (req,res)=>res.json(await Interactions.vote(signed(req),req.params.source,req.params.id,req.body.direction))));
api.put('/reposts/:source/:id', wrap(async (req,res)=>res.json(await Interactions.repost(signed(req),req.params.source,req.params.id,req.body.reposted))));
api.get('/discussion/:source/:id', wrap(async (req,res)=>res.json(await Interactions.discussion(req.params.source,req.params.id,req.user,req.query.offset))));
api.post('/discussion/:source/:id', wrap(async (req,res)=>res.status(201).json(await Interactions.reply(signed(req),req.params.source,req.params.id,req.body))));
api.get('/contributors', wrap(async (req, res) => res.json({contributors:await Community.contributors(req.user)})));
api.get('/feed', wrap(async (req, res) => res.json(await Community.feed(req.query, req.user))));
api.get('/authors/:handle', wrap(async (req, res) => res.json({author:await Community.profile(req.params.handle, signed(req))})));
api.get('/authors/:handle/relationship', wrap(async (req, res) => res.json(await Community.relationship(signed(req), req.params.handle))));
api.put('/authors/:handle/follow', wrap(async (req, res) => {
  if (typeof req.body.following !== 'boolean' || typeof req.body.email !== 'boolean') return res.status(400).json({ error: 'Choose following and email preferences.' });
  res.json(await Community.follow(req.user, req.params.handle, req.body.following, req.body.email));
}));
api.post('/preview', wrap(async (req, res) => res.json(await Media.prepare(req.body.markdown))));
api.get('/notebook-copy', wrap(async (req, res) => {
  const user = signed(req);
  const note = await require('../lib/NotebookDrive').get(user.uid, req.query.source);
  if (!note) return res.status(404).json({ error: 'Note not found.' });
  const rendered = Community.content(note.markdown);
  // Copy only the body, preserving Markdown and bilingual layouts. Public rendering strips private destinations.
  const markdown = rendered.markdown.replace(/\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/g, (_match, _target, label) => label || 'Private note');
  res.json({ title: note.title || '', markdown, tags: (note.tags || []).join(', ') });
}));
api.put('/posts/:id/blog',wrap(async(req,res)=>res.json(await Community.markBlog(signed(req),req.params.id,req.body.enabled))));
api.post('/posts', wrap(async (req, res) => res.status(201).json({ post: await Community.savePost(req.user, req.body) })));
api.get('/posts/:id', wrap(async (req, res) => res.json({ post: await Community.post(req.params.id, req.user, req.query.edit === '1') })));
api.delete('/posts/:id', wrap(async(req,res)=>{await Community.deletePost(signed(req),req.params.id,req.body.version);res.json({deleted:true});}));
api.put('/posts/:id', wrap(async (req, res) => res.json({ post: await Community.savePost(req.user, req.body, req.params.id) })));
api.get('/posts/:id/comments', wrap(async (req, res) => res.json({ comments: await Community.comments(req.params.id, req.user) })));
api.post('/posts/:id/comments', wrap(async (req, res) => res.status(201).json({ comments: await Community.addComment(req.user, req.params.id, req.body) })));
api.delete('/comments/:id', wrap(async (req, res) => { await Community.deleteComment(req.user, req.params.id); res.json({ deleted: true }); }));
api.post('/posts/:id/report', wrap(async (req, res) => { await Community.report(req.user, req.params.id, req.body); res.json({ reported: true }); }));
api.get('/moderation', wrap(async (req, res) => res.json(await Community.moderation(signed(req)))));
api.post('/posts/:id/moderation', wrap(async (req, res) => { await Community.moderate(req.user, req.params.id, req.body); res.json({ saved: true }); }));
api.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (!err.status || err.status >= 500) console.error('Community request failed:', err.code || err.message);
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Community is temporarily unavailable. Please try again.' });
});
function page(res, req, view, extra = {}) {
  const titles = { everyone: 'Community', following: 'Following', mine: 'My Profile', write: 'Write an article', moderation: 'Community moderation', unsubscribe: 'Email preferences' };
  const title = extra.post?.title || extra.author?.name || titles[view] || 'Community';
  res.locals.req = req; res.locals.res = res;
  res.set('Cache-Control', 'private, no-store');
  res.render('community', { view, author: null, post: null, initial: null, unsubscribed: false, ...extra,
    page: { menu: 'Community', title_en: title, description_en: extra.post?.subtitle || extra.post?.excerpt || 'Reader posts, articles, and conversations about Quran and hadith.',
      canonical: extra.post?.url || (req.path === '/' ? '/community' : '/community' + req.path),
      noindex: ['author', 'mine', 'following', 'write', 'moderation', 'unsubscribe'].includes(view), context: { communityView: view, federationEnabled: require('../lib/ActivityPub').enabled() },
      ...require('../lib/CommunitySocialMetadata')(view,extra) } });
}
router.get('/profile-photo/:handle/:hash', wrap(async (req, res) => {
  const data = await require('../lib/CommunityProfilePhoto').image(req.params.handle, req.params.hash);
  res.set({'Content-Type':'image/png','Cache-Control':'private, no-cache','X-Content-Type-Options':'nosniff'});
  res.send(data);
}));
router.get('/media/:id',wrap(async(req,res)=>{
  let user=null;try{user=await GoogleAuth.verifyRequest(req);}catch{}
  const image=await Media.image(req.params.id,user);
  res.set({'Content-Type':image.mime,'Cache-Control':image.cacheable?'private, no-cache':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"});
  if(image.cacheable){
    res.set('ETag','"'+require('crypto').createHash('sha256').update(image.data).digest('hex')+'"');
    if(req.fresh)return res.status(304).end();
  }
  res.send(image.data);
}));
router.get('/unsubscribe/:token', (req, res) => {
  if (!/^[a-f0-9]{64}$/.test(req.params.token)) return res.status(400).send('Invalid unsubscribe link.');
  res.set('Referrer-Policy', 'no-referrer'); page(res, req, 'unsubscribe');
});
router.post('/unsubscribe/:token', wrap(async (req, res) => {
  await Community.unsubscribe(req.params.token); res.set('Referrer-Policy', 'no-referrer');
  if (req.body['List-Unsubscribe'] === 'One-Click') return res.sendStatus(200);
  page(res, req, 'unsubscribe', { unsubscribed: true });
}));
router.get('/', wrap(async (req, res) => page(res, req, 'everyone', { initial: await Community.feed() })));
router.get('/p/:guid', wrap(async (req,res) => {
  if (!require('../lib/CommunityPostIdentity').valid(req.params.guid)) return res.sendStatus(404);
  const post = await Community.post(req.params.guid);
  if (post.url.startsWith('/blog/') || '/community'+req.path !== post.url) return res.redirect(301,post.url);
  page(res,req,'post',{post,author:post.author});
}));
for (const view of ['following', 'mine', 'write', 'moderation']) router.get('/' + view, (req, res) => page(res, req, view));
router.get('/@:handle', wrap(async (req, res) => {
  if (!/^[a-z0-9_.-]{3,40}$/.test(req.params.handle)) return res.sendStatus(404);
  page(res, req, 'author', {author:{handle:req.params.handle, name:'Profile'}});
}));
router.get('/@:handle/:id', wrap(async (req, res) => {
  const post = await Community.post(req.params.id);
  if (post.url !== '/community'+req.path) return res.redirect(301, post.url);
  page(res, req, 'post', { post, author: post.author });
}));
module.exports = { pages: router, api };
