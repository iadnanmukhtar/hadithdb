'use strict';
jest.mock('../lib/NotificationPreferences',()=>({categories:{likes:'Likes',reflections:'Reflections',replies:'Replies',reactions:'Reactions',articles:'Articles'},forEmail:jest.fn(async()=>({enabled:1,likes:1,reflections:1,replies:1,reactions:1,articles:1,unsubscribe_token:'a'.repeat(64)}))}));
jest.mock('nodemailer',()=>({createTransport:jest.fn()}));
const nodemailer=require('nodemailer');
const ContentItems=require('../lib/ContentItems');
const Utils=require('../lib/Utils');
const Email=require('../lib/ActivityEmailSource');
const originalSettings=global.settings, originalQuery=global.query;
let sendMail;
beforeEach(()=>{
  global.settings={site:{url:'https://hadith.example',quranUrl:'https://quran.example'},smtp:{from:'sender@example.com',to:'admin@example.com'}};
  sendMail=jest.fn().mockResolvedValue({});
  nodemailer.createTransport.mockReturnValue({sendMail});
  jest.spyOn(ContentItems,'get').mockResolvedValue({activityTitle:'Actions by intentions',url:'/sharh/riyad-uthaymin/bukhari:1#note-sharh-42'});
});
afterEach(()=>{jest.restoreAllMocks();global.settings=originalSettings;global.query=originalQuery;});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('email labels match source microinteractions and retain canonical anchors',async()=>{
  global.query=jest.fn().mockResolvedValue([{source_title:'Actions by intentions',source_url:'/sharh/riyad-uthaymin/bukhari:1#note-sharh-42'}]);
  expect(await Email.describe({type:'content',targetId:88,ref:'items/88'})).toMatchObject({subject:'Actions by intentions · Bukhari 1',url:'https://hadith.example/sharh/riyad-uthaymin/bukhari:1#note-sharh-42'});
  global.query.mockResolvedValue([{source_title:'First few words from an untitled explanation with…',source_url:'/sharh/riyad-uthaymin/bukhari:1'}]);
  expect((await Email.describe({type:'content',targetId:88})).subject).toBe('First few words from an untitled explanation with… · Bukhari 1');
});
test('admin and participant like messages use the same title, reference and link',async()=>{
  jest.spyOn(Utils,'flushCacheContaining').mockResolvedValue();
  jest.spyOn(Utils,'flushCachedFile').mockResolvedValue();
  global.query=jest.fn(async sql=>{
    if(sql.includes('FROM content_items'))return [{source_title:'Actions by intentions',source_url:'/sharh/riyad-uthaymin/bukhari:1#note-sharh-42'}];
    if(sql.includes('INFORMATION_SCHEMA'))return [{}];
    if(sql.includes('SELECT COUNT(*)'))return [{cnt:2}];
    if(sql.includes('SELECT user_uid, user_provider, user_email'))return [{user_uid:'reader',user_email:'reader@example.com'}];
    return [];
  });
  const router=require('../routes/likes');
  const route=router.stack.find(layer=>layer.route?.methods.post && layer.route.path==='/:hadithId').route;
  const req={params:{hadithId:'88'},body:{type:'content'},query:{},user:{uid:'actor',name:'Abrar'},get:()=>'',clientIp:''};
  const res={json:jest.fn(),status:jest.fn().mockReturnThis()};
  const next=jest.fn();
  await route.stack.at(-1).handle(req,res,next);
  await tick();
  expect(next).not.toHaveBeenCalled();
  expect(sendMail).toHaveBeenCalledTimes(2);
  for(const [message] of sendMail.mock.calls){
    expect(message.subject).toBe('New like: Actions by intentions · Bukhari 1');
    expect(message.text).toContain('https://hadith.example/sharh/riyad-uthaymin/bukhari:1#note-sharh-42');
    expect(message.text).not.toMatch(/items\/88|Target ID:/);
  }
  expect(sendMail.mock.calls.map(([mail])=>mail.to)).toEqual(['admin@example.com','reader@example.com']);
});
test('reflection vote messages resolve asynchronous descriptions for admins and thread participants',async()=>{
  const Community=require('../lib/Community');
  jest.spyOn(Community,'recordReflectionVote').mockResolvedValue();
  const row={id:7,hadithId:88,type:'content',ref_num:'items/88',text:'A reflection',user_uid:'reader',user_email:'reader@example.com',user_name:'Reader'};
  global.query=jest.fn(async sql=>{
    if(sql.includes('FROM content_items'))return [{source_title:'Actions by intentions',source_url:'/sharh/riyad-uthaymin/bukhari:1#note-sharh-42'}];
    if(sql.includes('SUM(direction'))return [{commentId:7,upVote:1}];
    if(sql.includes('SELECT') && sql.includes('FROM hadiths_comments'))return [row];
    return [];
  });
  const router=require('../routes/comments');
  const route=router.stack.find(layer=>layer.route?.methods.post && layer.route.path.includes('vote')).route;
  const req={params:{commentId:'7'},body:{direction:'up'},user:{uid:'actor',name:'Abrar'}};
  const res={json:jest.fn(),status:jest.fn().mockReturnThis()};
  const next=jest.fn();
  await route.stack.at(-1).handle(req,res,next);
  await tick();
  expect(next).not.toHaveBeenCalled();
  expect(sendMail).toHaveBeenCalledTimes(2);
  for(const [message] of sendMail.mock.calls){
    expect(message.subject).toContain('Actions by intentions · Bukhari 1');
    expect(message.text).toContain('https://hadith.example/sharh/riyad-uthaymin/bukhari:1#note-sharh-42');
    expect(message.text).not.toMatch(/items\/88|#note-sharh-42#comments/);
  }
});
test('email citations use book names and surah names without changing canonical URLs',async()=>{
  const oldBooks=global.books, oldSurahs=global.surahs;
  global.books=[{alias:'bukhari',shortName_en:'Bukhari'}];
  global.surahs=[{num:2,name_en:'al-Baqarah'}];
  try {
    global.query=jest.fn().mockResolvedValue([{source_title:'A sincere intention'}]);
    const hadith=await Email.describe({type:'hadith',hadithId:100,ref:'bukhari:100'});
    expect(hadith.subject).toBe('A sincere intention · Bukhari 100');
    expect(hadith.url).toBe('https://hadith.example/bukhari:100');
    global.query.mockResolvedValue([{source_title:'Guard your prayers'}]);
    const quran=await Email.describe({type:'toc',targetId:238,ref:'quran:2:238'});
    expect(quran.subject).toBe('Guard your prayers · Baqarah 2:238');
    const mail=require('../lib/NotificationEmail').render({kind:'like',source:quran});
    expect(mail.text).toContain('Baqarah 2:238');
    expect(mail.html).toContain('Baqarah 2:238');
    expect(quran.url).toBe('https://quran.example/quran:2:238');
  } finally {global.books=oldBooks;global.surahs=oldSurahs;}
});
