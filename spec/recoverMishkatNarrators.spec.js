'use strict';
const {resolve,extract,evidence}=require('../bin/recover-mishkat-narrators');
const books=[{id:1,alias:'bukhari',ordinal:101,virtual:0},{id:2,alias:'muslim',ordinal:102,virtual:0}];
const entry=(number,text,sources=['muslim'])=>({number,text,sources,headingKey:'C1',numbers:[number],links:[]});
const matn='لا يؤمن أحدكم حتى يحب لأخيه ما يحب لنفسه';
test('وعنه inherits the immediate previous narrator recursively without an eight-report limit',()=>{
 const entries=[entry(1,'عن أنس قال: «'+matn+'»')];
 for(let i=2;i<=14;i++)entries.push(entry(i,'[1] (صحيح) وَعَنْهُ قَالَ: «'+matn+'»'));
 const r=resolve(entries.at(-1),entries);expect(r.narrator).toBe('انس');expect(r.via).toEqual(Array.from({length:14},(_,i)=>14-i));
 expect(extract(entries.at(-1),entries).narrator).toBe('انس');
});
test('a new explicit narrator resets inheritance and عنها resolves similarly',()=>{
 const es=[entry(1,'عن أنس قال: «'+matn+'»'),entry(2,'عن عائشة قالت: «'+matn+'»'),entry(3,'وعنها قالت: «'+matn+'»')];
 expect(resolve(es[2],es).narrator).toBe('عايشه');expect(resolve(es[2],es).via).toEqual([3,2]);
});
test('does not skip an unresolved preceding narrator to guess an older one',()=>{
 const es=[entry(1,'عن أنس قال: «'+matn+'»'),entry(2,'وفي رواية أخرى: «'+matn+'»'),entry(3,'وعنه قال: «'+matn+'»')];
 expect(resolve(entry(99,'وعنه قال: «'+matn+'»'),[]).narrator).toBe('');
 // Resolution records only the immediate predecessor, even when its narrator extraction is uncertain.
 expect(resolve(es[2],es).via).toEqual([3,2]);
});
test('accepts a different narrator only within the cited book',()=>{
 const h=entry(1,'عن أنس قال: «'+matn+'» رواه مسلم'),c={alias:'muslim',num:'1',chain:'عن أبي هريرة قال',body:matn};
 expect(evidence(h,c,[h],books)?.narratorStatus).toBe('different-or-unconfirmed');
 expect(evidence(h,{...c,alias:'bukhari'},[h],books)).toBeNull();
 const unreferenced={...h,text:'عن أنس قال: «'+matn+'»',sources:[]};
 expect(evidence(unreferenced,c,[unreferenced],books)).toBeNull();
});
test('still rejects contradictory text and introductory records',()=>{
 const h=entry(1,'عن أنس قال: «'+matn+'» رواه مسلم'),c={alias:'muslim',num:'1',chain:'عن عمر',body:matn.replace('لا ','')};
 expect(evidence(h,c,[h],books)).toBeNull();
 expect(evidence(h,{...c,num:'ir0',body:matn},[h],books)).toBeNull();
});
test('pending cited-book matches are not mislabeled as requiring narrator agreement',()=>{
 const {reason}=require('../bin/recover-mishkat-narrators');
 expect(reason({narrator:'',segments:[matn]},{mode:'cited-books'})).toBe('unverified-variant');
 expect(reason({narrator:'',segments:[matn]},{mode:'ordinal-fallback'})).toBe('narrator-context');
});
