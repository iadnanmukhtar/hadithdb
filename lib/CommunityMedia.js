'use strict';
const crypto=require('crypto'),dns=require('dns').promises,http=require('http'),https=require('https'),net=require('net');
const error=require('http-errors'),{load}=require('cheerio');
const C=()=>require('./Community');
const MAX_IMAGE=5*1024*1024;
function urlFor(value){
  try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.href.length>2048||(u.port && !['80','443'].includes(u.port)))return null;const host=u.hostname.replace(/^\[|\]$/g,'');if((net.isIP(host)&&!publicAddress(host))||/(^|\.)(localhost|local|internal|home)$/i.test(host))return null;u.hash='';return u.href;}catch{return null;}
}
function publicAddress(ip){
  if(net.isIP(ip)===4){const [a,b,c]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||(b===88&&c===99)))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));}
  // Only global unicast IPv6; reject mapped, local, documentation and transition ranges.
  return net.isIP(ip)===6 && /^[23][0-9a-f]{3}:/i.test(ip) && !/^(2001:|2002:|3fff:)/i.test(ip);
}
async function fetchHtml(value,redirects=0){
  const normalized=urlFor(value);if(!normalized)throw error(400,'Use a public webpage URL.');
  const u=new URL(normalized),host=u.hostname.replace(/^\[|\]$/g,'');
  let dnsTimer;
  const addresses=net.isIP(host)?[{address:host,family:net.isIP(host)}]:await Promise.race([dns.lookup(host,{all:true}),new Promise((_,reject)=>{dnsTimer=setTimeout(()=>reject(error(408,'Preview DNS timed out.')),2000);})]).finally(()=>clearTimeout(dnsTimer));
  if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw error(400,'Use a public webpage URL.');
  const selected=addresses[0];
  return new Promise((resolve,reject)=>{
    const request=(u.protocol==='https:'?https:http).get(u,{headers:{'User-Agent':'HadithDB-LinkPreview/1.0','Accept':'text/html','Accept-Encoding':'identity'},lookup:(_host,options,cb)=>cb(null,...(options?.all?[[selected]]:[selected.address,selected.family]))},response=>{
      if([301,302,303,307,308].includes(response.statusCode)){
        response.resume();if(redirects>=3)return reject(error(400,'Too many redirects.'));
        let next;try{next=new URL(response.headers.location,u).href;}catch{return reject(error(400,'Invalid redirect.'));}
        fetchHtml(next,redirects+1).then(resolve,reject);return;
      }
      if(response.statusCode!==200||!String(response.headers['content-type']).includes('text/html')){response.resume();return reject(error(400,'This link does not provide a webpage preview.'));}
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>512*1024){request.destroy(error(400,'Page is too large to preview.'));return;}chunks.push(chunk);});
      response.on('end',()=>resolve({html:Buffer.concat(chunks).toString('utf8'),url:u.href}));response.on('error',reject);
    });
    const deadline=setTimeout(()=>request.destroy(error(408,'Preview timed out.')),6000);request.on('close',()=>clearTimeout(deadline));request.on('error',reject);
  });
}
function videoFor(value){
  const valueUrl=urlFor(value);if(!valueUrl)return null;const u=new URL(valueUrl),host=u.hostname.toLowerCase();let id;
  if(['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(host)){
    id=host==='youtu.be'?u.pathname.slice(1).split('/')[0]:u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1];
    if(/^[\w-]{11}$/.test(id||''))return {type:'iframe',src:'https://www.youtube-nocookie.com/embed/'+id};
  }
  if(['vimeo.com','www.vimeo.com','player.vimeo.com'].includes(host)){
    id=u.pathname.match(/(?:^\/|\/video\/)(\d+)(?:\/|$)/)?.[1];if(id)return {type:'iframe',src:'https://player.vimeo.com/video/'+id};
  }
  if(u.protocol==='https:' && /\.(mp4|webm|ogv)$/i.test(u.pathname))return {type:'video',src:u.href};
  return null;
}
function placeholders($){
  $('p').each((_,p)=>{
    const paragraph=$(p),children=paragraph.children();
    if(children.length!==1||children[0].tagName!=='a'||paragraph.text().trim()!==children.text().trim())return;
    const url=urlFor(children.attr('href'));if(!url)return;
    const block=$('<div class="community-link-preview"></div>').attr('data-preview-url',url);
    block.append($('<a></a>').attr({href:url,rel:'ugc nofollow noopener',target:'_blank'}).text(children.text().trim()||new URL(url).hostname));paragraph.replaceWith(block);
  });
}
function extract(html){
  const $=load(html,null,false),seen=new Set(),parts=[];
  $('img,.community-link-preview,a[href]').each((_,el)=>{
    if(parts.length>=4 || $(el).parents('.community-link-preview').length)return;
    const node=$(el),href=node.attr('data-preview-url')||node.attr('href'),src=node.attr('src');
    if(el.tagName==='a'&&!videoFor(href))return;
    const key=src||href;if(!key||seen.has(key))return;seen.add(key);
    if(el.tagName==='a')parts.push($('<div class="community-link-preview"></div>').attr('data-preview-url',href).append(node.clone()).toString());
    else parts.push($.html(el));
  });
  return parts.join('');
}
function imageType(buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length<12||buffer.length>MAX_IMAGE)throw error(400,'Choose an image up to 5 MB.');
  if(buffer.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&buffer.length>=24&&buffer.toString('ascii',12,16)==='IHDR'){
    const w=buffer.readUInt32BE(16),h=buffer.readUInt32BE(20);if(!w||!h||w*h>40000000)throw error(400,'Image dimensions are too large.');return 'image/png';
  }
  if(buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'image/jpeg';
  if(/^GIF8[79]a$/.test(buffer.toString('ascii',0,6))){const w=buffer.readUInt16LE(6),h=buffer.readUInt16LE(8);if(!w||!h||w*h>40000000)throw error(400,'Image dimensions are too large.');return 'image/gif';}
  if(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return 'image/webp';
  throw error(400,'Choose a PNG, JPEG, GIF, or WebP image.');
}
async function upload(user,data){
  const mime=imageType(data);await C().authorFor(user);const id=crypto.randomBytes(16).toString('hex');
  await C().transaction(async q=>{
    await q('SELECT uid FROM community_authors WHERE uid=? FOR UPDATE',[user.uid]);
    const [quota]=await q('SELECT COALESCE(SUM(bytes),0) bytes,SUM(created_at>DATE_SUB(NOW(),INTERVAL 1 HOUR)) recent FROM community_media WHERE user_uid=?',[user.uid]);
    if(Number(quota.bytes)+data.length>100*1024*1024||Number(quota.recent)>=20)throw error(429,'Image upload limit reached. Please try again later.');
    await q('INSERT INTO community_media (id,user_uid,mime,bytes,data) VALUES (?,?,?,?,?)',[id,user.uid,mime,data.length,data]);
  });
  return {url:'/community/media/'+id,mime};
}
async function image(id,user){
  if(!/^[a-f0-9]{32}$/.test(id))throw error(404,'Image not found.');await C().ensure();
  const rows=await C().sql(`SELECT m.mime,m.data FROM community_media m WHERE m.id=? AND (m.user_uid=? OR ? OR EXISTS(
    SELECT 1 FROM community_posts p WHERE p.author_uid=m.user_uid AND p.status='published' AND (LOCATE(CONCAT('/community/media/',m.id),p.public_markdown)>0 OR p.public_cover_url=CONCAT('/community/media/',m.id))
  ) OR EXISTS(SELECT 1 FROM community_posts p JOIN community_blog_imports l ON l.post_id=p.id WHERE p.author_uid=m.user_uid AND p.status='published' AND p.public_cover_url IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(l.attributes_json,'$.cover'))=CONCAT('/community/media/',m.id)) OR EXISTS(SELECT 1 FROM community_comments c JOIN community_posts p ON p.id=c.post_id WHERE c.author_uid=m.user_uid AND c.deleted=0 AND p.status='published' AND LOCATE(CONCAT('/community/media/',m.id),c.markdown)>0))`,[id,user?.uid||'',C().moderator(user)?1:0]);
  if(!rows.length)throw error(404,'Image not found.');return rows[0];
}
function metadata(html,url){
  const $=load(html);const meta=name=>$(`meta[property="${name}"],meta[name="${name}"]`).first().attr('content');
  const title=String(meta('og:title')||$('title').first().text()||new URL(url).hostname).trim().slice(0,300);
  const description=String(meta('og:description')||meta('description')||'').trim().slice(0,600);
  let image;try{const raw=meta('og:image');if(raw)image=urlFor(new URL(raw,url).href);}catch{}
  if(image && new URL(image).protocol!=='https:')image=null;
  return {title,description,image:image||null};
}
async function preview(value,refresh=false){
  let parsed;try{parsed=new URL(value);}catch{throw error(400,'Enter a valid webpage or video URL.');}
  const siteOrigins=[global.settings?.site?.url,global.settings?.blog?.url].filter(Boolean).map(base=>new URL(base).origin);
  const ownBlog=siteOrigins.includes(parsed.origin) && parsed.pathname.startsWith('/blog/') && !parsed.username && !parsed.password;
  const url=ownBlog?parsed.href:urlFor(value);if(!url)throw error(400,'Enter a valid webpage or video URL.');await C().ensure();
  if(ownBlog) {
    let slug;try{slug=decodeURIComponent(parsed.pathname.slice(6));}catch{slug='';}
    const [row]=await C().sql("SELECT p.public_title,p.public_cover_url,p.public_subtitle,l.attributes_json FROM community_blog_imports l JOIN community_posts p ON p.id=l.post_id WHERE l.slug=? AND p.status='published'",[slug]);
    if(row){const meta=JSON.parse(row.attributes_json);let cover=(row.public_cover_url ?? meta.cover) || '/static/img/pearls_of_the_deep.jpg';
      const image=new URL(cover,global.settings.blog?.url.replace(/\/$/,'')+'/').href;
      return {url,title:row.public_title,description:row.public_subtitle ?? meta.subtitle ?? meta.description ?? '',image:/^https?:/.test(image)?image:null,video:null};}
    if(!urlFor(url))throw error(404,'Blog post not found.');
  }
  const hash=crypto.createHash('sha256').update(url).digest('hex');
  const [cached]=await C().sql('SELECT title,description,image,updated_at FROM community_link_previews WHERE url_hash=?',[hash]);
  const video=videoFor(url);
  const youtubeId=video?.src.match(/youtube-nocookie\.com\/embed\/([\w-]{11})$/)?.[1];
  let result=cached||{title:video?'Video on '+new URL(url).hostname:new URL(url).hostname,description:'',image:youtubeId?'https://i.ytimg.com/vi/'+youtubeId+'/hqdefault.jpg':null};
  if(refresh&&!video&&(!cached||Date.now()-new Date(cached.updated_at).getTime()>86400000)){
    try{const fetched=await fetchHtml(url);result=metadata(fetched.html,fetched.url);
      await C().sql('INSERT INTO community_link_previews (url_hash,url,title,description,image) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),description=VALUES(description),image=VALUES(image),updated_at=CURRENT_TIMESTAMP(3)',[hash,url,result.title,result.description,result.image]);
    }catch{ /* Keep a useful link/video card when metadata is unavailable. */ }
  }
  return {url,title:result.title,description:result.description,image:result.image,video:videoFor(url)};
}
async function prepare(markdown){
  const $=load(C().content(markdown).html,null,false);
  const urls=[...new Set($('.community-link-preview').map((_,el)=>$(el).attr('data-preview-url')).get())].slice(0,3);
  await Promise.all(urls.map(url=>preview(url,true)));return C().content(markdown);
}
module.exports={urlFor,publicAddress,videoFor,placeholders,extract,imageType,upload,image,preview,prepare,metadata,fetchHtml};
