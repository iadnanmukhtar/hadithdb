(() => {
  'use strict';
  const instances=new WeakMap();
  const selector='h1,h2,h3,h4,h5,h6';
  function install(root) {
    if(!root || instances.has(root))return;
    const collapsed=new Set();
    function members(heading) {
      const result=[],level=Number(heading.tagName[1]);
      for(let node=heading.nextElementSibling;node;node=node.nextElementSibling){
        if(node.matches(selector) && Number(node.tagName[1])<=level)break;
        result.push(node);
      }
      return result;
    }
    function refresh() {
      const headings=[...root.querySelectorAll(selector)].filter(h=>!h.closest('[data-notebook-raw],.footnotes'));
      for(const h of collapsed)if(!root.contains(h))collapsed.delete(h);
      for(const heading of headings){
        let button=heading.querySelector(':scope > [data-heading-fold]');
        if(!button){
          button=document.createElement('button');button.type='button';button.dataset.headingFold='';button.contentEditable='false';
          button.addEventListener('mousedown',event=>event.preventDefault());
          button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();collapsed.has(heading)?collapsed.delete(heading):collapsed.add(heading);refresh();});
          heading.prepend(button);
        }
        const open=!collapsed.has(heading),label=(open?'Collapse ':'Expand ')+heading.textContent.trim();
        button.setAttribute('aria-expanded',String(open));button.setAttribute('aria-label',label);button.title=label;
      }
      const hidden=new Set();for(const heading of collapsed)for(const node of members(heading))hidden.add(node);
      for(const node of root.querySelectorAll('.notebook-section-folded'))if(!hidden.has(node))node.classList.remove('notebook-section-folded');
      for(const node of hidden)node.classList.add('notebook-section-folded');
    }
    const state={reveal(target){for(const heading of collapsed)if(members(heading).some(node=>node===target || node.contains(target)))collapsed.delete(heading);refresh();}};
    instances.set(root,state);
    let scheduled=false;
    new MutationObserver(records=>{
      if(records.every(r=>r.type==='childList' && [...r.addedNodes,...r.removedNodes].every(n=>n.nodeType===1 && n.hasAttribute('data-heading-fold'))))return;
      if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;refresh();});}
    }).observe(root,{subtree:true,childList:true,characterData:true});
    refresh();
  }
  window.NotebookSections={install,reveal(root,target){instances.get(root)?.reveal(target);}};
})();
