'use strict';
const fs=require('fs');
const {JSDOM}=require('jsdom');
const inline=fs.readFileSync('views/sub-views/scripts.ejs','utf8');
const legacy=fs.readFileSync('public/static/js/script.js','utf8');
const admin=inline.slice(inline.indexOf('  let adminPageLinkCheck'),inline.indexOf('  function hadithLoginPath'));
const render=inline.slice(inline.indexOf('    const render = (user) => {',inline.indexOf('initNavAuth')),inline.indexOf('    const attachHandlers',inline.indexOf('initNavAuth')));
function setup(){
 const dom=new JSDOM('<div id="nav-auth-desktop" data-settings-href="/quran/settings" data-profile-href="https://hadith.test/community/mine"></div><div id="nav-auth-mobile" data-settings-href="/quran/settings" data-profile-href="https://hadith.test/community/mine"></div><ul data-more-menu></ul><div id="offcanvas-topnav"><ul class="offcanvas-col1"></ul></div>',{url:'https://quran.test',runScripts:'outside-only'});
 const w=dom.window;
 w.session={token:'verified'};w.readHadithLoginSessionCache=()=>w.session;w.hadithAdminSessionChecked=true;
 w.fetch=jest.fn(async()=>({ok:true}));w.setHadithEditMode=jest.fn();w.getHadithEditMode=()=>false;w.setHadithAdminMode=jest.fn();
 w.eval(admin);
 w.eval('const desktopSlot=document.getElementById("nav-auth-desktop"),mobileSlot=document.getElementById("nav-auth-mobile");const attachHandlers=()=>{},renderGoogleButtons=()=>{};'+render+';window.renderMenu=render;');
 return dom;
}
test('signed-in menus preserve destinations on desktop/mobile and sign-out removes private links',async()=>{
 const dom=setup(),w=dom.window;
 try{
 w.renderMenu({displayName:'User',photoURL:'https://example.test/photo.png'});
 expect(w.document.querySelectorAll('[data-profile-menu]')).toHaveLength(2);
 for(const menu of w.document.querySelectorAll('[data-profile-menu]')){
  expect(menu.querySelector('[data-profile-link]').href).toBe('https://hadith.test/community/mine');
  expect(menu.querySelector('[data-settings-link]').pathname).toBe('/quran/settings');
  expect(menu.querySelector('[data-notebook-link]').pathname).toBe('/notebook');
  expect(menu.querySelector('[data-bookmarks-link]').pathname).toBe('/bookmarks');
  expect(menu.querySelector('.admin-menu-divider')).toBeNull();
  expect(menu.querySelector('.admin-page-link')).toBeNull();
 }
 w.renderMenu(null);expect(w.document.querySelectorAll('[data-profile-menu]')).toHaveLength(0);
 }finally{w.close();}
});
test.each(['inline','legacy'])('%s admin rendering only adds verified links inside profile menus',async source=>{
 const dom=setup(),w=dom.window;
 try{
 if(source==='legacy')w.eval(legacy.slice(legacy.indexOf('function renderHadithAdminGear()'),legacy.indexOf('function hadithLoginPath')));
 w.hadithAdmin=true;w.renderMenu({displayName:'Admin'});await w.ensureAdminPageLinks();
 expect(w.document.querySelectorAll('[data-profile-menu] .admin-page-link')).toHaveLength(2);
 expect(w.document.querySelectorAll('[data-profile-menu] .edit-gear')).toHaveLength(2);
 for(const menu of w.document.querySelectorAll('[data-profile-menu]')) {
  expect(menu.querySelectorAll('.admin-menu-divider')).toHaveLength(2);
  expect(menu.querySelector('.admin-page-link').previousElementSibling.classList.contains('admin-menu-divider')).toBe(true);
  expect(menu.querySelector('[data-profile-signout]').previousElementSibling.classList.contains('admin-menu-divider')).toBe(true);
 }
 expect(w.document.querySelector('[data-more-menu]').children).toHaveLength(0);
 expect(w.document.querySelectorAll('.offcanvas-col1 .edit-gear')).toHaveLength(1);
 for (const toggle of w.document.querySelectorAll('.edit-gear')) {
  expect(toggle.querySelector('[data-edit-mode="false"]').getAttribute('aria-pressed')).toBe('true');
  toggle.querySelector('[data-edit-mode="false"]').click();
 }
 expect(w.setHadithAdminMode).not.toHaveBeenCalled();
 w.document.querySelector('.edit-gear [data-edit-mode="true"]').click();expect(w.setHadithAdminMode).toHaveBeenCalledWith(true);
 w.getHadithEditMode=()=>true;w.renderHadithAdminGear();
 expect(w.document.querySelectorAll('.edit-gear')).toHaveLength(3);
 for (const toggle of w.document.querySelectorAll('.edit-gear')) {
  expect(toggle.querySelector('[data-edit-mode="true"]').getAttribute('aria-pressed')).toBe('true');
  expect(toggle.querySelector('[data-edit-mode="false"]').getAttribute('aria-pressed')).toBe('false');
 }
 w.document.querySelector('.offcanvas-col1 [data-edit-mode="false"]').click();expect(w.setHadithAdminMode).toHaveBeenLastCalledWith(false);
 w.hadithAdmin=false;w.renderHadithAdminGear();expect(w.document.querySelectorAll('.admin-page-link,.edit-gear')).toHaveLength(0);
 }finally{w.close();}
});
test('a rejected admin session never adds the Admin link',async()=>{
 const dom=setup(),w=dom.window;
 try{w.fetch=jest.fn(async()=>({ok:false}));w.hadithAdmin=true;w.renderMenu({displayName:'User'});await w.ensureAdminPageLinks();expect(w.document.querySelectorAll('.admin-page-link')).toHaveLength(0);}finally{w.close();}
});
