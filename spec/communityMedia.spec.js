'use strict';
const Media=require('../lib/CommunityMedia');
const {load}=require('cheerio');
test('preview URLs reject unsafe schemes and credentials',()=>{
 for(const url of ['javascript:alert(1)','file:///etc/passwd','https://user:password@example.com','https://example.com:123/'])expect(Media.urlFor(url)).toBeNull();
 expect(Media.urlFor('https://example.com/a#heading')).toBe('https://example.com/a');
});
test('preview networking rejects private and reserved IPv4/IPv6',async()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1','fd00::1','fe80::1','2001:db8::1'])expect(Media.publicAddress(ip)).toBe(false);
 expect(Media.publicAddress('8.8.8.8')).toBe(true);expect(Media.publicAddress('2606:4700:4700::1111')).toBe(true);
 await expect(Media.fetchHtml('http://127.0.0.1/')).rejects.toMatchObject({status:400});
});
test('only supported video providers and direct media links become players',()=>{
 expect(Media.videoFor('https://youtu.be/dQw4w9WgXcQ')).toEqual({type:'iframe',src:'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'});
 expect(Media.videoFor('https://vimeo.com/12345').src).toBe('https://player.vimeo.com/video/12345');
 expect(Media.videoFor('https://example.com/movie.mp4').type).toBe('video');
 expect(Media.videoFor('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ')).toBeNull();
});
test('standalone links get cards; inline links retain their context',()=>{
 const $=load('<p><a href="https://example.com">Example</a></p><p>Read <a href="https://example.com">this</a> next.</p>',null,false);Media.placeholders($);
 expect($('.community-link-preview')).toHaveLength(1);expect($('p').text()).toBe('Read this next.');
});
test('metadata stays text and uploads reject active or oversized formats',()=>{
 expect(Media.metadata('<title>Title</title><meta name="description" content="Summary">','https://example.com')).toMatchObject({title:'Title',description:'Summary'});
 expect(()=>Media.imageType(Buffer.from('<svg onload="alert(1)"></svg>'))).toThrow();
 expect(()=>Media.imageType(Buffer.alloc(5*1024*1024+1))).toThrow();
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=','base64');
 expect(Media.imageType(png)).toBe('image/png');
});

test('feed media includes inline video links without duplicating standalone previews', () => {
  const Media=require('../lib/CommunityMedia');
  const html='<p>Watch <a href="https://www.youtube.com/watch?v=6bSp_7Ig4_s">this talk</a>.</p><div class="community-link-preview" data-preview-url="https://www.youtube.com/watch?v=6bSp_7Ig4_s"><a href="https://www.youtube.com/watch?v=6bSp_7Ig4_s">Video</a></div>';
  const result=Media.extract(html);
  expect((result.match(/data-preview-url=/g)||[])).toHaveLength(1);
  expect(result).toContain('6bSp_7Ig4_s');
});
