'use strict';
const name = require('../lib/CommunityName');
const Community = require('../lib/Community');

test.each([
  ['  Adnan  Mukhtar ', 'Adnan'], ['أحمد محمد', 'أحمد'], ['Mary-Jane Smith', 'Mary-Jane'],
  ['Alice\tSmith', 'Alice'], ['Cher', 'Cher'], ['', 'Community member'],
  ['private@example.com', 'Community member'], ['Community member', 'Community member']
])('public name %j becomes %j', (input, expected) => expect(name(input)).toBe(expected));

test('post authors expose only first names even in owner and moderation representations', () => {
  const row = {id:1, kind:'note', handle:'writer', name:'Alice PrivateSurname', public_markdown:'Public', markdown:'Draft'};
  for (const owner of [false, true]) {
    expect(Community.postView(row, owner).author.name).toBe('Alice');
    expect(JSON.stringify(Community.postView(row, owner))).not.toContain('PrivateSurname');
  }
  expect(row.name).toBe('Alice PrivateSurname');
});

test('profile full name is available only to its verified owner, without exposing UID', async () => {
  const original = global.dbPool;
  global.dbPool = {query(statement, values, callback) {
    if (typeof values === 'function') { callback = values; values = []; }
    const rows = statement.includes('SELECT a.uid, a.handle')
      ? [{uid:'owner', handle:'writer', name:'Alice PrivateSurname', bio:''}] : [];
    callback(null, rows);
  }};
  try {
    await expect(Community.profile('writer')).rejects.toMatchObject({status:401});
    for (const user of [{uid:'other'}, {uid:'other', name:'Alice PrivateSurname'}]) {
      const profile = await Community.profile('writer', user);
      expect(profile.name).toBe('Alice');
      expect(profile.uid).toBeUndefined();
    }
    expect((await Community.profile('writer', {uid:'owner'})).name).toBe('Alice PrivateSurname');
  } finally { global.dbPool = original; }
});

test('custom multiword and Arabic display names are shown intact', () => {
  for (const display of ['The Curious Reader', 'عبد الله الباحث']) {
    expect(name(display, 1)).toBe(display);
    expect(Community.postView({id:1,kind:'note',name:display,custom_name:1,public_markdown:'Body'}).author.name).toBe(display);
    expect(Community.publicAuthor({name:display,custom_name:1}).name).toBe(display);
  }
  expect(name('private@example.com',1)).toBe('Community member');
  expect(name('Alice PrivateSurname',null)).toBe('Alice');
});

test('saving an override uses the verified account name and restoring it restores first-name privacy', async () => {
  const original = global.dbPool;
  const row = {uid:'owner',handle:'writer',name:'Alice Smith',custom_name:0,bio:''};
  const updates = [];
  const connection = {
    query(statement, values, callback) {
      if (typeof values === 'function') {callback=values;values=[];}
      if (statement.startsWith('UPDATE community_authors SET name=')) {
        updates.push(values);Object.assign(row,{name:values[0],bio:values[1],handle:values[2],custom_name:values[3],profile_visibility:values[4]});
        return callback(null,{affectedRows:1});
      }
      callback(null, statement.startsWith('SELECT * FROM community_authors WHERE uid=') || statement.includes('SELECT a.uid, a.handle') ? [{...row}] : []);
    },
    beginTransaction: cb=>cb(null), commit: cb=>cb(null), rollback: cb=>cb(null), release:()=>{}
  };
  global.dbPool={query:connection.query,getConnection:cb=>cb(null,connection)};
  const invalidate=jest.spyOn(require('../lib/BlogPageCache'),'invalidate').mockResolvedValue();
  try {
    const user={uid:'owner',name:'Alice Smith',email:'alice@example.test'};
    const chosen=await Community.saveProfile(user,{name:'The Curious Reader',handle:'writer',bio:''});
    expect(chosen.name).toBe('The Curious Reader');expect(chosen.publicName).toBe('The Curious Reader');
    expect((await Community.profile('writer', {uid:'reader'})).name).toBe('The Curious Reader');
    expect(updates[0][3]).toBe(1);
    const restored=await Community.saveProfile(user,{name:'Alice Smith',handle:'writer',bio:'',custom_name:1});
    expect(restored.name).toBe('Alice Smith');expect(restored.publicName).toBe('Alice');
    expect((await Community.profile('writer', {uid:'reader'})).name).toBe('Alice');
    expect(updates[1][3]).toBe(0);
    await Community.saveProfile(user,{name:'Alice Smith',handle:'writer',bio:'Private bio',visibility:'private'});
    await expect(Community.profile('writer',{uid:'reader'})).rejects.toMatchObject({status:404});
    const kept=await Community.saveProfile(user,{name:'Alice Smith',handle:'writer',bio:'Updated bio'});
    expect(kept.profile_visibility).toBe('private');
    await expect(Community.saveProfile(user,{name:'Alice Smith',handle:'writer',visibility:'invalid'})).rejects.toMatchObject({status:400});
  } finally {global.dbPool=original;invalidate.mockRestore();}
});
