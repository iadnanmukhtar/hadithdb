'use strict';
const fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(require.resolve('../lib/Community'),'utf8');
const saveSource=source.slice(source.indexOf('async function savePost('),source.indexOf('\nasync function deletePost('));
function harness(overrides={}){
 const row={id:9,author_uid:'owner',kind:'article',status:'published',version:4,published_at:'2026-10-29',...overrides};
 const q=jest.fn(async sql=>sql.startsWith('SELECT *')?[row]:[]);
 const ctx=vm.createContext({authorFor:async()=>({trusted:true}),admin:async()=>false,moderator:()=>false,text:v=>v,content:v=>({markdown:v}),id:Number,createError:require('http-errors'),transaction:fn=>fn(q),post:async()=>row,require:name=>name==='./CommunityCover'?{validate:async()=>''}:{prepare:async()=>{},invalidate:async()=>{}},queueEmails:jest.fn()});
 vm.runInContext(saveSource,ctx);
 return {q,save:(input={},user={uid:'owner'})=>ctx.savePost(user,{kind:'note',convertToNote:true,title:'Title',markdown:'Body',version:4,action:'publish',...input},9)};
}
test.each(['draft','published'])('article conversion preserves identity and %s status',async status=>{
 const {q,save}=harness({status});await save({action:status==='published'?'publish':'draft'});
 const update=q.mock.calls.find(([sql])=>sql.startsWith('UPDATE community_posts'));
 expect(update[1][5]).toBe(status);expect(update[1][6]).toBe(5);expect(update[1].slice(-2)).toEqual(['note',9]);
 expect(q.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO community_revisions'))).toBe(true);
});
test.each([
 [{convertToNote:false},{},400],
 [{version:3},{},409],
 [{markdown:'x'.repeat(10001)},{},400],
 [{},{status:'hidden'},400],
])('invalid conversion does not update the article',async(input,row,status)=>{
 const {q,save}=harness(row);await expect(save(input)).rejects.toMatchObject({status});
 expect(q.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
});
test('another user cannot convert the article',async()=>{
 const {save}=harness();await expect(save({}, {uid:'other'})).rejects.toMatchObject({status:404});
});

test.each([
 ['article','note',{convertToNote:true}],
 ['note','article',{convertToArticle:true,convertToNote:false}],
])('%s to %s updates the existing row without replacing its GUID',async(from,to,flags)=>{
 const {q,save}=harness({kind:from,guid:'f37d0f36-7a95-4e2c-9f08-5a7d97cdb9e1'});
 await save({kind:to,...flags});
 const writes=q.mock.calls.filter(([sql])=>/^(UPDATE|INSERT|DELETE|REPLACE)/.test(sql));
 const postWrites=writes.filter(([sql])=>/^(UPDATE community_posts|INSERT INTO community_posts|DELETE FROM community_posts|REPLACE INTO community_posts)/.test(sql));
 expect(postWrites).toHaveLength(1);
 expect(postWrites[0][0]).toMatch(/^UPDATE community_posts SET/);
 expect(postWrites[0][0]).not.toMatch(/\bguid\s*=/i);
 expect(postWrites[0][1].slice(-2)).toEqual([to,9]);
});
