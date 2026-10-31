'use strict';
jest.mock('../lib/Community',()=>({sql:jest.fn()}));
const Community=require('../lib/Community');
const Preferences=require('../lib/NotificationPreferences');
const Delivery=require('../lib/NotificationDelivery');
const {render}=require('../lib/NotificationEmail');
const originalSettings=global.settings;
const token='a'.repeat(64);
let rows;
beforeEach(()=>{
  global.settings={site:{url:'https://hadith.example'}};
  rows=new Map();
  Community.sql.mockImplementation(async(sql,values=[])=>{
    if(sql.startsWith('CREATE TABLE'))return {};
    if(sql.startsWith('INSERT IGNORE')){if(!rows.has(values[0]))rows.set(values[0],{email_hash:values[0],unsubscribe_token:values[1],...Object.fromEntries(Preferences.keys.map(key=>[key,1]))});return {};}
    if(sql.includes('SELECT'))return [...rows.values()].filter(row=>sql.includes('email_hash=?')?row.email_hash===values[0]:row.unsubscribe_token===values[0]);
    if(sql.startsWith('UPDATE')){const assignments=sql.split(' SET ')[1].split(' WHERE ')[0].split(',');const row=[...rows.values()].find(row=>sql.includes('email_hash=?')?row.email_hash===values.at(-1):row.unsubscribe_token===values.at(-1));if(row)assignments.forEach((part,i)=>row[part.split('=')[0]]=part.endsWith('=0')?0:values[i]);return {};}
    throw new Error(sql);
  });
});
afterEach(()=>{global.settings=originalSettings;jest.restoreAllMocks();});
test('preferences survive reload, normalize addresses and isolate recipients',async()=>{
  const user={email:'Reader@Example.com'};
  const prefs=await Preferences.get(user);expect(prefs.enabled).toBe(true);
  await Preferences.save(user,{...prefs,replies:false});
  expect((await Preferences.get({email:'reader@example.com'})).replies).toBe(false);
  expect((await Preferences.get({email:'other@example.com'})).replies).toBe(true);
  await expect(Preferences.save(user,{enabled:false})).rejects.toMatchObject({status:400});
});
test('token viewing does not unsubscribe, posting disables only its category',async()=>{
  const row=await Preferences.forEmail('reader@example.com');
  await Preferences.tokenRow(row.unsubscribe_token,'replies');expect(row.replies).toBe(1);
  await Preferences.unsubscribe(row.unsubscribe_token,'replies');
  expect(row.replies).toBe(0);expect(row.articles).toBe(1);
  await expect(Preferences.unsubscribe(token,'enabled=0')).rejects.toMatchObject({status:400});
  await expect(Preferences.unsubscribe(token,'likes')).rejects.toMatchObject({status:404});
});
test('delivery honors category and global opt-outs for individual recipients',async()=>{
  const one=await Preferences.get({email:'one@example.com'});
  await Preferences.save({email:'one@example.com'},{...one,likes:false});
  const two=await Preferences.get({email:'two@example.com'});
  await Preferences.save({email:'two@example.com'},{...two,enabled:false});
  const mail=render({kind:'like',source:{subject:'Bukhari 100',url:'https://hadith.example/bukhari:100'}});
  const transport={sendMail:jest.fn().mockResolvedValue({})};
  const result=await Delivery.send(transport,{...mail,to:'One <one@example.com>, two@example.com, three@example.com'});
  expect(result.sent).toBe(1);expect(transport.sendMail.mock.calls[0][0].to).toBe('three@example.com');
  const sent=transport.sendMail.mock.calls[0][0];
  expect(sent.html).toContain('/community/email-preferences');expect(sent.html).toContain('/community/email-unsubscribe/');
  expect(sent.text).toContain('Unsubscribe from these emails:');
  expect(sent.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  expect(sent.notificationCategory).toBeUndefined();
});
test('author unsubscribe is preserved alongside global article controls',async()=>{
  const transport={sendMail:jest.fn().mockResolvedValue({})};
  await Delivery.send(transport,{to:'reader@example.com',...render({kind:'article',source:{subject:'Kindness',url:'https://hadith.example/community'},unsubscribe:'https://hadith.example/community/unsubscribe/author'}),headers:{'List-Unsubscribe':'<https://hadith.example/community/unsubscribe/author>'}});
  const mail=transport.sendMail.mock.calls[0][0];
  expect(mail.headers['List-Unsubscribe']).toContain('/unsubscribe/author');
  expect(mail.html).toContain('Unsubscribe from this author');
  expect(mail.html).toContain('/articles');
});
