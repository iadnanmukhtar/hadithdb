(() => {
  'use strict';
  const button=document.getElementById('community-editor-fullscreen');
  const editor=button?.closest('.community-editor');
  if(!editor)return;
  let expanded=false,restore=[],scroll=[0,0],bodyOverflow='';
  function setExpanded(value){
    if(value===expanded)return;
    expanded=value;
    if(expanded){
      scroll=[window.scrollX,window.scrollY];bodyOverflow=document.body.style.overflow;
      // Match notebook page mode: isolate the editor without recreating its DOM,
      // so the draft, selection, undo history and upload state remain intact.
      for(let node=editor;node && node!==document.body;node=node.parentElement){
        for(const sibling of node.parentElement.children){
          if(sibling===node || sibling.matches('script,style,link,.modal,.modal-backdrop,dialog'))continue;
          restore.push({element:sibling,hidden:sibling.hidden,inert:sibling.inert});
          sibling.hidden=true;sibling.inert=true;
        }
      }
      document.body.style.overflow='hidden';
    }else{
      for(const {element,hidden,inert} of restore){element.hidden=hidden;element.inert=inert;}
      restore=[];document.body.style.overflow=bodyOverflow;
    }
    editor.classList.toggle('community-editor-fullscreen',expanded);
    const label=expanded?'Restore article size':'Expand article';
    button.title=label;button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(expanded));
    button.firstElementChild.className=expanded?'bi bi-fullscreen-exit':'bi bi-arrows-fullscreen';
    if(!expanded){window.scrollTo(...scroll);button.focus({preventScroll:true});}
  }
  button.addEventListener('mousedown',event=>event.preventDefault());
  button.addEventListener('click',()=>setExpanded(!expanded));
  editor.addEventListener('keydown',event=>{
    if(!expanded || event.defaultPrevented)return;
    if(event.key==='Escape'){
      // Let open formatting menus and Bootstrap dialogs consume Escape first.
      if(document.querySelector('.modal.show,dialog[open]') || editor.querySelector('.community-format-secondary:not([hidden])'))return;
      event.preventDefault();setExpanded(false);
    }
    if(event.key==='Tab'){
      const controls=[...editor.querySelectorAll('button,a[href],input,textarea,select,[tabindex],[contenteditable="true"]')].filter(el=>!el.disabled && el.tabIndex>=0 && el.getClientRects().length && !el.closest('[hidden],[inert]'));
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
    }
  });
})();
