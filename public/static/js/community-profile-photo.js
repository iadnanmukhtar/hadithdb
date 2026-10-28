(() => {
  'use strict';
  window.CommunityProfilePhoto = function createEditor() {
    const el = name => document.getElementById('community-photo-' + name);
    if (!el('file')) return null;
    const canvas = el('canvas'), ctx = canvas.getContext('2d');
    let image = null, pending, generation = 0, dirty = false, drag = null, loading = false;
    const controls = ['zoom', 'x', 'y'];
    function rect() {
      const side = Math.min(image.naturalWidth, image.naturalHeight) / Number(el('zoom').value);
      return {side, x:(image.naturalWidth-side)*Number(el('x').value)/100, y:(image.naturalHeight-side)*Number(el('y').value)/100};
    }
    function draw() {
      if (!image) return;
      const r = rect(); ctx.clearRect(0,0,512,512); ctx.drawImage(image,r.x,r.y,r.side,r.side,0,0,512,512);
      el('reset').disabled = el('zoom').value === '1' && el('x').value === '50' && el('y').value === '50';
      el('apply').disabled = !dirty;
    }
    function defaults() { el('zoom').value='1'; el('x').value=el('y').value='50'; }
    async function load(src, changed) {
      const request = ++generation; loading=true;
      const next = new Image();
      el('error').textContent='';
      el('apply').disabled=true;
      try {
        await new Promise((resolve,reject)=>{next.onload=resolve;next.onerror=()=>reject(new Error('This image could not be opened. Choose another photo.'));next.src=src;});
      } finally { if(request===generation)loading=false; }
      if (request !== generation) return;
      if (next.naturalWidth*next.naturalHeight>40000000) throw new Error('Choose a photo smaller than 40 megapixels.');
      image=next; defaults(); dirty=changed; el('crop').hidden=false; draw();
    }
    el('file').addEventListener('change', async () => {
      const file=el('file').files[0]; if(!file)return;
      if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)||file.size>5*1024*1024){el('error').textContent='Choose a PNG, JPEG, WebP, or GIF up to 5 MB.';el('file').value='';return;}
      const url=URL.createObjectURL(file);
      try {await load(url,true);} catch(err){el('error').textContent=err.message;} finally{URL.revokeObjectURL(url);el('file').value='';}
    });
    for(const key of controls)el(key).addEventListener('input',()=>{dirty=true;draw();});
    canvas.addEventListener('pointerdown',event=>{if(!image)return;drag={x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);});
    canvas.addEventListener('pointermove',event=>{
      if(!drag||!image)return;
      const r=rect(),scale=r.side/canvas.getBoundingClientRect().width;
      for(const [key,delta,room] of [['x',event.clientX-drag.x,image.naturalWidth-r.side],['y',event.clientY-drag.y,image.naturalHeight-r.side]]){
        if(room>0)el(key).value=String(Math.max(0,Math.min(100,Number(el(key).value)-delta*scale/room*100)));
      }
      drag={x:event.clientX,y:event.clientY};dirty=true;draw();
    });
    for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>{drag=null;});
    el('reset').addEventListener('click',()=>{defaults();dirty=true;draw();});
    el('apply').addEventListener('click',()=>{
      if(!image)return;
      pending=canvas.toDataURL('image/png');dirty=false;el('preview').src=pending;el('remove').disabled=false;draw();el('error').textContent='Crop applied. Save profile to keep it.';
    });
    el('remove').addEventListener('click',()=>{++generation;loading=false;pending=null;dirty=false;image=null;el('crop').hidden=true;el('preview').src=el('preview').dataset.fallback;el('remove').disabled=true;el('error').textContent='Save profile to use your account photo again.';});
    return {
      reset(author) {
        ++generation;loading=false;pending=undefined;dirty=false;image=null;drag=null;el('file').value='';el('crop').hidden=true;el('error').textContent='';
        el('preview').src=author.photo||author.avatarFallback;el('preview').dataset.fallback=author.accountPhoto||author.avatarFallback;el('remove').disabled=!author.customPhoto;
        if(author.customPhoto)load(author.photo,false).catch(err=>{el('error').textContent=err.message;});
      },
      value() {if(loading)throw new Error('Wait for your photo to finish loading.');if(dirty)throw new Error('Apply your photo crop before saving the profile.');return pending;},
      cancel(){++generation;loading=false;image=null;pending=undefined;dirty=false;}
    };
  };
})();
