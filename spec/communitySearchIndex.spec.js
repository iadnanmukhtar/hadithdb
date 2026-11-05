'use strict';
jest.mock('axios',()=>({put:jest.fn(async()=>({})),delete:jest.fn(async()=>({})),post:jest.fn(async()=>({data:{items:[]}}))}));
jest.mock('../lib/Community',()=>({transaction:jest.fn(),content:jest.fn(body=>({html:body})),sql:jest.fn(),ensure:jest.fn()}));
const axios=require('axios'),Community=require('../lib/Community'),Index=require('../lib/CommunitySearchIndex');
let row,q;
beforeEach(()=>{
 global.settings={search:{domain:'http://es.test'}};
 row={id:7,guid:'a106ff24-2a2b-4e98-9144-72443ad1e505',kind:'article',status:'published',public_title:'Published title',public_subtitle:'Public subtitle',public_markdown:'<p>Public mercy</p><p>Second paragraph</p>',title:'Private title',markdown:'Private draft',name:'Writer',custom_name:1,published_at:'2026-11-05'};
 q=jest.fn(async sql=>sql.includes('JOIN')?[row]:[{id:7}]);
 Community.transaction.mockImplementation(fn=>fn(q));axios.put.mockClear();axios.delete.mockClear();
});
test('indexes only public snapshot and canonical URL under a row lock',async()=>{
 await Index.syncPost(7);
 expect(q.mock.calls[0][0]).toContain('FOR UPDATE');
 const call=axios.put.mock.calls.find(([url])=>url.includes('/_doc/'));
 expect(call[0]).toBe('http://es.test/community_articles_v1/_doc/7?refresh=true');
 expect(call[1]).toEqual(expect.objectContaining({doctype:'community',article_title:'Published title',article_text:'Public mercy Second paragraph',url:'/community/p/'+row.guid}));
 expect(JSON.stringify(call[1])).not.toContain('Private');
});
test.each(['draft','pending','private','hidden','deleted'])('removes %s documents immediately',async status=>{
 row.status=status;await Index.syncPost(7);
 expect(axios.delete).toHaveBeenCalledWith('http://es.test/community_articles_v1/_doc/7?refresh=true',expect.any(Object));
});
test('Blog designation and legacy path are indexed; removed designation becomes Community',()=>{
 row.blog_post_id=7;row.slug='Old path';
 expect(Index.document(row)).toEqual(expect.objectContaining({doctype:'blog',url:'/blog/Old%20path'}));
 row.blog_post_id=null;
 expect(Index.document(row).doctype).toBe('community');
 row.kind='note';expect(Index.document(row)).toBeNull();
});
test('write failures propagate instead of silently leaving a successful response',async()=>{
 axios.put.mockRejectedValueOnce(new Error('ES unavailable'));
 await expect(Index.syncPost(7)).rejects.toThrow('ES unavailable');
});

test('bulk backfill indexes public articles and removes ineligible or absent posts',async()=>{
 await Index.syncBatch([7,8]);
 const [url,payload]=axios.post.mock.calls.at(-1);
 expect(url).toBe('http://es.test/community_articles_v1/_bulk?refresh=true');
 const lines=payload.trim().split('\n').map(JSON.parse);
 expect(lines[0]).toEqual({index:{_id:'7'}});
 expect(lines[1].article_title).toBe('Published title');
 expect(lines[2]).toEqual({delete:{_id:'8'}});
});
test('bulk indexing rejects partial write failures',async()=>{
 axios.post.mockResolvedValueOnce({data:{errors:true,items:[{index:{status:400,error:{reason:'bad mapping'}}}]}});
 await expect(Index.syncBatch([7])).rejects.toThrow('Article indexing failed');
});
test('oversized articles are compressed instead of exceeding the proxy request limit',async()=>{
 row.public_markdown='<p>'+ 'long text '.repeat(60000)+'</p>';
 await Index.syncBatch([7]);
 const [,payload,config]=axios.post.mock.calls.at(-1);
 expect(config.headers['Content-Encoding']).toBe('gzip');
 expect(require('zlib').gunzipSync(payload).toString()).toContain('Published title');
});
