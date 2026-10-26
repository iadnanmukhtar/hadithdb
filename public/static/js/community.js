/* global quranApiPath */
(() => {
  'use strict';
  const root = document.getElementById('community');
  if (!root) return;
  const view = root.dataset.view, handle = root.dataset.author, postId = root.dataset.post;
  const railSlot = root.querySelector('.community-rail-slot');
  const rail = railSlot?.querySelector('.community-aside');
  const footer = document.querySelector('body > footer');
  function positionCommunityRail() {
    if (!railSlot) return;
    const rect = railSlot.getBoundingClientRect();
    root.style.setProperty('--community-rail-left', rect.left + 'px');
    root.style.setProperty('--community-rail-width', rect.width + 'px');
    // Let the fixed rail move above the footer, as a bounded sticky rail would.
    const fixed = getComputedStyle(rail).position === 'fixed';
    railSlot.style.minHeight = fixed ? rail.offsetHeight + 'px' : '';
    const top = parseFloat(getComputedStyle(rail).top) || 0;
    const shift = fixed && footer ? Math.min(0, footer.getBoundingClientRect().top - 12 - top - rail.offsetHeight) : 0;
    rail.style.transform = shift ? `translateY(${shift}px)` : '';
  }
  if (railSlot) {
    positionCommunityRail();
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(positionCommunityRail);
      [railSlot, rail, root].forEach(element => observer.observe(element));
    }
    let railFrame = 0;
    window.addEventListener('scroll', () => {
      if (!railFrame) railFrame = requestAnimationFrame(() => {
        railFrame = 0;
        positionCommunityRail();
      });
    }, { passive: true });
    window.addEventListener('resize', positionCommunityRail);
  }

  const $ = id => document.getElementById('community-' + id);
  let me = null, epoch = 0, offset = 0, relation = { following: false, email: false }, editing = null;
  let previewSignature = null, dirty = false, replyId = null, loadingFeed = false, feedEpoch = 0, notebookOffset = 0, notebookRequest = 0, savingPost = false, changingRelation = false;
  const status = message => { $('status').textContent = message; };
  function activityDate(item) {
    return item.publicationDate
      ? new Date(item.publicationDate+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})
      : new Date(item.activityAt).toLocaleDateString(undefined,{month:'short',day:'numeric'});
  }
  function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
  function link(label, href, className) { const el = node('a', label, className); el.href = href; return el; }
  function button(label, work, className = 'btn btn-sm btn-outline-secondary') {
    const el = node('button', label, className); el.type = 'button'; el.addEventListener('click', () => run(work, el)); return el;
  }
  async function api(path, method = 'GET', body) {
    const requestEpoch = epoch;
    let token = null;
    try { token = await window.hadithAuth?.getToken(); } catch (err) { if (method !== 'GET') throw err; }
    if (method !== 'GET' && !token) {
      window.hadithAuth?.requireToken?.('Please sign in to participate in Community.');
      throw new Error('Please sign in to participate.');
    }
    if (requestEpoch !== epoch) throw new Error('Account changed. Please try again.');
    const response = await fetch(quranApiPath('/community' + path), { method, cache: 'no-store', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (requestEpoch !== epoch) throw new Error('Account changed. Please try again.');
    if (!response.ok) throw new Error(result.error || 'Unable to complete this request.');
    return result;
  }
  async function run(work, el) {
    if (el?.disabled) return;
    if (el) el.disabled = true;
    try { await work(); } catch (err) { status(err.message); }
    finally { if (el?.isConnected) el.disabled = false; if(el?.id === 'community-blog-toggle' && view === 'write') renderEditorBlog(); }
  }
  function icon(name) { const el = node('i', undefined, 'bi bi-' + name); el.setAttribute('aria-hidden', 'true'); return el; }
  function avatarImage(container, author) {
    const img = node('img'); img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    img.dataset.avatarFallback = author.avatarFallback || 'https://www.gravatar.com/avatar/?d=mp&s=96';
    img.src = author.photo || img.dataset.avatarFallback; container.replaceChildren(img);
  }
  function avatarError(img) {
    if (!img.matches?.('[data-avatar-fallback]')) return;
    if (img.src !== img.dataset.avatarFallback) img.src = img.dataset.avatarFallback;
    else img.replaceWith(icon('person'));
  }
  root.addEventListener('error', event => avatarError(event.target), true);
  root.querySelectorAll('[data-avatar-fallback]').forEach(img => { if (img.complete && !img.naturalWidth) avatarError(img); });
  function interactionControls(item, openReplies) {
    const actions=node('div',undefined,'community-entry-actions');
    const source=item.likeSource, target=String(item.likeId || item.id);
    actions.dataset.source=source; actions.dataset.target=target;
    const isReflection=source!=='post';
    const sync=result=>{
      for(const group of root.querySelectorAll('.community-entry-actions[data-source]')) {
        if(group.dataset.source===source && group.dataset.target===target) group.renderInteraction?.(result);
      }
    };
    const vote=direction=>async()=>{
      const own=epoch, pressed=(direction==='up'?up:down).getAttribute('aria-pressed')==='true';
      const result=await api('/votes/'+source+'/'+target,'PUT',{direction:pressed?null:direction});
      if(own===epoch) sync(result);
    };
    const up=button('',vote('up'),'community-like');
    const down=button('',vote('down'),'community-dislike');
    const reply=button('',openReplies,'community-reply'); reply.title='Reply';reply.setAttribute('aria-label','Reply');reply.setAttribute('aria-expanded','false');
    const repost=button('',async()=>{
      const own=epoch;
      const result=await api('/reposts/'+source+'/'+target,'PUT',{reposted:repost.getAttribute('aria-pressed')!=='true'});
      if(own===epoch) {sync(result); status(result.reposted?'Reposted to your activity.':'Repost removed.');}
    },'community-repost');
    function render(result={}) {
      Object.assign(item,result);
      for(const [control,selected,count,glyph,label] of [[up,item.liked,item.likeCount,isReflection?'hand-thumbs-up':'heart','Like'],[down,item.disliked,item.dislikeCount,'hand-thumbs-down','Dislike'],[repost,item.reposted,item.repostCount,'repeat','Repost']]) {
        control.replaceChildren(icon(glyph+(selected&&glyph!=='repeat'?'-fill':'')),document.createTextNode(count?' '+count:''));
        control.setAttribute('aria-pressed',String(!!selected));control.title=selected?'Undo '+label.toLowerCase():label;
        control.setAttribute('aria-label',control.title+(count?', '+count:''));
      }
      reply.replaceChildren(icon('reply'),document.createTextNode(item.commentCount?' '+item.commentCount:''));
    }
    actions.renderInteraction=render;render();actions.append(up,down,reply,repost);return actions;
  }
  function attachDiscussion(article,item,actions) {
    const panel=node('section',undefined,'community-inline-discussion');panel.hidden=true;panel.setAttribute('aria-label','Replies');
    const toggle=button('',()=>togglePanel(),'community-comments-toggle');toggle.setAttribute('aria-expanded','false');article.append(toggle);
    const list=node('div'), message=node('p',undefined,'small text-muted');message.setAttribute('role','status');
    const form=node('form',undefined,'community-inline-reply');
    const label=node('label','Reply','small text-muted');
    const textarea=node('textarea');textarea.rows=3;textarea.maxLength=10000;textarea.required=true;textarea.dir='auto';textarea.placeholder='Write a reply…';textarea.setAttribute('aria-label','Write a reply');
    label.append(textarea);
    const submit=node('button','Reply','btn btn-sm btn-outline-primary');submit.type='submit';
    const cancel=button('Cancel reply',()=>{selected=item;label.firstChild.textContent='Reply';textarea.value='';},'btn btn-sm btn-link');
    form.append(label,submit,cancel);
    let selected=item, loaded=false, loading=false, offset=0, entries=[];
    const more=button('Load more replies',()=>load(false),'community-more btn btn-sm btn-outline-secondary');more.hidden=true;
    panel.append(list,more,form,message);article.append(panel);
    function draw() {
      list.replaceChildren();const byId=new Map(entries.map(c=>[c.id,c])),children=new Map();
      for(const c of entries){const parent=byId.has(c.parentId)?c.parentId:null;if(!children.has(parent))children.set(parent,[]);children.get(parent).push(c);}
      const seen=new Set();
      function append(c,depth){
        if(seen.has(c.id))return;seen.add(c.id);
        const row=node('article',undefined,'community-thread-reply');row.style.marginInlineStart=Math.min(depth,4)*.65+'rem';
        const meta=node('div',undefined,'community-entry-meta');const avatar=node('span',undefined,'community-avatar');avatarImage(avatar,c.author);meta.append(avatar,link(c.author.name,'/community/@'+c.author.handle));
        if(c.parentId && byId.has(c.parentId))meta.append(node('small','Replying to '+byId.get(c.parentId).author.name));
        const body=node('div',undefined,'notebook-markdown community-reflection-body');body.dir='auto';if(c.deleted)body.textContent='Comment removed.';else body.innerHTML=c.html;
        row.append(meta,body);
        if(!c.deleted)row.append(interactionControls(c,()=>{selected=c;label.firstChild.textContent='Replying to '+c.author.name;textarea.focus();}));
        list.append(row);for(const child of children.get(c.id)||[])append(child,depth+1);
      }
      for(const c of children.get(null)||[])append(c,0);
      for(const c of entries)if(!seen.has(c.id))append(c,0);
    }
    async function load(reset=true){
      if(loading)return;loading=true;const own=epoch;message.textContent='Loading replies…';
      try{
        const data=await api('/discussion/'+item.likeSource+'/'+item.likeId+'?offset='+(reset?0:offset));
        if(own!==epoch||!article.isConnected)return;
        entries=reset?data.items:entries.concat(data.items.filter(c=>!entries.some(e=>e.id===c.id)));offset=data.offset;draw();loaded=true;more.hidden=!data.hasMore;message.textContent=entries.length?'':'Be the first to reply.';
      }catch(err){message.textContent=err.message;}finally{loading=false;}
    }
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(submit.disabled)return;submit.disabled=true;const own=epoch;
      try{await api('/discussion/'+selected.likeSource+'/'+(selected.likeId||selected.id),'POST',{markdown:textarea.value});if(own!==epoch)return;textarea.value='';await load();actions.renderInteraction({commentCount:Number(item.commentCount||0)+1});}
      catch(err){message.textContent=err.message;}finally{submit.disabled=false;}
    });
    function labelToggle(){toggle.textContent=panel.hidden?(item.commentCount?'View comments ('+item.commentCount+')':'Add a comment'):'Hide comments';}
    labelToggle();
    const renderActions=actions.renderInteraction;
    actions.renderInteraction=result=>{renderActions(result);labelToggle();};
    async function togglePanel(focus=false){panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));actions.querySelector('.community-reply').setAttribute('aria-expanded',String(!panel.hidden));labelToggle();if(!panel.hidden){if(!loaded)await load();if(focus)textarea.focus();}}
    return ()=>togglePanel(true);
  }
  function microType(item) { return ['title','revision'].includes(item.microinteraction) ? item.microinteraction : item.kind === 'like' ? item.activity + ':' + (item.likeSource || '') : null; }
  function editPostLink(item) { const edit = link('', (item.kind === 'note' ? '/community/mine?editPost=' : '/community/write?post=') + item.id, 'community-entry-secondary community-edit-post'); edit.dataset.editKind=item.kind;edit.dataset.editId=item.id;edit.title = 'Edit post'; edit.setAttribute('aria-label', 'Edit post'); edit.append(icon('pencil')); return edit; }
  function card(item) {
    const kind = ['title','revision'].includes(item.microinteraction) ? item.microinteraction : item.activity === 'comment' ? 'comment' : item.kind;
    const privatePost = item.status && item.status !== 'published';
    const href = privatePost ? '/community/write?post=' + item.id : item.url;
    const article = node('article', undefined, 'community-entry'); article.dataset.activity = item.activity; article.dataset.kind = kind; article.dataset.private=String(!!privatePost);
    const meta = node('div', undefined, 'community-entry-meta');
    const avatar = link(Array.from(item.author.name.trim())[0] || '?', '/community/@' + item.author.handle, 'community-avatar'); avatar.tabIndex = -1; avatar.setAttribute('aria-hidden', 'true'); avatarImage(avatar, item.author);
    if (['like','title','revision'].includes(kind)) {
      const copy = node('div', undefined, 'community-reaction-copy');
      const author = link(item.author.name, '/community/@' + item.author.handle); author.dir = 'auto';
      const target = link(kind !== 'like' ? item.hadithTitle : (item.title || 'a post').replace(/^Liked\s+/i, ''), kind !== 'like' ? item.hadithUrl : href); target.dir = 'auto';
      copy.append(author, document.createTextNode(kind === 'revision' ? ' revised ' : kind === 'title' ? ' titled ' : ' liked '), target);
      if (kind !== 'like') copy.append(document.createTextNode(' · ' + item.hadithRef));
      if (item.activityAt) { const time = node('time', activityDate(item)); time.dateTime = item.publicationDate || new Date(item.activityAt).toISOString(); copy.append(document.createTextNode(' · '), time); }
      article.append(avatar, copy);
      return article;
    }
    const identity = node('div', undefined, 'community-entry-identity');
    const authorLink = link(item.author.name, '/community/@' + item.author.handle, 'community-author'); authorLink.dir = 'auto'; identity.append(authorLink);
    const subline = node('div', undefined, 'community-entry-subline'); subline.append(node('span', kind === 'like' ? 'Liked' : kind === 'comment' ? 'In conversation' : kind === 'article' ? 'Article' : 'Post'));
    if (item.activityAt) { const dot = node('span', '·'); dot.setAttribute('aria-hidden', 'true'); const time = node('time', activityDate(item)); time.dateTime = item.publicationDate || new Date(item.activityAt).toISOString(); subline.append(dot, time); }
    identity.append(subline); meta.append(avatar, identity);
    if (privatePost) meta.append(node('span', item.status, 'community-entry-state'));
    if(item.repostedBy) { const credit=node('div',undefined,'community-repost-credit');credit.append(icon('repeat'),document.createTextNode(' Reposted by '),link(item.repostedBy.name,'/community/@'+item.repostedBy.handle));article.append(credit); }
    article.append(meta);
    if (kind !== 'note' || (item.title && !['Note','Post'].includes(item.title))) { const heading = node('h2', undefined, 'community-entry-title'); heading.dir = 'auto'; heading.append(link(item.title, href)); article.append(heading); }
    if (kind === 'article' && item.subtitle) { const subtitle = node('p', item.subtitle, 'community-article-subtitle'); subtitle.dir = 'auto'; article.append(subtitle); }
    const bodyHtml = kind === 'comment' ? item.html : item.feedHtml;
    const excerpt = node(bodyHtml ? 'div':'p', undefined, bodyHtml ? 'notebook-markdown community-reflection-body':'community-entry-excerpt'); excerpt.dir='auto';
    if(bodyHtml) excerpt.innerHTML=bodyHtml; else excerpt.textContent=item.excerpt || ''; article.append(excerpt);
    if (item.mediaHtml) { const media=node('div',undefined,'community-feed-media');media.innerHTML=privatePost ? (window.communityPrepareMediaHtml?.(item.mediaHtml)||item.mediaHtml) : item.mediaHtml;article.append(media); }
    if (item.tags) { const tags = node('div', undefined, 'community-entry-tags'); tags.dir = 'auto'; for (const tag of item.tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 5)) tags.append(node('span', tag)); article.append(tags); }
    let toggleDiscussion;
    const actions = item.likeSource && !privatePost ? interactionControls(item,()=>toggleDiscussion()) : node('div',undefined,'community-entry-actions');
    if(privatePost) { const draft=link('',href);draft.title='Open draft';draft.setAttribute('aria-label','Open draft');draft.append(icon('file-earmark-text'));actions.append(draft); }
    if (item.canEdit) actions.append(editPostLink(item));
    if (!privatePost && ['article','note'].includes(kind)) { const read = link('', href, 'community-entry-secondary'); read.title = kind === 'article' ? 'Read article' : 'Open post'; read.setAttribute('aria-label', read.title); read.append(icon('arrow-right')); actions.append(read); }
    article.append(actions);
    if(item.likeSource && !privatePost) toggleDiscussion=attachDiscussion(article,item,actions);
    return article;
  }
  let feedHasMore = false, feedObserver = null, reactionRun = null, firstBatchMicroOnly = false;
  function appendFeedCard(item) {
    const entry = card(item);
    if (!microType(item)) { reactionRun = null; $('feed').append(entry); return true; }
    const type = microType(item);
    if (!reactionRun || reactionRun.type !== type) reactionRun = {type, count: 0, details: null};
    reactionRun.count++;
    if (reactionRun.count <= 10) { $('feed').append(entry); return true; }
    if (!reactionRun.details) {
      const details = node('details', undefined, 'community-reaction-overflow');
      const summary = node('summary');
      reactionRun.label = node('span', '', 'community-reactions-show');
      summary.append(reactionRun.label, node('span', 'Hide extra activity', 'community-reactions-hide'));
      reactionRun.content = node('div', undefined, 'community-reaction-overflow-items');
      details.append(summary, reactionRun.content); reactionRun.details = details; $('feed').append(details);
      details.addEventListener('toggle', () => {
        // Either expanding or collapsing can move the sentinel back into view.
        observeFeedEnd();
      });
    }
    reactionRun.label.textContent = 'Show ' + (reactionRun.count - 10) + ' more ' + (reactionRun.count === 11 ? 'activity' : 'activities');
    reactionRun.content.append(entry);
    return reactionRun.details.open;
  }
  const feedKeys = new Set();
  function observeFeedEnd() {
    if (!feedObserver || !$('feed-sentinel')) return;
    feedObserver.disconnect();
    if (feedHasMore && !loadingFeed && !firstBatchMicroOnly) feedObserver.observe($('feed-sentinel'));
  }
  if ($('feed-sentinel') && typeof window.IntersectionObserver === 'function') {
    feedObserver = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && feedHasMore && !loadingFeed && !firstBatchMicroOnly) run(() => loadFeed());
    }, { rootMargin: '300px 0px' });
  }
  async function loadFeed(reset = false) {
    if (loadingFeed && !reset) return;
    const request = ++feedEpoch; loadingFeed = true;
    feedObserver?.disconnect();
    $('feed-status').textContent = 'Loading…';
    $('more').hidden = true;
    if (reset) { offset = 0; firstBatchMicroOnly = false; }
    try {
      // A page containing only collapsed rows must advance to the next visible
      // activity, rather than presenting a Load more button that appears inert.
      while (true) {
        const params = new URLSearchParams({ scope: view === 'author' ? 'everyone' : view, kind: $('filter')?.value || 'all', offset: String(offset) });
        if (view === 'author') params.set('author', handle);
        const data = await api('/feed?' + params);
        if (request !== feedEpoch) return;
        if (reset) {
          $('feed').replaceChildren(); feedKeys.clear(); reactionRun = null;
          firstBatchMicroOnly = data.hasMore && data.items.every(item => !!microType(item));
        }
        let addedVisible = false;
        for (const item of data.items) {
          const key = item.activity + ':' + item.id;
          if (!feedKeys.has(key)) { feedKeys.add(key); addedVisible = appendFeedCard(item) || addedVisible; }
        }
        if (!$('feed').children.length) $('feed').append(node('p', view === 'following' ? 'Follow an author to see their posts, reflections, and comments here.' : view === 'mine' ? 'Your wall is ready. Write a post or copy a saved notebook note.' : 'No activity yet.', 'community-empty'));
        if (data.hasMore && (!Number.isSafeInteger(data.offset) || data.offset <= offset)) throw new Error('Feed pagination did not advance. Please try again.');
        offset = data.offset; feedHasMore = data.hasMore; reset = false;
        if (feedHasMore && !addedVisible && !firstBatchMicroOnly) {
          $('feed-status').textContent = 'Loading past collapsed activity…';
          continue;
        }
        $('feed-status').textContent = !feedHasMore && feedKeys.size ? 'You’re all caught up.' : '';
        $('more').textContent = 'Load more'; $('more').hidden = !feedHasMore;
        break;
      }
    } catch (err) {
      if (request === feedEpoch) {
        feedHasMore = false; $('feed-status').textContent = 'Could not load the feed. Try again.';
        $('more').textContent = 'Try again'; $('more').hidden = false;
        $('more').dataset.retryReset = reset ? '1' : '0';
      }
      throw err;
    } finally { if (request === feedEpoch) { loadingFeed = false; observeFeedEnd(); } }
  }
  let quickBusy = false, quickPreviewRequest = 0, quickEditing = null, quickCover = '';
  function showQuickCover(url) {
    quickCover=url||'';const container=$('quick-cover');container.replaceChildren();container.hidden=!url;if(!url)return;
    const img=node('img');img.alt='Post cover';if(/^\/community\/media\//.test(url))img.dataset.mediaSrc=url;else img.src=url;
    container.append(img,button('Remove cover',()=>showQuickCover(''),'btn btn-sm btn-link text-muted'));
  }
  async function openQuickEdit(id) {
    if(quickBusy)return;const own=epoch;const {post}=await api('/posts/'+id+'?edit=1');if(own!==epoch)return;
    if(post.kind!=='note'){location.assign('/community/write?post='+post.id);return;}
    $('quick-dialog').setAttribute('aria-label','Edit post');$('quick-audience').textContent=post.status==='published'?'Public post':post.status==='pending'?'Awaiting review':'Private draft';
    $('quick-conversion-title').hidden=true;$('quick-convert').textContent='Convert to article draft';
    quickEditing=post;showQuickCover(post.coverUrl);$('quick-text').value=post.markdown;$('quick-title').value='';$('quick-edit-actions').hidden=false;$('quick-new-article').hidden=true;$('quick-post').textContent='Save changes';$('quick-status').textContent='';$('quick-preview').hidden=true;
    $('quick-dialog').showModal();$('quick-text').dispatchEvent(new Event('input',{bubbles:true}));$('quick-text').setSelectionRange(0,0);$('quick-text').scrollTop=0;$('quick-text').focus({preventScroll:true});
  }
  root.addEventListener('click',event=>{const edit=event.target.closest('[data-edit-kind=note]');if(!edit||!$('quick-dialog'))return;event.preventDefault();run(()=>openQuickEdit(edit.dataset.editId));});
  $('quick-open')?.addEventListener('click', () => {
    if(quickEditing){if(!window.confirm('Start a new post? Unsaved edits will be discarded.'))return;$('quick-form').reset();quickEditing=null;showQuickCover('');$('quick-edit-actions').hidden=true;$('quick-new-article').hidden=false;$('quick-post').textContent='Post';}
    $('quick-dialog').setAttribute('aria-label','Write a post');$('quick-audience').textContent='Public post';
    $('quick-dialog').showModal(); syncQuickComposer(); $('quick-text').focus();
  });
  function closeQuick(){if(quickBusy)return false;if(quickEditing && ($('quick-text').value!==quickEditing.markdown || quickCover!==(quickEditing.coverUrl||'')) && !window.confirm('Discard unsaved post changes?'))return false;$('quick-dialog').close();if(quickEditing){quickEditing=null;$('quick-form').reset();showQuickCover('');$('quick-edit-actions').hidden=true;$('quick-new-article').hidden=false;$('quick-post').textContent='Post';$('quick-text').dispatchEvent(new Event('input',{bubbles:true}));}return true;}
  document.querySelectorAll('[data-close-quick]').forEach(button => button.addEventListener('click',closeQuick));
  $('quick-dialog')?.addEventListener('cancel', event => { event.preventDefault();closeQuick(); });
  function syncQuickComposer() {
    if (!$('quick-text')) return;
    const hasText = !!$('quick-text').value.trim();
    $('quick-dialog').querySelectorAll('input,.community-media-toolbar button,#community-quick-edit-actions button,#community-quick-cover button').forEach(control=>control.disabled=quickBusy||!!window.communityMediaPending);
    $('quick-post').disabled = quickBusy || !!window.communityMediaPending || !hasText;
    document.querySelectorAll('[data-close-quick]').forEach(button => { button.disabled = quickBusy; });
    $('quick-preview-button').hidden = !hasText;
    $('quick-preview-button').disabled = quickBusy || !!window.communityMediaPending;
    $('quick-text').style.height = 'auto';
    $('quick-text').style.height = Math.min(280, Math.max(180, $('quick-text').scrollHeight)) + 'px';
  }
  document.addEventListener('communityMediaPending',syncQuickComposer);
  function resetQuickComposer() {
    if (!$('quick-form')) return;
    ++quickPreviewRequest; quickBusy = false; quickEditing=null;showQuickCover('');$('quick-edit-actions').hidden=true;$('quick-new-article').hidden=false;$('quick-post').textContent='Post';$('quick-dialog').close();
    $('prompt-avatar').replaceChildren(icon('person'));
    $('quick-form').reset(); $('quick-text').disabled = false;
    $('quick-preview').hidden = true; $('quick-preview').replaceChildren(); $('quick-status').replaceChildren();
    $('quick-name').textContent = 'Share a post'; $('quick-avatar').replaceChildren(icon('person'));
    syncQuickComposer();
  }
  $('quick-text')?.addEventListener('input', () => {
    ++quickPreviewRequest; $('quick-preview').hidden = true; $('quick-preview-button').textContent = 'Preview';
    $('quick-status').replaceChildren(); syncQuickComposer();
  });
  $('quick-preview-button')?.addEventListener('click', async () => {
    if (!$('quick-preview').hidden) { $('quick-preview').hidden = true; $('quick-preview-button').textContent = 'Preview'; return; }
    const own = epoch, request = ++quickPreviewRequest, markdown = $('quick-text').value;
    try {
      const result = await api('/preview', 'POST', { markdown });
      if (own !== epoch || request !== quickPreviewRequest || markdown !== $('quick-text').value) return;
      $('quick-preview').innerHTML = window.communityPrepareMediaHtml?.(result.html) || result.html; $('quick-preview').hidden = false; $('quick-preview-button').textContent = 'Hide preview';
    } catch (err) { if (own === epoch && request === quickPreviewRequest) $('quick-status').textContent = err.message; }
  });
  $('quick-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (quickBusy || window.communityMediaPending || !$('quick-text').value.trim()) return;
    const own = epoch, markdown = $('quick-text').value;
    ++quickPreviewRequest; quickBusy = true; $('quick-text').disabled = true; syncQuickComposer();
    $('quick-status').textContent = 'Posting…';
    try {
      const { post } = await api(quickEditing ? '/posts/'+quickEditing.id : '/posts', quickEditing ? 'PUT' : 'POST', { kind: 'note', title: quickEditing?.draftTitle || '', markdown, coverUrl:quickCover, tags: quickEditing?.tags || '', version:quickEditing?.version, notifyEmail: false, action: quickEditing && quickEditing.status!=='published' ? 'draft' : 'publish' });
      if (own !== epoch) return;
      quickEditing=null;showQuickCover('');$('quick-edit-actions').hidden=true;$('quick-new-article').hidden=false;$('quick-post').textContent='Post';
      $('quick-text').value = ''; $('quick-preview').replaceChildren(); $('quick-preview').hidden = true;
      $('quick-dialog').close();
      status(post.status === 'pending' ? 'Submitted for review. See My Profile.' : post.status==='draft' ? 'Draft saved.' : 'Your post is published.');
      $('quick-status').replaceChildren(document.createTextNode(post.status === 'pending' ? 'Submitted for review. ' : post.status==='draft' ? 'Draft saved. ' : 'Your post is published. '), link(post.status !== 'published' ? 'View on My Profile' : 'View post', post.status !== 'published' ? '/community/mine' : post.url));
      // Refresh failures must never invite a second submission of an already saved post.
      void loadFeed(true).catch(() => { if (own === epoch) status('Your post was saved. Reload the feed to see the latest posts.'); });
    } catch (err) { if (own === epoch) $('quick-status').textContent = err.message; }
    finally { if (own === epoch) { quickBusy = false; $('quick-text').disabled = false; syncQuickComposer(); } }
  });
  if ($('quick-form')) window.addEventListener('beforeunload', event => {
    if (!quickEditing && $('quick-text').value.trim() && !quickBusy) { event.preventDefault(); event.returnValue = ''; }
  });
  function renderRelation() {
    if (!$('follow')) return;
    $('follow').textContent = relation.following ? 'Unfollow' : 'Follow';
  }
  async function changeRelation() {
    if (changingRelation) return;
    changingRelation = true;
    try {
      const next = { following: !relation.following, email: false };
      relation = await api('/authors/' + encodeURIComponent(handle) + '/follow', 'PUT', next); renderRelation(); await loadContributors();
      status(relation.following ? 'Following.' : 'You have unfollowed this author.');
    } finally { changingRelation = false; }
  }

  $('follow')?.addEventListener('click', () => run(() => changeRelation(), $('follow')));
  $('filter')?.addEventListener('change', () => run(() => loadFeed(true)));
  $('more')?.addEventListener('click', () => { firstBatchMicroOnly = false; const reset = $('more').dataset.retryReset === '1'; delete $('more').dataset.retryReset; run(() => loadFeed(reset), $('more')); });
  window.addEventListener('beforeunload',event=>{if(quickEditing && ($('quick-text').value!==quickEditing.markdown || quickCover!==(quickEditing.coverUrl||''))){event.preventDefault();event.returnValue='';}});
  $('quick-delete')?.addEventListener('click',()=>run(async()=>{
    if(!quickEditing||quickBusy||!window.confirm('Delete this post and remove its discussion from the site?'))return;
    quickBusy=true;syncQuickComposer();try{await api('/posts/'+quickEditing.id,'DELETE',{version:quickEditing.version});resetQuickComposer();await loadFeed(true);}finally{quickBusy=false;syncQuickComposer();}
  },$('quick-delete')));
  $('quick-convert')?.addEventListener('click',()=>run(async()=>{
    if(!quickEditing||quickBusy||window.communityMediaPending)return;
    const title=$('quick-title').value.trim();if(!title){$('quick-conversion-title').hidden=false;$('quick-convert').textContent='Create article draft';$('quick-status').textContent='Enter a title for the article draft.';$('quick-title').focus();return;}
    if(!window.confirm('Convert this post to a private article draft? You can publish it again from the article editor.'))return;
    quickBusy=true;syncQuickComposer();try{
      const {post}=await api('/posts/'+quickEditing.id,'PUT',{kind:'article',convertToArticle:true,title,markdown:$('quick-text').value,coverUrl:quickCover,tags:quickEditing.tags,version:quickEditing.version,action:'draft'});
      quickEditing=null;$('quick-text').value='';location.assign('/community/write?post='+post.id);
    }finally{quickBusy=false;syncQuickComposer();}
  },$('quick-convert')));
  function payload(action = 'draft') { return { kind: $('kind').value, title: $('title').value, subtitle: $('subtitle').value, coverUrl: $('cover-url').value, markdown: $('markdown').value, tags: $('tags').value, notifyEmail: false, version: editing?.version, action }; }
  function signature() { const data = payload(); delete data.version; return JSON.stringify(data); }
  function invalidatePreview() { dirty = true; previewSignature = null; $('publish').disabled = false; $('preview-panel').hidden = true; }
  function renderEditorCover(post) {
    $('cover-url').value=post.coverUrl||''; $('cover-remove').hidden=!post.coverUrl;
    let figure=$('editor-cover');
    if(!post.coverUrl){figure?.remove();return;}
    if(!figure){figure=node('figure',undefined,'community-editor-cover');figure.id='community-editor-cover';$('title').insertAdjacentElement('afterend',figure);}
    const img=node('img');if(/^\/community\/media\//.test(post.coverUrl))img.dataset.mediaSrc=post.coverUrl;else img.src=post.coverUrl;img.alt=post.title||'Article cover';
    figure.replaceChildren(img,node('figcaption','Cover image','small text-muted'));
  }
  document.addEventListener('communityCoverChanged',event=>{if(event.detail.editor==='quick'){showQuickCover(event.detail.url);return;}renderEditorCover({coverUrl:event.detail.url});invalidatePreview();});
  $('cover-remove')?.addEventListener('click',()=>{renderEditorCover({coverUrl:''});invalidatePreview();});
  function renderEditorBlog() {
    if(view !== 'write')return;
    $('blog-control').hidden = !me?.admin || (editing?.kind || $('kind').value) !== 'article';
    $('blog-toggle').checked = !!editing?.isBlog;
    $('blog-toggle').disabled = !editing || (editing.status !== 'published' && !editing.isBlog);
    $('blog-help').hidden = !$('blog-toggle').disabled;
  }
  function populate(post) {
    renderEditorCover(post); $('cover-controls').hidden=post.kind !== 'article';
    $('publish').hidden = !!post.isBlog && !me?.admin;
    $('delete').hidden = false;
    editing = post; $('kind').value = post.kind; $('kind').disabled = true; $('title').value = post.draftTitle ?? post.title; $('subtitle').value = post.subtitle || ''; $('subtitle').hidden = post.kind !== 'article';
    $('markdown').value = post.markdown; $('tags').value = post.tags;
    $('title').required = post.kind === 'article';
    $('unpublish').hidden = !['published', 'pending'].includes(post.status);
    $('publish').textContent = post.status === 'published' ? 'Update published version' : 'Publish';
    $('editor-status').textContent = post.status === 'pending' ? 'Submitted for moderation. Your article is not public yet.' : post.status === 'hidden' ? 'A moderator has hidden this article. Contact a moderator for review.' : post.status === 'published' ? 'Published. Saving a draft keeps the current public version until you publish an update.' : 'Draft saved. Only you can see it.';
    renderEditorBlog();document.dispatchEvent(new Event('communityEditorPopulated'));
    previewSignature = null; dirty = false; $('publish').disabled = false; $('preview-panel').hidden = true;
  }
  async function save(action) {
    if(window.communityMediaPending) throw new Error('Wait for the image upload to finish.');
    if (savingPost) return;
    savingPost = true;
    try {
      if (action !== 'unpublish' && !$('editor-form').reportValidity()) return;
      const currentSignature = signature(), wasDirty = dirty;
      const body = action === 'unpublish' ? { kind: editing.kind, title: editing.draftTitle ?? editing.title, subtitle: editing.subtitle, coverUrl: editing.coverUrl, markdown: editing.markdown, tags: editing.tags, notifyEmail: editing.notifyEmail, version: editing.version, action } : payload(action);
      const result = await api(editing ? '/posts/' + editing.id : '/posts', editing ? 'PUT' : 'POST', body);
      editing = result.post;
      const url = new URL(location.href); url.searchParams.set('post', editing.id); url.searchParams.delete('source'); history.replaceState(null, '', url);
      // Keep edits made while the save was running; only update the server version.
      if (signature() === currentSignature && !(action === 'unpublish' && wasDirty)) populate(editing);
      else { dirty = true; $('unpublish').hidden = !['published', 'pending'].includes(editing.status); $('editor-status').textContent = 'Earlier changes saved. You still have unsaved edits.'; }
      status(action === 'publish' ? editing.status === 'pending' ? 'Submitted for moderation.' : 'Your article is public.' : action === 'unpublish' ? 'Unpublished. The article is now private.' : 'Draft saved.');
    } finally { savingPost = false; }
  }
  if (view === 'write') {
    for (const control of ['title', 'subtitle', 'markdown', 'tags', 'kind']) $(control).addEventListener('input', invalidatePreview);
    $('kind').addEventListener('change', () => { $('title').required = $('kind').value === 'article'; });
    $('editor-form').addEventListener('submit', event => {
      event.preventDefault();
      const submitter = event.submitter || $('editor-form').querySelector('[data-action="draft"]');
      run(() => save(submitter.dataset.action), submitter);
    });
    $('preview-button').addEventListener('click', () => run(async () => {
      if(window.communityMediaPending) throw new Error('Wait for the image upload to finish.');
      if (!$('editor-form').reportValidity()) return;
      const own = signature(), result = await api('/preview', 'POST', { markdown: $('markdown').value });
      if (signature() !== own) return;
      $('preview').innerHTML = window.communityPrepareMediaHtml?.(result.html) || result.html; $('preview-title').textContent = $('title').value || 'Untitled article'; $('preview-subtitle').textContent = $('subtitle').value;
      $('preview-cover')?.remove(); if($('cover-url').value){const img=node('img');img.id='community-preview-cover';img.className='img-fluid mb-3';if(/^\/community\/media\//.test($('cover-url').value))img.dataset.mediaSrc=$('cover-url').value;else img.src=$('cover-url').value;img.alt='Article cover';$('preview').prepend(img);}
      $('preview-panel').hidden = false; previewSignature = own; $('publish').disabled = false;
      $('preview-panel').scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, $('preview-button')));
    $('delete').addEventListener('click',()=>run(async()=>{
      if(!editing || !window.confirm('Delete this post? It and its discussion will be removed from the site.'))return;
      if(savingPost)throw new Error('Wait for the current save to finish.');
      await api('/posts/'+editing.id,'DELETE',{version:editing.version});
      dirty=false;location.assign('/community/mine');
    },$('delete')));
    $('unpublish').addEventListener('click', () => run(() => save('unpublish'), $('unpublish')));
    window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  }
  async function copyNotebook(source) {
    if (dirty && !window.confirm('Replace this article draft with a copy of the saved notebook note?')) return;
    const note = await api('/notebook-copy?source=' + encodeURIComponent(source));
    $('title').value = note.title; $('markdown').value = note.markdown; $('tags').value = note.tags;
    invalidatePreview(); $('import-panel').hidden = true; status('Saved note copied into this article draft. Review the public preview before publishing.');
  }
  async function loadNotebook(reset = true) {
    const request = ++notebookRequest;
    if (reset) notebookOffset = 0;
    const token = await window.hadithAuth?.getToken();
    if (!token) throw new Error('Please sign in to copy your saved notes.');
    const own = epoch;
    const response = await fetch(quranApiPath('/notebook') + '?' + new URLSearchParams({ offset: String(notebookOffset), q: $('notebook-search').value }), { cache: 'no-store', headers: { Authorization: 'Bearer ' + token } });
    const data = await response.json();
    if (own !== epoch || request !== notebookRequest) return;
    if (!response.ok) throw new Error(data.error || 'Unable to load saved notes.');
    if (reset) $('notebook-results').replaceChildren();
    for (const note of data.notes || []) {
      const row = button(note.title || note.source_title || 'Untitled note', () => copyNotebook(note.source_key), 'btn btn-outline-secondary d-block text-start w-100 mb-2'); row.dir = 'auto'; $('notebook-results').append(row);
    }
    if (!$('notebook-results').children.length) $('notebook-results').textContent = 'No saved notes found.';
    notebookOffset += (data.notes || []).length; $('notebook-more').hidden = !data.hasMore;
  }
  $('import')?.addEventListener('click', () => run(async () => { $('import-panel').hidden = !$('import-panel').hidden; if (!$('import-panel').hidden) await loadNotebook(); }, $('import')));
  $('notebook-search')?.addEventListener('change', () => run(() => loadNotebook()));
  $('notebook-more')?.addEventListener('click', () => run(() => loadNotebook(false), $('notebook-more')));
  async function report(commentId = null) {
    const reason = window.prompt('Why are you reporting this content?');
    if (!reason?.trim()) return;
    await api('/posts/' + postId + '/report', 'POST', { reason, commentId }); status('Report submitted to moderators.');
  }
  function syncReflectionComposer() {
    if (!$('comment-form')) return;
    $('comment-text').disabled = !me;
    $('comment-form').querySelector('[type="submit"]').disabled = !me;
    $('comment-hint').hidden = !!me;
    $('comment-user').hidden = !me;
    $('comment-user').textContent = me ? 'Posting as ' + me.author.name : '';
    if (me) avatarImage($('comment-avatar'), me.author);
    else $('comment-avatar').replaceChildren(icon('person-fill'));
  }
  function reflectionAction(label, glyph, work, className = '') {
    const control = button('', work, 'comment-action ' + className);
    control.title = label; control.setAttribute('aria-label', label); control.append(icon(glyph));
    return control;
  }
  async function loadComments() {
    const data = await api('/posts/' + postId + '/comments');
    $('comments').replaceChildren();
    const count = data.comments.filter(c => !c.deleted).length;
    $('comments-count').textContent = count;
    $('comments-count').title = count + (count === 1 ? ' reflection' : ' reflections');
    const byId = new Map(data.comments.map(c => [c.id, c])), children = new Map(), rendered = new Set();
    for (const c of data.comments) {
      const parent = byId.has(c.parentId) ? c.parentId : null;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(c);
    }
    function append(c, depth) {
      if (rendered.has(c.id)) return;
      rendered.add(c.id);
      const article = node('article', undefined, 'comment-thread-item' + (depth ? ' comment-thread-reply' : ''));
      article.id = 'comment-' + c.id; article.style.setProperty('--comment-depth', depth);
      const row = node('div', undefined, 'comment-row');
      const avatar = node('span', undefined, 'comment-avatar'); avatar.setAttribute('aria-hidden', 'true'); avatarImage(avatar, c.author);
      const entry = node('div', undefined, 'comment-entry'), bubbleWrap = node('div', undefined, 'comment-bubble-wrap'), bubble = node('div', undefined, 'comment-bubble');
      const meta = node('div', undefined, 'comment-meta'), authorWrap = node('div', undefined, 'comment-author-wrap');
      const author = link(c.author.name, '/community/@' + c.author.handle, 'comment-author'); author.dir = 'auto'; authorWrap.append(author); meta.append(authorWrap);
      const body = node('div', undefined, c.deleted ? 'comment-deleted' : 'comment-text notebook-markdown'); body.dir = 'auto';
      if (c.deleted) body.textContent = 'This reflection was deleted.'; else body.innerHTML = c.html;
      bubble.append(meta, body); bubbleWrap.append(bubble); entry.append(bubbleWrap);
      const controls = node('div', undefined, 'comment-actions');
      const date = new Date(c.createdAt);
      if (!Number.isNaN(date.getTime())) { const time = node('time', date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), 'comment-time'); time.dateTime = date.toISOString(); time.title = date.toLocaleString(); controls.append(time); }
      if (!c.deleted) {
        for (const [direction, selected, total, glyph, label] of [['up', c.liked, c.likeCount, 'hand-thumbs-up', 'Like'], ['down', c.disliked, c.dislikeCount, 'hand-thumbs-down', 'Disagree']]) {
          const vote = reflectionAction(label, glyph + (selected ? '-fill' : ''), async () => { await api('/votes/comment/' + c.id, 'PUT', { direction: selected ? null : direction }); await loadComments(); }, 'comment-vote' + (selected ? ' is-active' : ''));
          vote.setAttribute('aria-pressed', String(!!selected)); if (total) vote.append(document.createTextNode(' ' + total)); controls.append(vote);
        }
        controls.append(reflectionAction('Reply', 'reply', () => { replyId = c.id; $('reply-target').textContent = 'Replying to ' + c.author.name; $('reply-target').hidden = false; $('cancel-reply').hidden = false; $('comment-text').focus(); }, 'comment-reply'));
        controls.append(reflectionAction('Report', 'flag', () => report(c.id)));
        if (c.canDelete) controls.append(reflectionAction('Delete', 'trash', async () => { if (!window.confirm('Remove this reflection?')) return; await api('/comments/' + c.id, 'DELETE'); if (replyId === c.id) cancelReply(); await loadComments(); }, 'comment-delete comment-action-delete'));
      }
      entry.append(controls); row.append(avatar, entry); article.append(row); $('comments').append(article);
      for (const child of children.get(c.id) || []) append(child, depth + 1);
    }
    for (const c of children.get(null) || []) append(c, 0);
    for (const c of data.comments) if (!rendered.has(c.id)) append(c, 0);
    if (!data.comments.length) $('comments').append(node('p', 'No reflections yet. Be the first to share.', 'comment-empty-state small'));
    if (/^#comment-\d+$/.test(location.hash) || location.hash === '#comments') {
      $('reflections-disclosure').open = true;
      (document.getElementById(location.hash.slice(1)) || $('reflections-disclosure')).scrollIntoView({ block: 'center' });
    }
  }
  function cancelReply() { replyId = null; $('reply-target').hidden = true; $('cancel-reply').hidden = true; }
  $('cancel-reply')?.addEventListener('click', cancelReply);
  $('blog-toggle')?.addEventListener('change',()=>{
    const toggle=$('blog-toggle'),enabled=toggle.checked,own=epoch;
    run(async()=>{
      try{const result=await api('/posts/'+(view === 'write' ? editing.id : postId)+'/blog','PUT',{enabled});if(own!==epoch)return;toggle.checked=result.isBlog;if(view==='write'){editing.isBlog=result.isBlog;renderEditorBlog();}status(result.isBlog?'Article added to the Blog.':'Article removed from the Blog.');}
      catch(err){if(own===epoch)toggle.checked=!enabled;throw err;}
    },toggle);
  });
  $('report-post')?.addEventListener('click', () => run(() => report(), $('report-post')));
  $('comment-form')?.addEventListener('submit', event => { event.preventDefault(); run(async () => {
    const markdown = $('comment-text').value; await api('/posts/' + postId + '/comments', 'POST', { markdown, parentId: replyId });
    if ($('comment-text').value === markdown) $('comment-text').value = ''; cancelReply(); await loadComments(); $('comment-status').textContent = 'Reflection posted.';
  }, $('comment-form').querySelector('[type="submit"]')); });
  async function loadModeration() {
    const data = await api('/moderation'); $('moderation').replaceChildren();
    for (const p of data.pending) {
      const section = card({ ...p, activity: 'post', activityAt: p.updatedAt });
      const body = node('div', undefined, 'notebook-markdown my-3'); body.innerHTML = p.html; section.append(body);
      section.append(button(p.status === 'hidden' ? 'Restore and approve' : 'Approve publication', async () => { await api('/posts/' + p.id + '/moderation', 'POST', { action: 'approve', version: p.version }); await loadModeration(); }));
      if (p.status !== 'hidden') section.append(button('Hide', async () => { await api('/posts/' + p.id + '/moderation', 'POST', { action: 'hide' }); await loadModeration(); }));
      $('moderation').append(section);
    }
    for (const r of data.reports) {
      const section = node('section', undefined, 'community-card'); section.append(link(r.title || 'Reported post', '/community/@' + r.handle + '/' + r.post_id + (r.comment_id ? '#comment-' + r.comment_id : '')), node('p', r.reason));
      for (const action of ['hide', 'resolve']) section.append(button(action === 'hide' ? r.comment_id ? 'Remove comment' : 'Hide post' : 'Dismiss report', async () => { await api('/posts/' + r.post_id + '/moderation', 'POST', { action, commentId: r.comment_id || null }); await loadModeration(); }));
      $('moderation').append(section);
    }
    if (!$('moderation').children.length) $('moderation').append(node('p', 'No publications or reports awaiting review.', 'community-empty'));
  }
  async function loadContributors() {
    if (!$('contributors')) return;
    const own = epoch;
    try {
      const data = await api('/contributors');
      if (own !== epoch) return;
      $('contributors').replaceChildren();
      for (const author of data.contributors) {
        const row = node('div', undefined, 'community-contributor');
        const avatar = link('', '/community/@' + author.handle, 'community-avatar'); avatar.tabIndex=-1; avatar.setAttribute('aria-hidden','true'); avatarImage(avatar, author);
        const copy = node('div', undefined, 'community-contributor-copy');
        const name = link(author.name, '/community/@' + author.handle); name.dir='auto'; name.title=author.name;
        copy.append(name, node('small', author.contributions + (author.contributions===1 ? ' contribution' : ' contributions')));
        const toggle = button(author.following ? 'Unfollow' : 'Follow', async () => {
          const own = epoch;
          const result = await api('/authors/' + encodeURIComponent(author.handle) + '/follow', 'PUT', {following:!author.following,email:false});
          if (own !== epoch) return;
          author.following=result.following; author.email=result.email;
          toggle.textContent=author.following ? 'Unfollow' : 'Follow'; toggle.setAttribute('aria-pressed',String(author.following));
          toggle.setAttribute('aria-label',(author.following ? 'Unfollow ' : 'Follow ') + author.name);
          if (handle===author.handle) { relation=result; renderRelation(); }
          if (view==='following') await loadFeed(true);
          if (view==='mine') renderSubscriptions((await api('/me')).subscriptions);
        }, 'btn btn-sm btn-outline-secondary community-contributor-follow');
        toggle.dataset.author=author.handle; toggle.setAttribute('aria-pressed',String(author.following));
        toggle.setAttribute('aria-label',(author.following ? 'Unfollow ' : 'Follow ') + author.name);
        row.append(avatar,copy);
        if (author.handle !== me?.author.handle) row.append(toggle);
        else copy.append(node('small','You'));
        $('contributors').append(row);
      }
      if (!data.contributors.length) $('contributors').append(node('p','Contributors will appear as public writing is shared.','community-rail-caption'));
    } catch (err) {
      if (own !== epoch) return;
      $('contributors').replaceChildren(node('p','Contributors could not be loaded.','community-rail-caption'),button('Try again',loadContributors,'btn btn-sm btn-link'));
    }
  }
  function renderSubscriptions(items) {
    $('subscriptions').replaceChildren();
    for (const author of items) {
      const row = node('div', undefined, 'mb-3'); row.append(link(author.name, '/community/@' + author.handle));
      if (author.email) row.append(button('Stop emails', async () => { await api('/authors/' + author.handle + '/follow', 'PUT', { following: true, email: false }); await init(); }, 'btn btn-sm btn-link'));
      row.append(button('Unfollow', async () => { await api('/authors/' + author.handle + '/follow', 'PUT', { following: false, email: false }); await init(); }, 'btn btn-sm btn-link')); $('subscriptions').append(row);
    }
    if (!items.length) $('subscriptions').textContent = 'You are not following any authors yet.';
  }
  $('edit-profile')?.addEventListener('click', () => {
    $('name').value = me.author.name; $('handle').value = me.author.handle; $('bio').value = me.author.bio || '';
    $('profile-error').textContent = ''; $('profile-dialog').showModal();
  });
  document.querySelectorAll('[data-close-profile-dialog]').forEach(el => el.addEventListener('click', () => $('profile-dialog').close()));
  $('people-close')?.addEventListener('click', () => $('people-dialog').close());
  let peopleRequest = 0;
  async function showPeople(kind) {
    const request = ++peopleRequest;
    $('people-title').textContent = kind === 'followers' ? 'Followers' : 'Following';
    $('followers').hidden = kind !== 'followers'; $('subscriptions').hidden = kind !== 'following';
    $('people-dialog').showModal();
    if (kind !== 'followers') return;
    const own = epoch;
    $('followers').replaceChildren();
    async function load(offset = 0) {
      const loading = node('p', 'Loading followers…', 'text-muted');
      $('followers').append(loading);
      try {
        const data = await api('/me/followers?offset=' + offset);
        if (own !== epoch || request !== peopleRequest) return;
        loading.remove();
        for (const author of data.items) {
          const row = node('div', undefined, 'd-flex align-items-center gap-2 mb-3');
          const avatar = node('span', undefined, 'community-avatar'); avatarImage(avatar, author);
          row.append(avatar, link(author.name, '/community/@' + author.handle)); $('followers').append(row);
        }
        if (!offset && !data.items.length) $('followers').append(node('p', 'No followers yet.', 'text-muted'));
        if (data.hasMore) {
          const more = button('Load more', () => { more.remove(); load(offset + data.items.length); }, 'btn btn-sm btn-link');
          $('followers').append(more);
        }
      } catch (err) {
        if (own !== epoch || request !== peopleRequest) return;
        loading.textContent = err.message;
        const retry = button('Try again', () => { loading.remove(); retry.remove(); load(offset); }, 'btn btn-sm btn-link');
        $('followers').append(retry);
      }
    }
    await load();
  }
  $('profile-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = $('profile-form').querySelector('[type="submit"]'), own = epoch;
    submit.disabled = true; $('profile-error').textContent = '';
    try {
      await api('/profile', 'PUT', { name: $('name').value, handle: $('handle').value, bio: $('bio').value });
      if (own !== epoch) return;
      $('profile-dialog').close(); await init(); status('Public profile saved.');
    } catch (err) { if (own === epoch) $('profile-error').textContent = err.message; }
    finally { submit.disabled = false; }
  });
  async function init() {
    const own = ++epoch; ++feedEpoch; loadingFeed = false; feedHasMore = false; feedObserver?.disconnect(); me = null; status('');
    $('moderation-link').hidden = true;
    if($('blog-control'))$('blog-control').hidden=true;
    try {
      const publicView = ['everyone', 'author', 'post'].includes(view);
      try {
        const token = await window.hadithAuth?.getToken();
        if (own !== epoch) return;
        if (token) me = await api('/me');
      } catch (err) { if (!publicView) throw err; me = null; }
      if (own !== epoch) return;
      $('moderation-link').hidden = !me?.moderator;
      if ($('quick-name')) { $('quick-name').textContent = me?.author.name || 'Share a post'; if (me) { avatarImage($('quick-avatar'), me.author); avatarImage($('prompt-avatar'), me.author); } }
      if (!me && ['mine', 'following', 'write', 'moderation'].includes(view)) { status('Please sign in using the account button to open your ' + (view === 'write' ? 'publication editor.' : 'personal wall.')); return; }
      if (view === 'author' && me?.author.handle === handle) { location.replace('/community/mine'); return; }
      if (view === 'mine') {
        $('wall-name').textContent = me.author.name;
        $('wall-handle').textContent = '@' + me.author.handle;
        $('wall-bio').textContent = me.author.bio || '';
        const followers = button(`${me.author.followers} ${Number(me.author.followers) === 1 ? 'follower' : 'followers'}`, () => showPeople('followers'), 'community-profile-stat');
        const following = button(`${me.author.following} following`, () => showPeople('following'), 'community-profile-stat');
        for (const el of [followers, following]) { el.setAttribute('aria-haspopup', 'dialog'); el.setAttribute('aria-controls', 'community-people-dialog'); }
        $('wall-stats').replaceChildren(followers, document.createTextNode(' · '), following, document.createTextNode(` · ${me.author.posts} ${Number(me.author.posts) === 1 ? 'post' : 'posts'} · ${me.author.comments} reflections`));
        avatarImage($('wall-avatar'), me.author);
        $('wall-profile').hidden = false;
        $('name').value = me.author.name; $('handle').value = me.author.handle; $('handle').readOnly = !/^author-[a-f0-9]{16}$/.test(me.author.handle); $('bio').value = me.author.bio;
        renderSubscriptions(me.subscriptions);
      }
      if (handle) {
        const self = me?.author.handle === handle; $('follow-controls').hidden = self;
        relation = me && !self ? await api('/authors/' + encodeURIComponent(handle) + '/relationship') : { following: false, email: false }; renderRelation();
      }
      if (['everyone', 'following', 'mine', 'author'].includes(view)) {await Promise.all([loadFeed(true), loadContributors()]);const params=new URLSearchParams(location.search);if(params.has('editPost') && me){await openQuickEdit(params.get('editPost'));params.delete('editPost');history.replaceState(null,'',location.pathname+(params.size?'?'+params:''));}}
      if (view === 'write') {
        renderEditorBlog();
        const params = new URLSearchParams(location.search);
        if (!params.get('post') && !editing && params.get('kind') === 'article') { $('kind').value = 'article'; $('kind').dispatchEvent(new Event('change')); }
        if (params.get('post') && !editing) {const post=(await api('/posts/'+encodeURIComponent(params.get('post'))+'?edit=1')).post;if(post.kind==='note'){location.replace('/community/mine?editPost='+post.id);return;}populate(post);}
        if (params.get('source') && !editing) await copyNotebook(params.get('source'));
      }
      if (view === 'post') { syncReflectionComposer(); $('blog-control').hidden = !me?.admin || $('blog-toggle').dataset.kind !== 'article'; $('edit-post').hidden = me?.author.handle !== handle || $('edit-post').dataset.generated === 'true'; await loadComments(); }
      if (view === 'moderation') await loadModeration();
    } catch (err) { if (own === epoch) status(err.message); }
  }
  document.addEventListener('hadithAuthChanged', () => {
    resetQuickComposer();
    if ($('contributors')) $('contributors').replaceChildren();
    // A different account must never inherit the previous account's draft or feed.
    if (view === 'write') { $('editor-cover')?.remove(); $('editor-form').reset(); $('kind').disabled = false; editing = null; dirty = false; previewSignature = null; $('preview-panel').hidden = true; $('publish').disabled = false; $('unpublish').hidden = true; $('delete').hidden = true; $('notebook-results').replaceChildren(); $('import-panel').hidden = true; }
    if (['mine', 'following'].includes(view)) { $('feed').replaceChildren(); $('more').hidden = true; }
    if (view === 'mine') { $('profile-dialog').close(); $('people-dialog').close(); $('followers').replaceChildren(); $('profile-form').reset(); $('subscriptions').replaceChildren(); $('wall-profile').hidden = true; $('wall-name').textContent = ''; $('wall-handle').textContent = ''; $('wall-bio').textContent = ''; $('wall-stats').textContent = ''; $('wall-avatar').replaceChildren(); }
    if (view === 'moderation') $('moderation').replaceChildren();
    if (view === 'post') { me = null; cancelReply(); $('comment-text').value = ''; $('comment-status').textContent = ''; syncReflectionComposer(); }
    run(init);
  });
  run(init);
})();
