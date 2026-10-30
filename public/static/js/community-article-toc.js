/* Article reading navigation; contributors remain the no-heading fallback. */
(() => {
  'use strict';
  const body=document.querySelector('[data-article-body]');
  const rail=document.querySelector('.community-aside');
  if(!body || !rail)return;
  const headings=Array.from(body.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(h=>h.textContent.trim() && !h.closest('nav,.toc,.table-of-contents,.footnotes,[hidden]'));
  if(!headings.length)return;
  const nav=document.createElement('nav');nav.className='community-article-toc';nav.setAttribute('aria-label','Article contents');
  const title=document.createElement('h2');title.textContent='In this article';nav.append(title);
  const list=document.createElement('ol');nav.append(list);
  const base=Math.min(...headings.map(h=>Number(h.tagName[1])));
  const links=headings.map((heading,index)=>{
    if(!heading.id || document.getElementById(heading.id)!==heading){
      const stem=heading.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'') || 'section-'+(index+1);
      let id=stem,n=2;while(document.getElementById(id))id=stem+'-'+n++;
      heading.id=id;
    }
    const item=document.createElement('li');item.style.setProperty('--toc-depth',Number(heading.tagName[1])-base);
    const link=document.createElement('a');link.href='#'+encodeURIComponent(heading.id);link.textContent=heading.textContent.trim();link.dir='auto';item.append(link);list.append(item);return link;
  });
  rail.replaceChildren(nav);rail.setAttribute('aria-label','Article navigation');
  let current=-1,frame=0;
  function update(){
    frame=0;
    const offset=(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--site-fixed-header-height')) || 0)+32;
    let active=0;
    headings.forEach((heading,index)=>{if(heading.getBoundingClientRect().top<=offset)active=index;});
    if(active===current)return;
    if(current>=0)links[current].removeAttribute('aria-current');
    current=active;const link=links[active];link.setAttribute('aria-current','location');
    if(getComputedStyle(rail).position==='fixed'){
      const item=link.getBoundingClientRect(),box=rail.getBoundingClientRect();
      if(item.top<box.top)rail.scrollTop+=item.top-box.top-8;
      else if(item.bottom>box.bottom)rail.scrollTop+=item.bottom-box.bottom+8;
    }
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(update);}
  window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);
  window.addEventListener('load',schedule);window.addEventListener('hashchange',schedule);
  if(window.ResizeObserver)new ResizeObserver(schedule).observe(body);
  update();
})();
