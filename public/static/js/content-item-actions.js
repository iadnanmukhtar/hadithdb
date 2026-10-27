/* global quranApiPath, openContentSharePane, hadithUrl, quranUrl */
(() => {
  'use strict';
  const pending = new WeakSet();
  let bookmarks = new Set(), account = 0;
  async function api(path, method = 'GET', body) {
    const token = await window.hadithAuth?.getToken();
    const response = await fetch(quranApiPath('/content-items' + path), { method, cache:'no-store', credentials:'same-origin', headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'}, ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Unable to load item actions.');
    return data;
  }
  window.contentItemBookmarks={count:()=>bookmarks.size,clear:async()=>{await api('/bookmarks','DELETE');await loadBookmarks();}};
  function paintBookmarks() {
    document.querySelectorAll('[data-content-bookmark-id]').forEach(button => {
      const selected = bookmarks.has(Number(button.dataset.contentBookmarkId));
      button.setAttribute('aria-pressed',String(selected));
      button.querySelector('span').className = 'bi bi-bookmark'+(selected?'-fill':'')+' text-accent';
    });
  }
  async function loadBookmarks() {
    const own = ++account;
    bookmarks.clear(); paintBookmarks();
    if (!await window.hadithAuth?.getToken()) { renderSaved([]); return; }
    try { const {items}=await api('/bookmarks'); if(own!==account)return; bookmarks=new Set(items.map(item=>Number(item.id)));paintBookmarks();renderSaved(items); } catch (_) { /* Retry on the next account change. */ }
  }
  function renderSaved(items) {
    document.dispatchEvent(new CustomEvent('contentItemBookmarksChanged'));
    if (!document.querySelector('.bookmarks-page')) return;
    let section=document.getElementById('content-item-bookmarks');
    if(!section){section=document.createElement('section');section.id='content-item-bookmarks';section.className='bookmark-section';document.querySelector('.bookmarks-page').append(section);}
    section.replaceChildren();section.hidden=!items.length;
    const heading=document.createElement('h2');heading.className='fs-4';heading.textContent='Commentary and other items';section.append(heading);
    for(const item of items){
      const row=document.createElement('p'),link=document.createElement('a'),remove=document.createElement('button');
      link.href=item.url.startsWith('/quran')?quranUrl(item.url):hadithUrl(item.url);link.textContent=item.title;link.dir='auto';remove.type='button';remove.className='btn btn-sm btn-link text-accent';remove.textContent='Remove';
      remove.addEventListener('click',async()=>{try{await api('/'+item.id+'/bookmark','PUT',{enabled:false});await loadBookmarks();}catch(err){window.toastr?.error(err.message);}});
      row.append(link,remove);section.append(row);
    }
  }
  function share(button, host) {
    const card=document.createElement('article');card.dataset.shareUrl=hadithUrl(button.dataset.shareUrl);card.dataset.shareImageAllowed='false';
    const title=document.createElement('h2');title.className='hadith-share-title';title.textContent=button.dataset.shareTitle;
    const section=document.createElement('section');section.className='hadith-share-section';
    const text=document.createElement('div');text.className='hadith-share-text';
    text.textContent=host.querySelector('.quran-tafsir-entry-body,.body,.intro,.commentary-search-fragment')?.innerText || host.innerText;
    section.append(text);card.append(title,section);openContentSharePane(null,card);
  }
  function reusePassageReflections(html, feed) {
    const disclosure = feed?.closest('.reflection-disclosure');
    if (!disclosure?.isConnected) return html;
    const template = document.createElement('template'); template.innerHTML = html;
    template.content.querySelector('.reflection-disclosure')?.remove();
    const link = template.content.querySelector('.content-item-actions .reflection-count-link');
    link.href = '#' + disclosure.id;
    link.dataset.reflectionDisclosureTrigger = disclosure.id;
    const badge = link.querySelector('.hadith-comment-count');
    badge.dataset.hadithId = feed.dataset.targetId;
    badge.dataset.commentType = feed.dataset.targetType || 'hadith';
    badge.textContent = disclosure.querySelector('.comment-widget-count')?.textContent || '0';
    return template.innerHTML;
  }
  async function install(anchor) {
    if(pending.has(anchor)||anchor.closest('.content-item-actions')||! /^(?:sharh|heading-sharh|tafsir|tafsir-heading|intro):/.test(anchor.dataset.noteKey||''))return;
    let host=anchor.closest('.quran-tafsir-entry,.hadith-sharh-entry,.commentary-search-result,.quran-commentary-introduction-article,[id^="note-intro-"],.quran-commentary-surah-intro,.quran-commentary-heading-intro');
    const targetHost=host?.matches('[id^="note-intro-"]')?host.closest('.chapter-intro')||host:host;
    host=targetHost;
    if(!host||host.dataset.contentActions==='loading'||host.dataset.contentActions==='ready')return;
    pending.add(anchor);host.dataset.contentActions='loading';
    try {
      const {html,item}=await api('/actions?key='+encodeURIComponent(anchor.dataset.noteKey));
      if(!host.isConnected)return;
      const footer=document.createElement('footer');footer.className='content-item-footer col-12';
      footer.id='content-item-'+item.id;host.append(footer);
      const passageFeed = host.closest('main.tafsir-only-page')?.querySelector(':scope > .reflection-section .comment-feed');
      window.jQuery(footer).append(reusePassageReflections(html, passageFeed));
      // The new bookmark carries the same notebook identity at the bottom of the item.
      const group=anchor.closest('.personal-note-actions');(group||anchor).remove();
      host.dataset.contentActions='ready';
      window.refreshHadithActions?.();paintBookmarks();
      footer.querySelector('.content-item-share').addEventListener('click',event=>share(event.currentTarget,host));
      if(location.hash==='#'+footer.id){const discussion=passageFeed?.closest('details')||footer.querySelector('details');if(discussion)discussion.open=true;footer.scrollIntoView({block:'center'});}
      footer.querySelector('.content-item-bookmark')?.addEventListener('click',async event=>{
        const button=event.currentTarget,id=Number(button.dataset.contentBookmarkId);
        try{if(!await window.hadithAuth?.getToken()){await window.hadithAuth?.requireToken?.('Please sign in to bookmark this item.');return;}button.disabled=true;await api('/'+id+'/bookmark','PUT',{enabled:!bookmarks.has(id)});await loadBookmarks();}catch(err){window.toastr?.error(err.message);}finally{button.disabled=false;}
      });
    } catch(err) { delete host.dataset.contentActions;pending.delete(anchor);console.warn('Item actions unavailable:',err.message); }
  }
  function scan(root=document){if(root.nodeType!==1&&root!==document)return;if(root.matches?.('[data-note-key]'))install(root);root.querySelectorAll('[data-note-key]').forEach(install);}
  document.addEventListener('click',event=>{const button=event.target.closest('[data-content-share-trigger]');if(button)share(button,button.closest('article'));});
  function start(){scan();loadBookmarks();new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)scan(node);}).observe(document.body,{childList:true,subtree:true});}
  document.addEventListener('hadithAuthChanged',loadBookmarks);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
