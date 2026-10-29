jest.mock('../lib/Community',()=>({ensure:jest.fn(async()=>{}),sql:jest.fn(async()=>[{title:'Watch',description:'Generic video page',image:'https://youtube.com/favicon.ico',updated_at:new Date()}])}));
const Media=require('../lib/CommunityMedia');
test('cached YouTube channel artwork cannot override the actual video thumbnail',async()=>{const data=await Media.preview('https://www.youtube.com/live/6bSp_7Ig4_s',false);expect(data.image).toBe('https://i.ytimg.com/vi/6bSp_7Ig4_s/hqdefault.jpg');expect(data.video.src).toBe('https://www.youtube-nocookie.com/embed/6bSp_7Ig4_s');});
