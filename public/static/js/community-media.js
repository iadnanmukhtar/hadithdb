/* global quranApiPath */
(() => {
  'use strict';
  const root=document.getElementById('community');if(!root)return;
  const $=id=>document.getElementById('community-'+id);
  let account=0,activeEditor=null,pending=0;
  const blobs=new Set(),previews=new Map();
  window.communityPrepareMediaHtml=html=>{
    const template=document.createElement('template');template.innerHTML=html;
    template.content.querySelectorAll('img').forEach(img=>{if(/^\/community\/media\/[a-f0-9]{32}$/.test(img.getAttribute('src')||'')){img.dataset.mediaSrc=img.getAttribute('src');img.removeAttribute('src');}});
    return template.innerHTML;
  };
  function pendingChanged(delta){pending=Math.max(0,pending+delta);window.communityMediaPending=pending;document.dispatchEvent(new CustomEvent('communityMediaPending'));}
  function insert(textarea,text){const scroll=textarea.scrollTop;textarea.setRangeText(text,textarea.selectionStart,textarea.selectionEnd,'end');textarea.scrollTop=scroll;textarea.dispatchEvent(new Event('input',{bubbles:true}));}
  async function token(){const value=await window.hadithAuth?.getToken();if(!value){window.hadithAuth?.requireToken?.('Please sign in to add media.');throw Error('Please sign in to add media.');}return value;}
  async function upload(textarea,files,message){
    const batchAccount=account;
    for(const file of Array.from(files).slice(0,5)){
      if(batchAccount!==account)break;
      if(!file.type.startsWith('image/'))continue;
      if(file.size>5*1024*1024){message.textContent='Choose an image up to 5 MB.';continue;}
      const own=account,marker='![Uploading image…](upload:'+crypto.randomUUID()+')';
      pendingChanged(1);insert(textarea,'\n\n'+marker+'\n\n');message.textContent='Uploading image…';
      try{
        const auth=await token();if(own!==account)continue;
        const response=await fetch(quranApiPath('/community/media'),{method:'POST',headers:{Authorization:'Bearer '+auth,'Content-Type':file.type},body:file});
        const result=await response.json();if(!response.ok)throw Error(result.error||'Image upload failed.');if(own!==account)continue;
        const index=textarea.value.indexOf(marker);
        if(index!==-1){textarea.setRangeText('![Image description]('+result.url+')',index,index+marker.length,'preserve');textarea.dispatchEvent(new Event('input',{bubbles:true}));}
        message.textContent='Image added. You can edit its description in the Markdown.';
      }catch(err){if(own===account){const index=textarea.value.indexOf(marker);if(index!==-1)textarea.setRangeText('',index,index+marker.length,'preserve');textarea.dispatchEvent(new Event('input',{bubbles:true}));message.textContent=err.message;}}
      finally{pendingChanged(-1);}
    }
  }
  root.querySelectorAll('[data-media-editor]').forEach(toolbar=>{
    const textarea=$(toolbar.dataset.mediaEditor),fileInput=toolbar.querySelector('input[type=file]'),message=toolbar.querySelector('[role=status]');
    toolbar.querySelector('[data-add-image]').addEventListener('click',()=>fileInput.click());
    fileInput.addEventListener('change',()=>{upload(textarea,fileInput.files,message);fileInput.value='';});
    for(const selector of ['[data-add-link]','[data-add-video]'])toolbar.querySelector(selector).addEventListener('click',()=>{activeEditor=textarea;$('media-dialog-title').textContent=selector.includes('video')?'Add a video':'Add a link';$('media-error').textContent='';$('media-link-form').reset();$('media-dialog').showModal();$('media-url').focus();});
    textarea.addEventListener('paste',event=>{
      const files=Array.from(event.clipboardData?.items||[]).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);
      if(files.length){event.preventDefault();upload(textarea,files,message);}
    });
    textarea.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});
    textarea.addEventListener('drop',event=>{const files=Array.from(event.dataTransfer?.files||[]).filter(file=>file.type.startsWith('image/'));if(files.length){event.preventDefault();upload(textarea,files,message);}});
  });
  $('media-cancel')?.addEventListener('click',()=>$('media-dialog').close());
  $('media-link-form')?.addEventListener('submit',event=>{
    event.preventDefault();let url;try{url=new URL($('media-url').value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error();}catch{$('media-error').textContent='Enter a valid http or https URL.';return;}
    insert(activeEditor,'\n\n'+url.href+'\n\n');$('media-dialog').close();activeEditor.focus();
  });
  function element(tag,text,className){const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;}
  async function hydratePreview(block){
    if(block.dataset.hydrated)return;block.dataset.hydrated='true';const url=block.dataset.previewUrl;
    try{
      if(!previews.has(url))previews.set(url,fetch(quranApiPath('/community/link-preview')+'?url='+encodeURIComponent(url)).then(async response=>{if(!response.ok)throw Error();return response.json();}));
      const data=await previews.get(url);if(!block.isConnected)return;
      const card=element('a',null,'community-link-card');card.href=data.url;card.target='_blank';card.rel='ugc nofollow noopener';
      if(data.image){const img=element('img');img.src=data.image;img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>img.remove(),{once:true});card.append(img);}
      const copy=element('span',null,'community-link-copy');copy.append(element('small',new URL(data.url).hostname),element('strong',data.title));if(data.description)copy.append(element('span',data.description));card.append(copy);block.replaceChildren(card);
      if(data.video){const play=element('button',null,'community-video-play');play.type='button';const icon=element('i',null,'bi bi-play-circle');icon.setAttribute('aria-hidden','true');play.append(icon,document.createTextNode(' Play video'));play.addEventListener('click',()=>{
        const player=element(data.video.type==='iframe'?'iframe':'video');player.src=data.video.src;
        if(player.tagName==='IFRAME'){player.title=data.title||'Video';player.allow='fullscreen; picture-in-picture';player.allowFullscreen=true;player.referrerPolicy='no-referrer';player.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation');}else{player.controls=true;player.preload='metadata';}
        player.className='community-video-player';block.prepend(player);play.remove();
      },{once:true});block.prepend(play);}
    }catch{previews.delete(url); /* The original link stays usable. */}
  }
  async function hydrateImage(img){
    if(img.dataset.mediaChecked)return;
    const source=img.getAttribute('src')||img.dataset.mediaSrc;if(!/^\/community\/media\/[a-f0-9]{32}$/.test(source||''))return;
    img.dataset.mediaChecked='true';img.loading='lazy';img.alt=img.alt||'Attached image';
    // Ordinary published images use their canonical URL. Private previews use an authenticated blob.
    if(!img.closest('#community-editor-cover,#community-preview,#community-quick-preview,#community-moderation,.community-entry[data-private="true"]'))return;
    const own=account;
    try{const auth=await window.hadithAuth?.getToken();if(!auth)return;const response=await fetch(source,{headers:{Authorization:'Bearer '+auth}});if(!response.ok)return;const blob=await response.blob();if(own!==account||!img.isConnected)return;const url=URL.createObjectURL(blob);blobs.add(url);img.src=url;}catch{}
  }
  function hydrate(container){
    if(container.nodeType!==1)return;
    if(container.matches('.community-link-preview[data-preview-url]'))hydratePreview(container);
    container.querySelectorAll('.community-link-preview[data-preview-url]').forEach(hydratePreview);
    if(container.matches('img'))hydrateImage(container);container.querySelectorAll('img').forEach(hydrateImage);
  }
  function release(container){
    if(container.nodeType!==1)return;
    for(const img of [ ...(container.matches('img')?[container]:[]),...container.querySelectorAll('img') ]) {
      if(blobs.has(img.src)){URL.revokeObjectURL(img.src);blobs.delete(img.src);}
    }
  }
  new MutationObserver(records=>{for(const record of records){for(const removed of record.removedNodes)release(removed);for(const added of record.addedNodes)hydrate(added);}}).observe(root,{childList:true,subtree:true});hydrate(root);
  document.addEventListener('hadithAuthChanged',()=>{account++;for(const url of blobs)URL.revokeObjectURL(url);blobs.clear();$('media-dialog')?.close();activeEditor=null;root.querySelectorAll('.community-media-status').forEach(el=>el.textContent='');});
  window.addEventListener('pagehide',()=>{for(const url of blobs)URL.revokeObjectURL(url);});
})();
