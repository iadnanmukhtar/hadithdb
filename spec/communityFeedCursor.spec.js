'use strict';
const fs=require('fs'),vm=require('vm'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('public/static/js/community.js','utf8');
const start=source.indexOf('  async function loadFeed('),end=source.indexOf('\n  }',start)+4;
function setup(){
 const dom=new JSDOM('<div id="feed"></div><select id="filter"><option value="all">All</option></select><p id="feed-status"></p><button id="more"></button>');
 const ctx=vm.createContext({URLSearchParams,loadingFeed:false,feedEpoch:0,feedObserver:null,offset:0,feedCursor:null,firstBatchMicroOnly:false,view:'everyone',feedKeys:new Set(),reactionRun:null,feedHasMore:false,
  $:id=>dom.window.document.getElementById(id),api:jest.fn(),microType:item=>item.micro,observeFeedEnd:jest.fn(),node:tag=>dom.window.document.createElement(tag),appendFeedCard:item=>{const el=dom.window.document.createElement('article');dom.window.document.getElementById('feed').append(el);return !item.collapsed;}});
 vm.runInContext(source.slice(start,end),ctx);return {dom,ctx};
}
test('load more sends the cursor and resetting a filter clears it',async()=>{const {dom,ctx}=setup();try{
 ctx.api.mockResolvedValueOnce({items:[{id:1,activity:'post'}],hasMore:true,offset:20,cursor:'first'}).mockResolvedValueOnce({items:[{id:2,activity:'post'}],hasMore:false,offset:40,cursor:'second'}).mockResolvedValueOnce({items:[],hasMore:false,offset:20,cursor:null});
 await ctx.loadFeed(true);await ctx.loadFeed();expect(ctx.api.mock.calls[1][0]).toContain('cursor=first');
 await ctx.loadFeed(true);expect(ctx.api.mock.calls[2][0]).not.toContain('cursor=');expect(ctx.feedCursor).toBeNull();
 }finally{dom.window.close();}});
test('collapsed activity advances using the cursor until a visible item arrives',async()=>{const {dom,ctx}=setup();try{
 ctx.offset=20;ctx.feedCursor='previous';
 ctx.api.mockResolvedValueOnce({items:[{id:1,activity:'like',micro:true,collapsed:true}],hasMore:true,offset:40,cursor:'collapsed'}).mockResolvedValueOnce({items:[{id:2,activity:'post'}],hasMore:false,offset:60,cursor:'visible'});
 await ctx.loadFeed();expect(ctx.api).toHaveBeenCalledTimes(2);expect(ctx.api.mock.calls[1][0]).toContain('cursor=collapsed');expect(ctx.feedHasMore).toBe(false);
 }finally{dom.window.close();}});
test('first micro-only page still pauses auto-loading and nonadvancing cursors are rejected',async()=>{const {dom,ctx}=setup();try{
 ctx.api.mockResolvedValue({items:[{id:1,activity:'like',micro:true}],hasMore:true,offset:20,cursor:'first'});await ctx.loadFeed(true);expect(ctx.api).toHaveBeenCalledTimes(1);expect(ctx.firstBatchMicroOnly).toBe(true);
 ctx.api.mockResolvedValue({items:[],hasMore:true,offset:40,cursor:'first'});await expect(ctx.loadFeed()).rejects.toThrow('Feed cursor did not advance');
 }finally{dom.window.close();}});
