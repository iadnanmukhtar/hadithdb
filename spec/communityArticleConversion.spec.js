'use strict';
const fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(require.resolve('../lib/Community'),'utf8');
const saveSource=source.slice(source.indexOf('async function savePost('),source.indexOf('\nasync function deletePost('));
function harness(overrides={}){
 const row={id:9,author_uid:'owner',kind:'article',status:'published',version:4,published_at:'2026-10-29',...overrides};
 const q=jest.fn(async sql=>sql.startsWith('SELECT *')?[row]:[]);
 const invalidate=jest.fn(async()=>{}),syncPost=jest.fn(async()=>{});
 const ctx=vm.createContext({authorFor:async()=>({trusted:true}),admin:async()=>false,moderator:()=>false,moderationEnabled:()=>false,text:v=>v,content:v=>({markdown:v}),id:Number,createError:require('http-errors'),transaction:fn=>fn(q),post:async()=>row,require:name=>name==='./CommunityRelated'?require('../lib/CommunityRelated'):name==='./CommunityTaxonomy'?require('../lib/CommunityTaxonomy'):name==='./CommunityDrive'?{enqueue:async()=>{}}:name==='./CommunityCover'?{validate:async()=>''}:{prepare:async()=>{},invalidate,syncPost},queueEmails:jest.fn()});
 vm.runInContext(saveSource,ctx);
 return {q,invalidate,syncPost,save:(input={},user={uid:'owner'})=>ctx.savePost(user,{kind:'note',convertToNote:true,title:'Title',markdown:'Body',version:4,action:'publish',...input},9)};
}
test.each(['draft','published'])('article conversion preserves identity and %s status',async status=>{
 const {q,save}=harness({status});await save({action:status==='published'?'publish':'draft'});
 const update=q.mock.calls.find(([sql])=>sql.startsWith('UPDATE community_posts'));
 expect(update[1][6]).toBe(status);expect(update[1][7]).toBe(5);expect(update[1].slice(-2)).toEqual(['note',9]);
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
test('draft saves preserve public category and revisions record the edited category',async()=>{
 const {q,save}=harness({category:'Hadith',public_category:'Tafsir'});
 await save({kind:'article',convertToNote:false,category:'Fiqh',action:'draft'});
 const [sql,values]=q.mock.calls.find(([sql])=>sql.startsWith('UPDATE community_posts'));
 expect(sql).toContain('category=?');expect(values[5]).toBe('Fiqh');expect(values[14]).toBe('Tafsir');
 const revision=q.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO community_revisions'));
 expect(revision[1][7]).toBe('Fiqh');
});
test('publishing explicitly clears the category in both snapshots',async()=>{
 const {q,save}=harness({category:'Hadith',public_category:'Tafsir'});
 await save({kind:'article',convertToNote:false,category:'',action:'publish'});
 const values=q.mock.calls.find(([sql])=>sql.startsWith('UPDATE community_posts'))[1];
 expect(values[5]).toBe('');expect(values[14]).toBe('');
});
test('draft saves preserve a published relationship and revision history',async()=>{
 const {q,save}=harness({related_article_id:12,public_related_article_id:10});
 await save({kind:'article',convertToNote:false,relatedArticleUrl:'',action:'draft'});
 const values=q.mock.calls.find(([sql])=>sql.startsWith('UPDATE community_posts'))[1];
 expect(values[15]).toBeNull();expect(values[16]).toBe(10);
 expect(q.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO community_revisions'))[1][8]).toBeNull();
});
test('publishing with no relation field preserves the existing authored link',async()=>{
 const {q,save}=harness({related_article_id:12,public_related_article_id:10});
 await save({kind:'article',convertToNote:false,action:'publish'});
 const values=q.mock.calls.find(([sql])=>sql.startsWith('UPDATE community_posts'))[1];
 expect(values[15]).toBe(12);expect(values[16]).toBe(12);
});

test('publication stores lowercase tags in draft, public snapshot and revision',async()=>{
 const {q,save}=harness();await save({tags:'Quran, al-Baqarah, FAITH, تقوى'});
 const values=q.mock.calls.find(([sql])=>sql.startsWith('UPDATE community_posts'))[1];
 expect(values[4]).toBe('quran, al-baqarah, faith, تقوى');expect(values[13]).toBe(values[4]);
 expect(q.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO community_revisions'))[1][6]).toBe(values[4]);
});

test.each(['draft','published','pending'])('private article autosaves avoid public cache purges and ES refreshes (%s)',async status=>{
 const {save,invalidate,syncPost}=harness({status});
 await save({kind:'article',convertToNote:false,action:'draft'});
 expect(invalidate).not.toHaveBeenCalled();expect(syncPost).not.toHaveBeenCalled();
});
test.each(['publish','unpublish'])('%s still refreshes public caches and search',async action=>{
 const {save,invalidate,syncPost}=harness();
 await save({kind:'article',convertToNote:false,action});
 expect(invalidate).toHaveBeenCalledTimes(1);expect(syncPost).toHaveBeenCalledWith(9);
});
test('converting a published article to a post still removes its public article index',async()=>{
 const {save,invalidate,syncPost}=harness();await save();expect(invalidate).toHaveBeenCalledTimes(1);expect(syncPost).toHaveBeenCalledWith(9);
});
