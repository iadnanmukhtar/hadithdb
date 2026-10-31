(function () {
  'use strict';
  function videoSlide(value) {
    let url; try { url = new URL(value); } catch { return null; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(host)) {
      const id = host === 'youtu.be' ? url.pathname.split('/')[1] : url.searchParams.get('v') || url.pathname.match(/^\/(?:live|shorts|embed)\/([^/]+)/)?.[1];
      if (!/^[\w-]{11}$/.test(id || '')) return null;
      return {src:'https://i.ytimg.com/vi/'+id+'/maxresdefault.jpg', fallback:'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg', alt:'YouTube video preview', video:'https://www.youtube-nocookie.com/embed/'+id, type:'iframe', source:'YouTube', url:url.href};
    }
    if (['vimeo.com','www.vimeo.com','player.vimeo.com'].includes(host)) {
      const id = url.pathname.match(/(?:^\/|\/video\/)(\d+)(?:\/|$)/)?.[1];
      if (id) return {src:'',alt:'Vimeo video preview',video:'https://player.vimeo.com/video/'+id,type:'iframe',source:'Vimeo',url:url.href};
    }
    if (url.protocol === 'https:' && /\.(mp4|webm|ogv)$/i.test(url.pathname)) return {src:'',alt:'Video preview',video:url.href,type:'video',source:host,url:url.href};
    return null;
  }
  function enhance(article, item) {
    if (!['article', 'note'].includes(article.dataset.kind) || article.querySelector('.community-cover-card')) return;
    const firstVideo = Array.from(article.querySelectorAll('.community-feed-media [data-preview-url]')).map(block=>videoSlide(block.dataset.previewUrl)).find(Boolean);
    const cover = item.coverUrl || firstVideo?.src || '';
    if (cover ? !/^(https?:\/\/|\/(?!\/))/i.test(cover) : !firstVideo) return;
    const card = document.createElement('div');
    card.className = 'community-cover-card';
    const image = document.createElement('img');
    image.className = 'community-cover-image'; if(cover)image.src = cover; image.alt = ''; image.loading = 'lazy';
    function fallbackImage() {
      const fallback = image.dataset.fallbackSrc;
      if (fallback && image.src !== fallback) { image.dataset.fallbackSrc = ''; image.src = fallback; return; }
      image.hidden = true; card.classList.add('community-cover-unavailable');
    }
    image.addEventListener('error', fallbackImage);
    image.addEventListener('load', () => { if (image.dataset.fallbackSrc && image.naturalWidth <= 120) fallbackImage(); });
    const copy = document.createElement('div'); copy.className = 'community-cover-copy';
    const byline = document.createElement('div'); byline.className = 'community-cover-author';
    const avatar = article.querySelector('.community-entry-meta .community-avatar');
    if (avatar) { const photo = document.createElement('span'); photo.className = 'community-avatar'; photo.setAttribute('aria-hidden', 'true'); photo.append(...Array.from(avatar.childNodes, child => child.cloneNode(true))); byline.append(photo); }
    const handle = item.author?.handle || item.authorHandle || article.dataset.coverAuthorHandle;
    const identity = document.createElement('span'); identity.className = 'community-cover-identity';
    const author = document.createElement(handle ? 'a' : 'span'); author.textContent = item.authorName || ''; author.dir = 'auto';
    if (handle) author.href = '/community/@' + handle;
    identity.append(author); byline.append(identity);
    if (handle) {
      const label = document.createElement('span'); label.className = 'community-cover-handle'; label.dir = 'ltr'; label.textContent = '@' + handle; identity.append(label);
      const follow = document.createElement('button'); follow.type = 'button'; follow.className = 'btn btn-sm btn-outline-light community-cover-follow'; follow.dataset.coverFollow = handle; follow.textContent = 'Follow'; byline.append(follow);
    }
    copy.append(byline);
    for (const [tag, className, text] of [['h2','community-cover-title',item.title],['p','community-cover-subtitle',item.subtitle],['p','community-cover-excerpt',item.excerpt]]) {
      if (!text) continue;
      const el = document.createElement(tag); el.className = className; el.textContent = text; el.dir = 'auto';
      if (tag === 'h2') { const destination = document.createElement('a'); destination.className = 'community-cover-destination'; destination.href = item.url; destination.textContent = text; el.replaceChildren(destination); }
      copy.append(el);
    }
    if (!copy.querySelector('.community-cover-destination')) {
      const destination = document.createElement('a'); destination.className = 'community-cover-destination'; destination.href = item.url;
      const label = document.createElement('span'); label.className = 'visually-hidden'; label.textContent = 'Read post'; destination.append(label); copy.append(destination);
    }
    card.append(image, copy);
    const content = Array.from(article.children).filter(el => el.matches('.community-entry-title,.community-article-subtitle,.community-entry-excerpt,.community-reflection-body'));
    const anchor = content[0] || article.querySelector('.community-entry-actions');
    article.insertBefore(card, anchor);
    content.forEach(el => el.remove());
    const slides = [!item.coverUrl && firstVideo ? firstVideo : {src: image.src, alt: ''}];
    const seen = new Set([image.src]);
    for (const img of article.querySelectorAll('.community-feed-media img')) {
      // Embedded link previews keep their own destination and artwork.
      if (img.closest('.community-link-preview') && !img.closest('.community-blog-preview')) continue;
      if (!seen.has(img.src)) { slides.push({src:img.src, alt:img.alt || ''}); seen.add(img.src); }
      const preview = img.closest('.community-blog-preview');
      if (preview) { preview.closest('.community-link-preview')?.remove(); continue; }
      const parent = img.parentElement; img.remove();
      if (parent && !parent.textContent.trim() && !parent.children.length) parent.remove();
    }
    const videoKeys = new Set(slides.filter(slide=>slide.video).map(slide=>slide.video));
    for (const block of article.querySelectorAll('.community-feed-media .community-link-preview[data-preview-url], .community-feed-media video')) {
      const slide = videoSlide(block.dataset.previewUrl || block.currentSrc || block.src || block.querySelector('source')?.src);
      if (!slide) continue;
      if (!videoKeys.has(slide.video)) {
        if (!slide.src) slide.src = block.poster || block.querySelector('img')?.src || '';
        videoKeys.add(slide.video); slides.push(slide);
      }
      block.remove();
    }
    for (const media of article.querySelectorAll('.community-feed-media')) {
      if (!media.textContent.trim() && !media.querySelector('img,video,iframe,a,[data-preview-url]')) media.remove();
    }
    if (slides.length > 1 || slides[0].video) {
      const carousel = document.createElement('section');
      carousel.className = 'community-cover-carousel';
      carousel.setAttribute('aria-label', 'Article media');
      carousel.setAttribute('aria-roledescription', 'carousel');
      card.replaceWith(carousel); carousel.append(card);
      const track = document.createElement('div'); track.className = 'community-cover-track'; track.tabIndex = 0;
      track.setAttribute('aria-label', 'Swipe or use left and right arrow keys to browse media');
      image.remove();
      const panels = slides.map((slide, position) => {
        const panel = document.createElement('a'); panel.className = 'community-cover-slide'; panel.href = item.url; panel.draggable = false;
        panel.setAttribute('aria-label', (slide.video ? slide.source + ' video' : 'Image') + ' ' + (position+1) + ' of ' + slides.length);
        const img = document.createElement('img'); img.className = 'community-slide-image'; img.alt = slide.alt; img.draggable = false; img.loading = 'lazy';
        if(slide.src)img.src=slide.src;else img.hidden=true;
        if(position === 0 || slide.video)panel.classList.add('community-slide-fill');
        function fallback(){if(slide.fallback && img.src !== slide.fallback){img.src=slide.fallback;return;}img.hidden=true;}
        img.addEventListener('error',fallback);
        img.addEventListener('load',()=>{if(slide.fallback && img.src !== slide.fallback && img.naturalWidth<=120)fallback();});
        panel.append(img);track.append(panel);return panel;
      });
      const controls = document.createElement('div'); controls.className = 'community-cover-controls';
      const previous = document.createElement('button'), next = document.createElement('button'), count = document.createElement('span');
      previous.type = next.type = 'button';
      previous.setAttribute('aria-label','Previous media'); next.setAttribute('aria-label','Next media');
      previous.innerHTML = '<i class="bi bi-chevron-left" aria-hidden="true"></i>';
      next.innerHTML = '<i class="bi bi-chevron-right" aria-hidden="true"></i>';
      count.className='visually-hidden';count.setAttribute('aria-live','polite');count.setAttribute('aria-atomic','true');
      const dots=document.createElement('div');dots.className='community-cover-dots';dots.setAttribute('aria-label','Choose media');
      const dotButtons=slides.map((slide,i)=>{const dot=document.createElement('button');dot.type='button';dot.setAttribute('aria-label','Show '+(slide.video?'video':'image')+' '+(i+1)+' of '+slides.length);dot.addEventListener('click',()=>show(i));dots.append(dot);return dot;});
      const play = document.createElement('button'); play.type = 'button'; play.className = 'community-cover-video-play'; play.hidden = true;
      play.innerHTML = '<i class="bi bi-play-circle-fill" aria-hidden="true"></i><span>Play video</span>';
      const source = document.createElement('a'); source.className = 'community-cover-video-source'; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.hidden = true;
      let index = 0, player;
      play.addEventListener('click',()=>{
        const slide = slides[index]; if (!slide.video) return;
        player?.remove(); player = document.createElement(slide.type);
        player.className = 'community-cover-player'; player.src = slide.video;
        if(slide.type === 'iframe'){ player.title = slide.source + ' video player'; player.allow = 'fullscreen; picture-in-picture'; player.allowFullscreen = true; }
        else {player.controls = true; player.preload = 'metadata'; if(slide.src)player.poster = slide.src;}
        carousel.append(player); play.hidden = true;
      });
      function select(value) {
        index = Math.max(0,Math.min(slides.length-1,value));
        player?.remove(); player = null;
        const slide = slides[index];
        carousel.classList.toggle('community-cover-overlap', index === 0 && !slide.video);
        panels.forEach((panel,i)=>{panel.classList.toggle('is-active',i===index);panel.tabIndex=i===index?0:-1;panel.setAttribute('aria-hidden',String(i!==index));dotButtons[i].setAttribute('aria-pressed',String(i===index));});
        previous.disabled=index===0;next.disabled=index===slides.length-1;
        play.hidden = source.hidden = !slide.video;
        if(slide.video){source.href=slide.url;source.textContent=slide.source+' · '+new URL(slide.url).hostname;play.setAttribute('aria-label','Play video from '+slide.source);}
        if(slide.video && !slide.src && !slide.requested && window.fetch){
          slide.requested=true;
          const api=window.quranApiPath?window.quranApiPath('/community/link-preview'):'/api/community/link-preview';
          fetch(api+'?url='+encodeURIComponent(slide.url)).then(r=>r.ok?r.json():null).then(data=>{
            if(data?.image && /^https?:\/\//i.test(data.image)){slide.src=data.image;const img=panels[slides.indexOf(slide)].querySelector('img');img.src=slide.src;img.hidden=false;}
          }).catch(()=>{});
        }
        count.textContent=(index+1)+' / '+slides.length;
      }
      function show(value, smooth=true){
        const target=Math.max(0,Math.min(slides.length-1,value));select(target);
        const left=target*track.clientWidth;
        const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if(track.scrollTo)track.scrollTo({left,behavior:smooth&&!reduced?'smooth':'auto'});else track.scrollLeft=left;
      }
      track.addEventListener('scroll',()=>{if(track.clientWidth){const value=Math.round(track.scrollLeft/track.clientWidth);if(value!==index)select(value);}}, {passive:true});
      previous.addEventListener('click',()=>show(index-1));next.addEventListener('click',()=>show(index+1));
      carousel.addEventListener('keydown',event=>{
        if(event.target.closest?.('.community-cover-player') || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();show(event.key==='Home'?0:event.key==='End'?slides.length-1:index+(event.key==='ArrowRight'?1:-1));
      });
      let start, suppressClick=false;
      track.addEventListener('dragstart',event=>event.preventDefault());
      track.addEventListener('pointerdown',event=>{
        if(event.pointerType!=='mouse' || event.button!==0)return;
        start={x:event.clientX,y:event.clientY,left:track.scrollLeft,moved:false,id:event.pointerId};
      });
      track.addEventListener('pointermove',event=>{
        if(!start)return;const dx=event.clientX-start.x,dy=event.clientY-start.y;
        if(!start.moved && Math.abs(dx)>6 && Math.abs(dx)>Math.abs(dy)){start.moved=true;track.setPointerCapture?.(event.pointerId);track.classList.add('is-dragging');}
        if(start.moved){event.preventDefault();track.scrollLeft=start.left-dx;}
      });
      function finishDrag(){
        if(!start)return;const moved=start.moved;start=null;track.classList.remove('is-dragging');
        if(moved){track.focus({preventScroll:true});suppressClick=true;show(track.clientWidth?Math.round(track.scrollLeft/track.clientWidth):index);setTimeout(()=>{suppressClick=false;},400);}
      }
      track.addEventListener('pointerup',finishDrag);track.addEventListener('pointercancel',finishDrag);
      track.addEventListener('click',event=>{if(suppressClick){event.preventDefault();suppressClick=false;}},true);
      if(window.ResizeObserver)new ResizeObserver(()=>show(index,false)).observe(track);
      controls.hidden=dots.hidden=slides.length<2;controls.append(previous,count,next);carousel.append(track,controls,dots,play,source);select(0);
    }
    return card;
  }
  window.CommunityCoverCards = {enhance, videoSlide};
  document.querySelectorAll('.community-entry[data-cover-url]').forEach(article => enhance(article, {
    coverUrl:article.dataset.coverUrl,url:article.dataset.coverHref,title:article.dataset.coverTitle,
    subtitle:article.dataset.coverSubtitle,excerpt:article.dataset.coverExcerpt,authorName:article.dataset.coverAuthor
  }));
})();
