'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const AP = require('../lib/ActivityPub');
const Http = require('../lib/ActivityPubHttp');
const router = express.Router();
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next);
router.use((req,res,next) => {
  if (!AP.enabled()) return res.sendStatus(404);
  res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  next();
});
router.use(rateLimit({windowMs:60*1000,limit:120,standardHeaders:'draft-7',legacyHeaders:false}));
const send = (res,value) => res.type(Http.TYPE).send(JSON.stringify(value));
router.get('/.well-known/webfinger',wrap(async(req,res)=>res.type('application/jrd+json').send(JSON.stringify(await AP.webfinger(req.query.resource)))));
router.get('/activitypub/actors/:id',wrap(async(req,res)=>send(res,AP.actorDocument(await AP.actorById(req.params.id)))));
router.get('/activitypub/actors/:id/outbox',wrap(async(req,res)=>send(res,await AP.outbox(await AP.actorById(req.params.id),req.query.page))));
router.get('/activitypub/actors/:id/followers',wrap(async(req,res)=>{
  const actor = await AP.actorById(req.params.id);
  // Do not publish the membership of someone's remote follower collection.
  send(res,{'@context':AP.CONTEXT,id:actor.url+'/followers',type:'Collection'});
}));
router.get('/activitypub/objects/:source/:id/:token',wrap(async(req,res)=>send(res,await AP.publicObject(req.params.source,req.params.id,req.params.token))));
router.get('/activitypub/activities/:id',wrap(async(req,res)=>send(res,await AP.publicActivity(req.params.id))));
router.post('/activitypub/actors/:id/inbox',express.raw({type:['application/activity+json','application/ld+json','application/json'],limit:'256kb',inflate:false}),wrap(async(req,res)=>{
  const actor = await AP.actorById(req.params.id);
  if (!Buffer.isBuffer(req.body)) return res.sendStatus(415);
  let activity; try { activity = JSON.parse(req.body.toString('utf8')); } catch (_) { return res.sendStatus(400); }
  if (!activity || typeof activity !== 'object' || Array.isArray(activity) || typeof activity.actor !== 'string') return res.sendStatus(400);
  const remote = await Http.verify(req,activity,actor);
  await AP.inbox(actor,activity,remote);
  res.sendStatus(202);
}));
router.all('/activitypub/*',(req,res)=>res.sendStatus(405));
router.use((err,req,res,next)=>{
  if (res.headersSent) return next(err);
  const status = err.status && err.status < 500 ? err.status : 503;
  res.status(status).json({error:status===503?'Federation is temporarily unavailable.':require('http').STATUS_CODES[status]});
});
module.exports = router;
