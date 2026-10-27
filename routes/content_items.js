'use strict';
const router = require('express').Router();
const Items = require('../lib/ContentItems');
const Auth = require('../lib/GoogleAuth');
const ejs = require('ejs');
const wrap = work => (req,res,next) => Promise.resolve(work(req,res,next)).catch(next);
router.use((req,res,next) => { res.set('Cache-Control','private, no-store'); next(); });
router.get('/actions', wrap(async(req,res) => {
  const item = await Items.resolve(req.query.key);
  const widgetId = 'content-comments-' + item.id + '-' + require('crypto').randomBytes(4).toString('hex');
  const html = await ejs.renderFile(__dirname + '/../views/sub-views/content_item_actions.ejs', { item: {...item, url:Items.url(item,req)}, widgetId });
  res.json({item,html});
}));
router.use(wrap(async(req,res,next) => {
  req.user = await Auth.verifyRequest(req,{allowSession:true});
  if (!req.user) return res.status(401).json({error:'Please sign in to use bookmarks.'});
  next();
}));
router.get('/bookmarks',wrap(async(req,res) => res.json({items:await Items.bookmarks(req.user.uid)})));
router.delete('/bookmarks',wrap(async(req,res)=>{await Items.clearBookmarks(req.user.uid);res.json({saved:true});}));
router.put('/:id/bookmark',wrap(async(req,res) => {await Items.bookmark(req.user.uid,Number(req.params.id),req.body.enabled);res.json({saved:true});}));
router.use((err,req,res,next) => { if(res.headersSent)return next(err);res.status(err.status||500).json({error:err.status&&err.status<500?err.message:'Unable to load item actions.'}); });
module.exports = router;
