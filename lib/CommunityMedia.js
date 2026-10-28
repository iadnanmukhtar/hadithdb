'use strict';
const crypto=require('crypto'),dns=require('dns').promises,http=require('http'),https=require('https'),net=require('net');
const error=require('http-errors'),{load}=require('cheerio');
const C=()=>require('./Community');
const MAX_IMAGE=5*1024*1024;
const sourcePreview=require('./CommunitySourcePreview').preview;
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
      const chunks=[];let size=0,complete=false;
      response.on('data',chunk=>{if(complete)return;const remaining=512*1024-size;chunks.push(chunk.subarray(0,remaining));size+=Math.min(chunk.length,remaining);if(size>=512*1024){complete=true;resolve({html:Buffer.concat(chunks).toString('utf8'),url:u.href});response.destroy();}});
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
    const url=sourcePreview(children.attr('href'))?.url || urlFor(children.attr('href'));if(!url)return;
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
  const accessSql=`FROM community_media m WHERE m.id=? AND (m.user_uid=? OR ? OR EXISTS(
    SELECT 1 FROM community_posts p WHERE p.author_uid=m.user_uid AND p.status='published' AND (LOCATE(CONCAT('/community/media/',m.id),p.public_markdown)>0 OR p.public_cover_url=CONCAT('/community/media/',m.id))
  ) OR EXISTS(SELECT 1 FROM community_posts p JOIN community_blog_imports l ON l.post_id=p.id WHERE p.author_uid=m.user_uid AND p.status='published' AND p.public_cover_url IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(l.attributes_json,'$.cover'))=CONCAT('/community/media/',m.id)) OR EXISTS(SELECT 1 FROM community_comments c JOIN community_posts p ON p.id=c.post_id WHERE c.author_uid=m.user_uid AND c.deleted=0 AND p.status='published' AND LOCATE(CONCAT('/community/media/',m.id),c.markdown)>0))`;
  const args=[id,user?.uid||'',C().moderator(user)?1:0];
  const Cache=require('./CommunityMediaCache');
  const deny=async()=>{await Cache.remove(id).catch(()=>{});throw error(404,'Image not found.');};
  const rows=await C().sql(`SELECT m.mime,m.bytes,m.created_at,EXISTS(
    SELECT 1 FROM community_posts p
    LEFT JOIN community_blog_posts b ON b.post_id=p.id
    LEFT JOIN community_blog_imports l ON l.post_id=p.id
    WHERE p.author_uid=m.user_uid AND p.status='published' AND p.kind='article'
      AND (b.post_id IS NOT NULL OR l.post_id IS NOT NULL)
      AND (p.public_cover_url=CONCAT('/community/media/',m.id)
        OR (p.public_cover_url IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(l.attributes_json,'$.cover'))=CONCAT('/community/media/',m.id)))
  ) AS blog_cacheable `+accessSql,args);
  if(!rows.length)return deny();
  const fetchImage=async()=>{
    const images=await C().sql('SELECT m.mime,m.data '+accessSql,args);
    if(!images.length)return deny();
    return images[0];
  };
  const cacheable=Number(rows[0].blog_cacheable)===1;
  if(!cacheable)await Cache.remove(id).catch(()=>{});
  const result=cacheable ? await Cache.load(id,rows[0],fetchImage) : await fetchImage();
  return {...result,cacheable};
}
function metadata(html,url){
  const $=load(html);const meta=name=>$(`meta[property="${name}"],meta[name="${name}"]`).first().attr('content');
  const clean=require('./CommunitySourcePreview').plain;
  const title=clean(meta('og:title')||meta('twitter:title')||$('title').first().text()||$('main h1,article h1,h1').first().text()||new URL(url).hostname).slice(0,300);
  const body=$('article,main').first().clone();body.find('script,style,nav,header,footer,aside,form').remove();
  const paragraphs=body.find('p').map((_,p)=>clean($(p).text())).get().filter(text=>text.length>=50);
  const description=require('./CommunitySourcePreview').excerpt(meta('og:description')||meta('twitter:description')||meta('description')||paragraphs.slice(0,2).join(' '),600);
  let image=null;
  const candidates=[meta('og:image:secure_url'),meta('og:image'),meta('og:image:url'),meta('twitter:image'),$('article img,main img').first().attr('src'),$('link[rel="apple-touch-icon"],link[rel="icon"]').first().attr('href')];
  for(const raw of candidates){try{if(raw){const candidate=urlFor(new URL(raw,url).href);if(candidate&&new URL(candidate).protocol==='https:'){image=candidate;break;}}}catch{}}
  return {title,description,image};
}
// Only explicit Open Graph fields override the source-aware fallback.
function openGraph(html,url) {
  const $=load(html), result={};
  const value=name=>$(`meta[property="${name}"],meta[name="${name}"]`).map((_,node)=>$(node).attr('content')?.trim()).get().find(Boolean);
  const Source=require('./CommunitySourcePreview');
  const title=Source.plain(value('og:title')),description=Source.excerpt(value('og:description'),600);
  if(title)result.title=title.slice(0,300);
  if(description)result.description=description;
  for(const raw of [value('og:image:secure_url'),value('og:image'),value('og:image:url')]) {
    try {const image=raw&&urlFor(new URL(raw,url).href);if(image&&new URL(image).protocol==='https:'){result.image=image;result.imageKind='cover';break;}} catch (_) {}
  }
  return result;
}
async function sourceOpenGraph(value) {
  if(!urlFor(value))return {}; // Local/private previews never trigger server-side fetching.
  try {const page=await module.exports.fetchHtml(value);return openGraph(page.html,page.url);} catch (_) {return {};}
}
function fallbackMetadata(value) {
  const parsed=new URL(value);
  let segment=parsed.pathname.split('/').filter(Boolean).pop() || '';
  try{segment=decodeURIComponent(segment);}catch{}
  segment=segment.replace(/\.(?:html?|php|aspx?)$/i,'').replace(/[-_]+/g,' ').trim();
  const title=segment ? segment.charAt(0).toUpperCase()+segment.slice(1) : parsed.hostname;
  const image = new URL('/apple-touch-icon.png', parsed.origin).href;
  return {title:title.slice(0,300),description:`Read ${title} on ${parsed.hostname}.`,image};
}
function completePreview(data,url) {
  const fallback=fallbackMetadata(url),hostname=new URL(url).hostname;
  if (data.image && /\/api\/community\/(?:source|link)-preview-image\?/.test(data.image)) data={...data,image:null};
  return {...data,title:data.title && data.title!==hostname?data.title:fallback.title,description:data.description || fallback.description,image:data.image || fallback.image};
}
const sourcePreviewRequests=new Map();
async function cachedSourcePreview(value,source) {
  // Separate these rich source records from older hostname-only generic entries.
  const hash=crypto.createHash('sha256').update('source-v1:'+value).digest('hex');
  let cached,cacheAvailable=false;
  try {
    await C().ensure();cacheAvailable=true;
    [cached]=await C().sql('SELECT title,description,image,updated_at FROM community_link_previews WHERE url_hash=?',[hash]);
  } catch (_) { /* A cache outage must not prevent a source preview. */ }
  const usable=cached?.title && cached?.description && cached?.image && !/\/api\/community\/(?:source|link)-preview-image\?/.test(cached.image);
  const current=usable ? {...source,title:cached.title,description:cached.description,image:cached.image,imageKind:'icon'} : null;
  if(current && Date.now()-new Date(cached.updated_at).getTime()<86400000)return current;
  if(!sourcePreviewRequests.has(value)) {
    const work=(async()=>{
      const [fallback,og]=await Promise.all([require('./CommunitySourcePreview').enrich(value),sourceOpenGraph(value)]);
      const result={...fallback,...og};
      if(cacheAvailable)try {
        await C().sql('INSERT INTO community_link_previews (url_hash,url,title,description,image) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),description=VALUES(description),image=VALUES(image),updated_at=CURRENT_TIMESTAMP(3)',[hash,value,result.title,result.description,result.image]);
      } catch (_) { /* Still return the completed preview. */ }
      return result;
    })();
    sourcePreviewRequests.set(value,work);
    work.finally(()=>sourcePreviewRequests.delete(value)).catch(()=>{});
  }
  const pending=sourcePreviewRequests.get(value);
  // Existing cards remain fast while stale metadata refreshes in the background.
  if(current){pending.catch(()=>{});return current;}
  return pending;
}
async function preview(value,refresh=true){
  const source=sourcePreview(value);if(source)return cachedSourcePreview(value,source);
  let parsed;try{parsed=new URL(value);}catch{throw error(400,'Enter a valid webpage or video URL.');}
  const siteOrigins=[global.settings?.site?.url,global.settings?.blog?.url].filter(Boolean).map(base=>new URL(base).origin);
  const ownBlog=siteOrigins.includes(parsed.origin) && parsed.pathname.startsWith('/blog/') && !parsed.username && !parsed.password;
  const url=ownBlog?parsed.href:urlFor(value);if(!url)throw error(400,'Enter a valid webpage or video URL.');await C().ensure();
  if(ownBlog) {
    let slug;try{slug=decodeURIComponent(parsed.pathname.slice(6));}catch{slug='';}
    const [row]=await C().sql("SELECT p.public_title,p.public_cover_url,p.public_subtitle,l.attributes_json FROM community_blog_imports l JOIN community_posts p ON p.id=l.post_id WHERE l.slug=? AND p.status='published'",[slug]);
    if(row){const meta=JSON.parse(row.attributes_json);let cover=(row.public_cover_url ?? meta.cover) || '/static/img/pearls_of_the_deep.jpg';
      const image=new URL(cover,global.settings.blog?.url.replace(/\/$/,'')+'/').href;
      return {url,...completePreview({title:row.public_title,description:row.public_subtitle ?? meta.subtitle ?? meta.description ?? '',image:/^https?:/.test(image)?image:null},url),...await sourceOpenGraph(value),video:null};}
    if(!urlFor(url))throw error(404,'Blog post not found.');
  }
  const hash=crypto.createHash('sha256').update(url).digest('hex');
  const [cached]=await C().sql('SELECT title,description,image,updated_at FROM community_link_previews WHERE url_hash=?',[hash]);
  const video=videoFor(url);
  const youtubeId=video?.src.match(/youtube-nocookie\.com\/embed\/([\w-]{11})$/)?.[1];
  let result=cached||{title:video?'Video on '+new URL(url).hostname:new URL(url).hostname,description:'',image:youtubeId?'https://i.ytimg.com/vi/'+youtubeId+'/hqdefault.jpg':null};
  const incomplete=cached&&(!cached.image||!cached.description||!cached.title||cached.title===new URL(url).hostname);
  if(refresh&&(!cached||incomplete||Date.now()-new Date(cached.updated_at).getTime()>86400000)){
    try{const fetched=await fetchHtml(url);result=completePreview(metadata(fetched.html,fetched.url),url);
      await C().sql('INSERT INTO community_link_previews (url_hash,url,title,description,image) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),description=VALUES(description),image=VALUES(image),updated_at=CURRENT_TIMESTAMP(3)',[hash,url,result.title,result.description,result.image]);
    }catch{ /* Keep a useful link/video card when metadata is unavailable. */ }
  }
  return {url,...completePreview(result,url),video:videoFor(url)};
}
async function prepare(markdown){
  // Link metadata and images hydrate independently; saving or posting never waits for them.
  return C().content(markdown);
}
module.exports={urlFor,publicAddress,videoFor,placeholders,extract,imageType,upload,image,preview,prepare,metadata,fetchHtml,openGraph};
