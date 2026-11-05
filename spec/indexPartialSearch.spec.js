'use strict';
jest.mock('axios',()=>({post:jest.fn()}));
jest.mock('../lib/Debug',()=>()=>Object.assign(jest.fn(),{error:jest.fn(),slow:jest.fn()}));
const axios=require('axios'),Index=require('../lib/Index');
test('partial ES shard failure is an error rather than an empty successful search',async()=>{
 global.settings={search:{domain:'http://es.test'}};
 axios.post.mockResolvedValue({status:200,data:{_shards:{failed:1},hits:{total:{value:0},hits:[]}}});
 await expect(Index.docsFromQuery('hadiths,community_articles_v1',{match_all:{}},0,10)).rejects.toMatchObject({status:502});
});
