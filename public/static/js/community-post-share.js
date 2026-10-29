/* global quranApiPath */
(() => {
  'use strict';
  const dialog = document.getElementById('community-share-dialog');
  if (!dialog) return;
  const $ = id => document.getElementById('community-share-' + id);
  let source = null, revision = 0, authRevision = 0, busy = false, waitingForSignIn = false, owner = null;
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function sourceIcon(url) {
    const own = url.origin === location.origin || ['hadithunlocked.com','quranunlocked.com','quran.islamunlocked.com','hadith.islamunlocked.com'].includes(url.hostname);
    if (!own) return null;
    const quran = url.hostname.startsWith('quran') || /^\/(?:quran(?:[/:]|$)|\d+:|translations\/|tafsir\/)/.test(url.pathname);
    return quran ? '/static/img/quran-apple-touch-icon.png' : '/static/img/apple-touch-icon.png';
  }
  let imagePreviewUrl = null;
  function releaseImagePreview() {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    imagePreviewUrl = null;
  }
  function preview(data) {
    if (source.imageBlob) {
      const image = element('img');
      image.src = imagePreviewUrl; image.alt = source.title;
      image.style.cssText = 'display:block;max-width:100%;max-height:55vh;object-fit:contain;margin:auto';
      $('preview').replaceChildren(image);
      return;
    }
    // Composer previews always retain the compact thumbnail layout.
    const link = element('a', '', 'community-link-card');
    link.href = source.url; link.target = '_blank'; link.rel = 'noopener';
    if (data.image && (/^https:\/\//.test(data.image) || (new URL(data.image,source.url).origin === new URL(source.url).origin || new URL(data.image,location.href).origin === location.origin))) {
      const existing = $('preview').querySelector('img');
      const reuse = existing && existing.getAttribute('src') === data.image;
      const image = reuse ? existing : element('img');
      image.loading = 'eager'; image.fetchPriority = 'high'; image.alt = ''; image.referrerPolicy = 'no-referrer';
      if (!reuse) {image.src = data.image; image.addEventListener('error', () => image.remove(), {once:true});}
      link.append(image);
    }
    const copy = element('span', '', 'community-link-copy');
    const title = element('strong', data.title || source.title); title.dir = 'auto';
    copy.append(element('small', new URL(source.url).hostname), title);
    if (data.description) {const summary=element('span',data.description);summary.dir='auto';copy.append(summary);}
    link.append(copy); $('preview').replaceChildren(link);
  }
  function setBusy(value) {
    busy = value; $('post').disabled = value || !source; $('text').disabled = value;
    dialog.querySelectorAll('[data-community-share-close]').forEach(button => button.disabled = value);
    $('post').textContent = value ? 'Posting…' : 'Post';
  }
  function close() { if (!busy) dialog.close(); }
  async function profile(own = revision) {
    const request = ++authRevision;
    try {
      const token = await window.hadithAuth?.getToken();
      if (own !== revision || request !== authRevision) return;
      if (!token) { $('name').textContent = 'Share a post';$('avatar')?.replaceChildren(); return; }
      const response = await fetch(quranApiPath('/community/me'), {cache:'no-store',headers:{Authorization:'Bearer '+token}});
      if (!response.ok) return;
      const data = await response.json();
      if (own !== revision || request !== authRevision) return;
      if (owner && owner !== data.author.handle) { source = null; $('text').value = ''; dialog.close(); return; }
      const avatar=$('avatar');
      if(avatar){const img=element('img');img.alt='';img.referrerPolicy='no-referrer';img.src=data.author.photo || data.author.avatarFallback || '/static/img/pwa/hadith-512.png';img.addEventListener('error',()=>img.remove(),{once:true});avatar.replaceChildren(img);}
      owner = data.author.handle; $('name').textContent = data.author.publicName || data.author.name.trim().split(/\s+/u)[0];
    } catch (_) { /* The editor remains available while account details load. */ }
  }
  function open(data) {
    if (busy) return;
    const url = new URL(data.url, location.href);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Invalid source link.');
    const next = {url:url.href, title:data.title || url.hostname, description:data.description || '', image:sourceIcon(url), imageKind:'icon', source:true};
    next.imageBlob = data.imageBlob || null;
    const changed = source?.url !== next.url || source?.imageBlob !== next.imageBlob;
    releaseImagePreview();
    if (next.imageBlob) imagePreviewUrl = URL.createObjectURL(next.imageBlob);
    source = next; ++revision; waitingForSignIn = false;
    if (changed) $('text').value = typeof data.text === 'string' ? data.text : '';
    $('status').replaceChildren(); setBusy(false); preview(source);
    document.getElementById('content-share-pane')?.close();
    if (!dialog.open) dialog.showModal();
    $('text').focus({preventScroll:true});
    // Neither authentication nor remote metadata delays opening the editor.
    profile();
    if (source.imageBlob) return;
    const own = revision;
    fetch(quranApiPath('/community/link-preview')+'?url='+encodeURIComponent(source.url), {cache:'no-store'})
      .then(async response => { if(!response.ok) return; const data=await response.json(); if(own!==revision || !source)return;
        preview({title:data.title && data.title!==new URL(source.url).hostname ? data.title : source.title,description:data.description || source.description,image:source.image || data.image,imageKind:source.imageKind,source:data.source || source.source});
      }).catch(() => { /* Keep the source title and excerpt already on screen. */ });
  }
  dialog.querySelectorAll('[data-community-share-close]').forEach(button => button.addEventListener('click',close));
  dialog.addEventListener('cancel', event => { if(busy)event.preventDefault(); });
  $('form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !source) return;
    const own = revision, account = authRevision;
    const draft = source, caption = $('text').value.trim();
    setBusy(true); $('status').textContent = 'Posting…';
    try {
      const token = await window.hadithAuth?.getToken();
      if (own !== revision || account !== authRevision) return;
      if (!token) {
        waitingForSignIn = true; dialog.close();
        await window.hadithAuth?.requireToken?.('Please sign in to share your Community post.');
        $('status').textContent = 'Sign in to post. Your text is kept here.';
        return;
      }
      if (draft.imageBlob && !draft.uploadedImageUrl) {
        const upload = await fetch(quranApiPath('/community/media'), {method:'POST',cache:'no-store',credentials:'same-origin',headers:{Authorization:'Bearer '+token,'Content-Type':draft.imageBlob.type},body:draft.imageBlob});
        const media = await upload.json();
        if (own !== revision || account !== authRevision) return;
        if (!upload.ok) throw Error(media.error || 'Unable to upload your image.');
        draft.uploadedImageUrl = media.url;
      }
      const markdown = [caption, draft.imageBlob ? '![Shared image](' + draft.uploadedImageUrl + ')' : '', draft.url].filter(Boolean).join('\n\n');
      const response = await fetch(quranApiPath('/community/posts'), {method:'POST',cache:'no-store',credentials:'same-origin',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({kind:'note',title:'',markdown,tags:'',notifyEmail:false,action:'publish'})});
      const data = await response.json();
      if (own !== revision || account !== authRevision) return;
      if (!response.ok) throw Error(data.error || 'Unable to publish your post.');
      const post = data.post;
      const message = post.status === 'pending' ? 'Submitted for review. ' : 'Your post is published. ';
      const link = element('a',post.status === 'pending' ? 'View My Profile' : 'View post');
      link.href = post.status === 'published' ? post.url : '/community/mine'; link.target='_blank';link.rel='noopener';
      $('status').replaceChildren(document.createTextNode(message),link);
      $('text').value = ''; source = null; releaseImagePreview();
      document.dispatchEvent(new CustomEvent('communityPostShared',{detail:{post}}));
    } catch(err) { if(own===revision)$('status').textContent = err.message || 'Unable to publish your post.'; }
    finally { if(own===revision)setBusy(false); }
  });
  document.addEventListener('hadithAuthChanged', event => {
    ++authRevision;
    if (owner && !event.detail?.user) { ++revision; source=null;owner=null;$('text').value='';setBusy(false);dialog.close();return; }
    if (waitingForSignIn && source) { waitingForSignIn=false;if(!dialog.open)dialog.showModal(); }
    profile();
  });
  window.CommunityPostShare = {open};
})();
