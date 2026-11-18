/* global window, document, fetch */
(function () {
  'use strict';
  const config = document.querySelector('script[data-book-toc-editor]');
  const table = document.querySelector('#toc');
  if (!config || !table) return;
  const rows = Array.from(table.querySelectorAll('[data-toc-edit-id]'));
  const virtual = config.dataset.virtual === '1';
  let state, loading, busy = false, blocked = false;
  const expansionKey = `toc-edit-expanded:${config.dataset.bookId}`;
  function element(tag, className, text) {
    const el = document.createElement(tag); el.className = className || '';
    if (text) el.textContent = text;
    return el;
  }
  function button(icon, label, action) {
    const el = element('button', 'btn btn-sm btn-outline-secondary'); el.type = 'button';
    el.title = label; el.setAttribute('aria-label', label); el.dataset.tocAction = action;
    const symbol = element('span', `bi bi-${icon}`); symbol.setAttribute('aria-hidden', 'true'); el.append(symbol);
    return el;
  }
  function status(container) {
    let el = container.querySelector('[data-toc-status]');
    if (!el) { el = element('div','toc-inline-status'); el.dataset.tocStatus = ''; el.setAttribute('role','status'); el.setAttribute('aria-live','polite'); container.append(el); }
    return el;
  }
  async function request(command) {
    const token = await window.hadithAuth?.getToken();
    const response = await fetch(`/update/book-toc/${config.dataset.bookId}`, {
      method: command ? 'POST' : 'GET', headers: {'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {})},
      ...(command ? {body:JSON.stringify({...command,revision:state.revision})} : {})
    });
    let result;
    try { result = JSON.parse(await response.text()); } catch (e) { throw new Error('Unable to load the TOC. Check your admin session and reload.'); }
    if (!response.ok || (result.code && result.code !== 200)) throw new Error(result.message || 'Unable to save TOC');
    return result;
  }
  async function load() {
    if (state) return state;
    if (!loading) loading = request().then(value => {state=value; return state;}).finally(()=>{loading=null;});
    return loading;
  }
  function lock(value) {
    table.querySelectorAll('[data-toc-action],.toc-inline-row input,.toc-inline-row select').forEach(el => {
      if (value) { el.dataset.wasDisabled = el.disabled ? '1' : '0'; el.disabled = true; }
      else { el.disabled = el.dataset.wasDisabled === '1'; delete el.dataset.wasDisabled; }
    });
  }
  async function save(command, container) {
    if (busy || blocked) return;
    busy = true; lock(true); const message = status(container); message.textContent = 'Saving…';
    try {
      await load();
      const result = await request(command);
      if (result.refreshPending) { blocked=true; message.textContent=result.message; return; }
      message.textContent = 'Saved';
      try { window.sessionStorage.setItem(expansionKey, JSON.stringify(Array.from(table.querySelectorAll('[data-toc-toggle][aria-expanded="true"]'),el=>el.dataset.tocToggle))); } catch (e) { /* Storage may be unavailable. */ }
      window.location.reload();
    } catch (e) { message.textContent=e.message; }
    finally { busy=false; if (!blocked) lock(false); }
  }
  function inlineRow(anchor, kind, afterSubtree) {
    const id = anchor?.dataset.tocEditId || 'root';
    const existing = table.querySelector(`[data-toc-inline="${kind}-${id}"]`);
    if (existing) { existing.hidden=!existing.hidden; return existing.hidden ? null : existing; }
    const tr=element('tr','toc-inline-row'); tr.dataset.tocInline=`${kind}-${id}`;
    const cell=tr.insertCell(); cell.colSpan=rows[0] ? Array.from(rows[0].cells).reduce((total,cell)=>total+cell.colSpan,0) : 4;
    if (anchor) {
      let end=anchor;
      if (afterSubtree) {
        const start=rows.indexOf(anchor), level=Number(anchor.dataset.tocEditLevel);
        for (let i=start+1;i<rows.length && Number(rows[i].dataset.tocEditLevel)>level;i++) end=rows[i];
      }
      end.after(tr);
      // Keep the inline editor in the same chapter's expanded content.
      const parent=anchor.dataset.tocParent || anchor.dataset.tocChapter;
      if (parent) {
        tr.dataset.tocParent=parent;
        const toggle=Array.from(table.querySelectorAll('[data-toc-toggle]')).find(el=>el.dataset.tocToggle===parent);
        if (toggle && toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
      }
    } else table.tBodies[0].append(tr);
    return tr;
  }
  function addForm(anchor) {
    const tr=inlineRow(anchor,'add',true); if (!tr) return;
    if (tr.querySelector('form')) {tr.querySelector('input').focus(); return;}
    const level=anchor ? Number(anchor.dataset.tocEditLevel)+1 : 1;
    const names=['','chapter','section','subsection'];
    const form=element('form','toc-inline-add'); form.dataset.tocAdd=String(level);
    for (const [name,label] of [['title_en',`New ${names[level]} heading`],['title','Arabic title (optional)']]) {
      const input=element('input','form-control form-control-sm'); input.name=name; input.placeholder=label; input.setAttribute('aria-label',label); input.maxLength=4000;
      if (name==='title') {input.lang='ar';input.dir='rtl';} form.append(input);
    }
    const submit=button('plus-lg',`Add ${names[level]}`,'add');submit.type='submit';form.append(submit);
    if (anchor) {const cancel=button('x-lg','Cancel adding heading','cancel'); cancel.onclick=()=>{tr.hidden=true;};form.append(cancel);}
    form.addEventListener('submit',event=>{event.preventDefault();save({action:'add',level,parentId:anchor?.dataset.tocEditId,title:form.elements.title.value,title_en:form.elements.title_en.value},tr.cells[0]);});
    form.addEventListener('focusin',()=>{load().catch(e=>{status(tr.cells[0]).textContent=e.message;});},{once:true});
    tr.cells[0].append(form);
    if (anchor) form.elements.title_en.focus();
  }
  async function showItems(anchor) {
    const tr=inlineRow(anchor,'items',false); if (!tr || tr.dataset.loaded) return;
    const cell=tr.cells[0]; status(cell).textContent='Loading items…';
    try {
      await load();
      let items=state.items.filter(i=>String(i.tocId)===anchor.dataset.tocEditId);
      if (virtual) items=items.slice().sort((a,b)=>Number(a.num0)-Number(b.num0)||a.ordinal-b.ordinal||a.id-b.id);
      const search=element('input','form-control form-control-sm');search.type='search';search.placeholder='Find item by reference';search.setAttribute('aria-label','Find item under this heading');
      const list=element('div','toc-inline-items'), pagination=element('div','toc-inline-actions');
      const previous=button('chevron-left','Previous items','previous-items'), next=button('chevron-right','Next items','next-items'), count=element('span','small');
      pagination.append(previous,count,next);cell.append(search,list,pagination);let offset=0;
      function renderItems() {
      const filtered=items.filter(item=>String(item.num).toLowerCase().includes(search.value.trim().toLowerCase()));
      list.replaceChildren();previous.disabled=offset===0;next.disabled=offset+25>=filtered.length;pagination.hidden=filtered.length<=25;
      count.textContent=`${offset+1}–${Math.min(offset+25,filtered.length)} of ${filtered.length}`;
      for (const item of filtered.slice(offset,offset+25)) {
        const row=element('div','toc-inline-item'); row.dataset.tocItem=String(item.id);
        const link=element('a','',`${state.book.alias}:${item.num}`);link.href=`/${encodeURIComponent(state.book.alias)}:${encodeURIComponent(item.num)}`;row.append(link);
        if (!virtual) for (const direction of ['up','down']) {
          const control=button(`arrow-${direction}`,`Move ${item.num} ${direction}`,`item-${direction}`);
          const index=state.items.indexOf(item), neighbor=state.items[index+(direction==='up'?-1:1)];control.disabled=!neighbor || neighbor.tocId!==item.tocId;
          control.onclick=()=>save({action:'moveItem',id:item.id,direction},cell);row.append(control);
        }
        const select=element('select','form-select form-select-sm'); select.setAttribute('aria-label',`Move ${item.num} to heading`);
        select.add(new Option('Move to heading…',''));
        state.headings.filter(h=>Number(h.id)!==Number(item.tocId)).forEach(h=>select.add(new Option(`H${h.level} ${[h.h1,h.h2,h.h3].slice(0,h.level).join('.')} — ${h.title_en||h.title||'Untitled'}`,h.id)));
        const move=button('arrow-right','Move item to selected heading','assign');move.disabled=true;select.onchange=()=>{move.disabled=!select.value;};move.onclick=()=>save({action:'assign',id:item.id,headingId:select.value},cell);row.append(select,move);list.append(row);
      }
      status(cell).textContent=filtered.length ? '' : 'No matching items directly under this heading.';
      }
      search.oninput=()=>{offset=0;renderItems();};previous.onclick=()=>{offset=Math.max(0,offset-25);renderItems();};next.onclick=()=>{offset+=25;renderItems();};renderItems();tr.dataset.loaded='true';
    } catch(e) {status(cell).textContent=e.message;}
  }
  for (const row of rows) {
    const title=row.querySelector('[data-prop="toc.title_en"]'); if (!title) continue;
    const cell=title.closest('td'), actions=element('span','toc-inline-actions'); actions.setAttribute('role','group');actions.setAttribute('aria-label','Heading actions');
    const level=Number(row.dataset.tocEditLevel);
    if (!virtual) {
      const peers=rows.filter(peer=>peer.dataset.tocEditLevel===row.dataset.tocEditLevel && (level===1||peer.dataset.tocEditH1===row.dataset.tocEditH1) && (level<3||peer.dataset.tocEditH2===row.dataset.tocEditH2));
      for (const direction of ['up','down']) {
        const control=button(`arrow-${direction}`,`Move heading ${direction}`,`heading-${direction}`);
        control.disabled=!peers[peers.indexOf(row)+(direction==='up'?-1:1)];control.onclick=()=>save({action:'moveHeading',id:row.dataset.tocEditId,direction},cell);actions.append(control);
      }
    }
    if (level<3) {const add=button('plus-lg',level===1?'Add section under this chapter':'Add subsection under this section','add-child');add.onclick=()=>addForm(row);actions.append(add);}
    const items=button('list-ul','Move items under this heading','items');items.onclick=()=>showItems(row);actions.append(items);
    const remove=button('trash','Delete heading','delete');remove.classList.replace('btn-outline-secondary','btn-outline-danger');
    remove.onclick=()=>{if(window.confirm('Delete this heading and its introduction? Move its items and remove child headings first.')) save({action:'delete',id:row.dataset.tocEditId},cell);};actions.append(remove);cell.append(actions);
  }
  addForm(null);
  // Restore the chapter context after a saved change reloads the TOC.
  document.addEventListener('DOMContentLoaded',()=>{
    try {
      const expanded=JSON.parse(window.sessionStorage.getItem(expansionKey)||'[]');window.sessionStorage.removeItem(expansionKey);
      for(const id of expanded) {
        const toggle=Array.from(table.querySelectorAll('[data-toc-toggle]')).find(el=>el.dataset.tocToggle===id);
        if(toggle) {
          toggle.setAttribute('aria-expanded','true'); toggle.title='Hide sections';
          const icon=toggle.querySelector('.toc-expand-icon');if(icon){icon.classList.remove('bi-chevron-right');icon.classList.add('bi-chevron-down');}
          table.querySelectorAll('[data-toc-parent]').forEach(row=>{if(row.dataset.tocParent===id) row.classList.remove('d-none');});
        }
      }
    } catch(e) { /* Leave the default TOC expansion intact. */ }
  });
})();
