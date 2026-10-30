const fs=require('fs'),vm=require('vm'),{JSDOM}=require('jsdom');
const script=fs.readFileSync('public/static/js/community.js','utf8');
const handler=script.slice(script.indexOf("  $('quick-form')?.addEventListener('submit'"),script.indexOf("  if ($('quick-form')) window.addEventListener('beforeunload'"));
test.each([true,false])('post save navigates to reading view only for updates (updating=%s)',async updating=>{
 const dom=new JSDOM('<form id="quick-form"></form><textarea id="quick-text">Text</textarea><input id="quick-title"><div id="quick-edit-actions"></div><a id="quick-new-article"></a><button id="quick-post"></button><dialog id="quick-dialog"></dialog><div id="quick-preview"></div><div id="quick-status"></div>');try{
 const $=id=>dom.window.document.getElementById(id);let submit;
 $('quick-form').addEventListener=(name,callback)=>{submit=callback;};$('quick-dialog').close=()=>{};
 const ctx=vm.createContext({$,document:dom.window.document,window:{},quickBusy:false,epoch:1,quickPreviewRequest:0,quickEditing:updating?{id:3,status:'published'}:null,quickCover:'',syncQuickComposer:()=>{},showQuickCover:()=>{},status:()=>{},link:()=>dom.window.document.createElement('a'),location:{assign:jest.fn()},api:async()=>({post:{id:3,status:'published',url:'/community/p/stable-guid'}})});
 vm.runInContext(handler,ctx);await submit({preventDefault(){}});expect(ctx.location.assign).toHaveBeenCalledWith(updating?'/community/p/stable-guid':'/community/mine');
 }finally{dom.window.close();}
});
