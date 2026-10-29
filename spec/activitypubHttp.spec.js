'use strict';
const crypto = require('crypto');
const Http = require('../lib/ActivityPubHttp');
const keys = crypto.generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const actor = {url:'https://remote.example/users/amina',private_key:keys.privateKey};
const destination = 'https://hadith.example/activitypub/actors/abc/inbox';
function fixture(now) {
  const activity = {id:'https://remote.example/activities/1',type:'Follow',actor:actor.url,object:'https://hadith.example/activitypub/actors/abc'};
  const body = Buffer.from(JSON.stringify(activity));
  return {activity,req:{method:'POST',originalUrl:new URL(destination).pathname,body,headers:Http.sign('POST',destination,body,actor,now)}};
}
beforeEach(()=>jest.spyOn(Http,'request').mockResolvedValue({id:actor.url,inbox:actor.url+'/inbox',publicKey:{id:actor.url+'#main-key',owner:actor.url,publicKeyPem:keys.publicKey}}));
afterEach(()=>jest.restoreAllMocks());
test('verifies the raw body, signed target, host, date and actor-owned RSA key',async()=>{
  const {req,activity} = fixture();
  expect((await Http.verify(req,activity,actor)).id).toBe(actor.url);
  expect(Http.request).toHaveBeenCalledWith(actor.url,{actor});
});
test.each(['body','target','host','owner','expired','signature','headers'])('rejects tampered or invalid %s',async field=>{
  const {req,activity} = fixture(field==='expired'?new Date(0):undefined);
  if(field==='body') req.body=Buffer.from('{}');
  if(field==='target')req.originalUrl+='/other';
  if(field==='host')req.headers.host='other.example';
  if(field==='owner')Http.request.mockResolvedValue({id:actor.url,publicKey:{id:actor.url+'#main-key',owner:'https://attacker.example',publicKeyPem:keys.publicKey}});
  if(field==='signature')req.headers.signature=req.headers.signature.replace(/signature="[^"]+"/,'signature="invalid"');
  if(field==='headers')req.headers.signature=req.headers.signature.replace('host date digest','host date');
  await expect(Http.verify(req,activity,actor)).rejects.toMatchObject({status:401});
});
test.each(['http://remote.example/','https://127.0.0.1/','https://[::1]/','https://169.254.169.254/','https://192.168.1.1/','https://host.internal/','https://user:pass@remote.example/','https://remote.example:8443/'])('rejects unsafe remote URLs: %s',url=>{
  expect(()=>Http.url(url)).toThrow();
});
test('rejects DNS answers containing private addresses before opening a connection',async()=>{
  Http.request.mockRestore();
  jest.spyOn(require('dns').promises,'lookup').mockResolvedValue([{address:'127.0.0.1',family:4}]);
  await expect(Http.request('https://remote.example/')).rejects.toMatchObject({status:400});
});
