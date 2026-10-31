const ejs=require('ejs'),{load}=require('cheerio');
const entry={title:'A <thoughtful> article',subtitle:'English and العربية',authorName:'Amina',authorPhoto:'/avatar.jpg',cover:'/cover.jpg',url:'/blog/example',published:new Date('2026-10-29T12:00:00Z')};
test.each([false,true])('blog cover renders author and safe title with correct heading (detail=%s)',async detail=>{const $=load(await ejs.renderFile('views/sub-views/blog_cover.ejs',{entry,detail}));expect($('.community-cover-author').text()).toBe('Amina');expect($('.community-cover-author img').attr('src')).toBe('/avatar.jpg');expect($(detail?'h1':'h2').text()).toBe(entry.title);expect($('thoughtful').length).toBe(0);expect($('.community-cover-image').length).toBe(1);expect($('time').attr('datetime')).toBe(entry.published.toISOString());if(!detail)expect($('a').attr('href')).toBe(entry.url);else expect($('header').length).toBe(1);});
test('cover fallback keeps the author and subtitle without an unsafe image',async()=>{const $=load(await ejs.renderFile('views/sub-views/blog_cover.ejs',{entry:{...entry,cover:'javascript:bad',authorPhoto:'data:bad'},detail:true}));expect($('img').length).toBe(0);expect($('.community-cover-unavailable').length).toBe(1);expect($('.community-cover-subtitle').text()).toBe(entry.subtitle);});
test.each([false,true])('cover has independent profile, handle and follow controls (detail=%s)',async detail=>{
 const $=load(await ejs.renderFile('views/sub-views/blog_cover.ejs',{entry:{...entry,authorHandle:'amina'},detail}));
 expect($('.community-cover-identity a').attr('href')).toBe('/community/@amina');
 expect($('.community-cover-handle').text()).toBe('@amina');
 expect($('[data-cover-follow]').attr('data-cover-follow')).toBe('amina');
 expect($('[data-cover-follow]').parents('a').length).toBe(0);
 if(!detail)expect($('.community-cover-destination').attr('href')).toBe(entry.url);
});
