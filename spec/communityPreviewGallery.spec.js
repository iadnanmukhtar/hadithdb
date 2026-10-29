'use strict';
const fs=require('fs'),{JSDOM}=require('jsdom');
test('cover and pasted images render once in a bottom carousel without moving link thumbnails',()=>{
 const dom=new JSDOM('<main id="community"><div id="community-preview"></div></main>',{runScripts:'outside-only'}),w=dom.window;
 try{
 w.eval(fs.readFileSync('public/static/js/community-media.js','utf8'));
 const preview=w.document.getElementById('community-preview'),cover='/community/media/'+'a'.repeat(32);
 w.communityRenderPostPreview(preview,'<p>Before<img src="'+cover+'" alt="Pasted cover">After</p><p><img src="https://example.test/photo.png"></p><div class="community-link-preview"><img src="https://example.test/thumb.png"></div><p>Last paragraph</p>',cover);
 const gallery=preview.lastElementChild;
 expect(gallery.className).toBe('community-preview-gallery');
 expect(gallery.querySelectorAll('img')).toHaveLength(2);
 expect(gallery.querySelector('img').dataset.mediaSrc).toBe(cover);
 expect(preview.querySelector('.community-link-preview img')).not.toBeNull();
 expect(preview.textContent).toContain('BeforeAfter');
 expect(gallery.previousElementSibling.textContent).toBe('Last paragraph');
 const track=gallery.querySelector('.community-preview-images');track.scrollBy=jest.fn();gallery.querySelectorAll('button')[1].click();expect(track.scrollBy).toHaveBeenCalled();
 w.communityRenderPostPreview(preview,'<p>No images</p>');expect(preview.querySelector('.community-preview-gallery')).toBeNull();
 }finally{w.close();}
});
test('article fields place subtitle between title and cover',()=>{
 const template=fs.readFileSync('views/community.ejs','utf8');
 expect(template.indexOf('id="community-subtitle"')).toBeGreaterThan(template.indexOf('id="community-title"'));
 expect(template.indexOf('id="community-subtitle"')).toBeLessThan(template.indexOf('id="community-cover-controls"'));
});
