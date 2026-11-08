'use strict';
jest.mock('../lib/Community',()=>({ensure:jest.fn(),sql:jest.fn()}));
const C=require('../lib/Community'),Articles=require('../lib/HomeArticles');
beforeEach(()=>jest.resetAllMocks());
test('related ranking uses published explicit links in both directions and exact escaped tags',async()=>{
 C.sql.mockResolvedValueOnce([{id:9,author_uid:'amina-uid',public_category:'Hadith',public_tags:' Faith, faith, c++, صلاة ',public_related_article_id:4}])
  .mockResolvedValueOnce([{id:4,public_title:'Explicit link',public_category:'Fiqh',slug:'a topic'},{id:5,public_title:'By tags'}])
  .mockResolvedValueOnce([{id:8,public_title:'Recent'}]);
 const result=await Articles.forArticle(9);
 expect(result.relatedArticles.map(x=>x.id)).toEqual([4,5]);expect(result.relatedArticles[0].url).toBe('/blog/a%20topic');
 const [query,params]=C.sql.mock.calls[1];
 expect(query).toContain("p.status='published' AND p.kind='article' AND p.id<>?");
 expect(query).toContain('p.id=? OR p.public_related_article_id=?');
 expect(query).toContain('ORDER BY matches.explicit_match DESC,matches.tag_matches DESC,matches.category_match DESC');
 expect(query).not.toContain('markdown');expect(params).toEqual([4,9,'(^|,)[[:space:]]*faith[[:space:]]*(,|$)','(^|,)[[:space:]]*c\\+\\+[[:space:]]*(,|$)','(^|,)[[:space:]]*صلاة[[:space:]]*(,|$)','Hadith',9]);
 expect(C.sql.mock.calls[2][1]).toEqual(['amina-uid',9]);
 expect(C.sql.mock.calls[2][0]).toContain('p.author_uid=? AND p.id<>?');
 expect(C.sql.mock.calls[2][0]).toContain("p.status='published' AND p.kind='article'");
 expect(result.authorArticles.map(item=>item.id)).toEqual([8]);
});
test('unpublished source never supplies draft metadata for matching',async()=>{
 C.sql.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
 expect(await Articles.forArticle(9)).toEqual({relatedArticles:[],authorArticles:[]});expect(C.sql).toHaveBeenCalledTimes(1);
 expect(C.sql.mock.calls[0][0]).toContain("status='published'");
});
test('empty tags and categories do not match uncategorized articles',async()=>{
 C.sql.mockResolvedValueOnce([{id:9}]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
 await Articles.forArticle(9);const [query,params]=C.sql.mock.calls[1];expect(query).toContain('(0) AS tag_matches');expect(query).toContain("p.public_category<>''");expect(params).toEqual([0,9,'',9]);
});
test('recent home articles contain a category for their mini pill',async()=>{
 C.sql.mockResolvedValueOnce([{id:1,public_title:'Faith',public_category:'Hadith',handle:'amina'}]);
 expect((await Articles.latest())[0]).toMatchObject({category:'Hadith',authorHandle:'amina'});
 expect(C.sql.mock.calls[0][0]).toContain("p.status='published' AND p.kind='article'");
});
