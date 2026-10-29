(() => {
  'use strict';
  // Keep Markdown as the storage contract. Unsupported notebook constructs stay
  // in source mode; never round-trip them through a lossy rich-text conversion.
  const instances = new WeakMap();
  function safeLink(value) {
    try { const u = new URL(value, location.origin); return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? value : null; } catch (_) { return null; }
  }
  const escape = text => text.replace(/([\\`*_{}\[\]<>#|~])/g, '\\$1').replace(/^([ \t]*)([-+] |\d+\. )/gm, '$1\\$2');
  function render(markdown) {
    if (!window.marked || /__|==|\[\[|\[\^|[{}^]|\|\||(?<!~)~(?!~)|:[a-z_+-]+:|^\s*[:~] |^-# |^---\s*\n|^\s*\[[^\]]+\]:/m.test(markdown)) return null;
    const root = document.createElement('div');
    function append(tokens, parent) {
      for (const t of tokens) {
        if (t.type === 'space') continue;
        if (t.type === 'text' || t.type === 'escape') {
          if (t.tokens) append(t.tokens, parent); else {const decoded=document.createElement('textarea');decoded.innerHTML=t.text.replace(/</g,'&lt;');parent.append(document.createTextNode(decoded.value));}
          continue;
        }
        const tags = {paragraph:'p',strong:'strong',em:'em',del:'s',codespan:'code',br:'br',blockquote:'blockquote',heading:'h'+t.depth,link:'a',list:t.ordered?'ol':'ul',list_item:'li'};
        if (!tags[t.type] || t.task || t.title) throw Error('Use Markdown for this content');
        const el = document.createElement(tags[t.type]);
        if (['paragraph','heading','list_item','blockquote'].includes(t.type)) el.dir = 'auto';
        if (t.type === 'link') { const href = safeLink(t.href); if (!href) throw Error('Unsafe link'); el.setAttribute('href', href); }
        if (t.type === 'list' && t.ordered && t.start !== 1) el.start = t.start;
        if (t.type === 'codespan') el.textContent = t.text;
        else if (t.type !== 'br') append(t.items || t.tokens || [], el);
        parent.append(el);
      }
    }
    try { append(window.marked.lexer(markdown), root); return root; } catch (_) { return null; }
  }
  function serialize(root) {
    function contents(parent) {
      let result='';
      for(const child of parent.childNodes) {
        if(child.nodeType===1 && /^(P|DIV|H[1-6]|BLOCKQUOTE|UL|OL)$/.test(child.tagName) && result && !result.endsWith('\n'))result+='\n\n';
        result+=read(child);
      }
      return result;
    }
    function read(el) {
      if (el.nodeType === 3) return escape(el.nodeValue.replace(/\u00a0/g, ' '));
      if (el.nodeType !== 1) return '';
      const text = () => contents(el);
      const wrap = marker => { const s=text();return s.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_,a,b,c)=>a+(b?marker+b+marker:'')+c); };
      switch (el.tagName) {
        case 'BR': return '\n';
        case 'B': case 'STRONG': return wrap('**');
        case 'I': case 'EM': return wrap('*');
        case 'S': case 'STRIKE': case 'DEL': return wrap('~~');
        case 'CODE': {const t=el.textContent; const ticks='`'.repeat(Math.max(0,...(t.match(/`+/g)||[]).map(s=>s.length))+1);return ticks+' '+t+' '+ticks;}
        case 'A': {const href=safeLink(el.getAttribute('href'));return href?'['+text()+']('+href.replace(/\(/g,'%28').replace(/\)/g,'%29')+')':text();}
        case 'P': case 'DIV': return text()+'\n\n';
        case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': return '#'.repeat(Number(el.tagName[1]))+' '+text()+'\n\n';
        case 'BLOCKQUOTE': return text().trim().split('\n').map(line=>'> '+line).join('\n')+'\n\n';
        case 'UL': case 'OL': return Array.from(el.children).map((li,i)=>{const prefix=el.tagName==='OL'?(Number(el.getAttribute('start'))||1)+i+'. ':'- ';return prefix+contents(li).trim().replace(/\n/g,'\n'+' '.repeat(prefix.length));}).join('\n')+'\n\n';
        default: return text();
      }
    }
    return contents(root).replace(/\n{3,}/g,'\n\n').trim();
  }
  function install(source) {
    if (!source || instances.has(source) || !window.marked) return;
    const shell=document.createElement('div'); shell.className='community-short-editor'+(source.dataset.articleEditor!==undefined?' community-article-surface':'');
    const tools=document.createElement('div'); tools.className='community-short-tools';
    const toggle=document.createElement('button');toggle.type='button';toggle.className='community-editor-mode';toggle.textContent='Markdown';toggle.setAttribute('aria-label','Switch to Markdown editing');
    const format=document.createElement('div');format.className='community-selection-tools';format.hidden=true;format.setAttribute('role','group');format.setAttribute('aria-label','Text formatting');
    const rich=document.createElement('div');rich.className='community-rich-input notebook-markdown';rich.contentEditable='true';rich.setAttribute('role','textbox');rich.setAttribute('aria-multiline','true');rich.setAttribute('aria-label',source.getAttribute('aria-label') || source.labels?.[0]?.textContent || source.placeholder || 'Post text');rich.dataset.placeholder=source.placeholder;rich.dir='auto';
    const hint=document.createElement('span');hint.className='community-editor-hint';hint.textContent='Select text to format';
    tools.append(hint,toggle);shell.append(format,rich,tools);source.before(shell);
    let mode='rich', syncing=false, savedRange=null, composing=false, lastHTML='';
    const required=source.required;source.required=false;
    function sync() {
      if(mode!=='rich'||syncing||rich.innerHTML===lastHTML)return;
      rich.querySelectorAll('p,div,li,blockquote,h1,h2,h3,h4,h5,h6').forEach(el=>el.dir='auto');
      const markdown=serialize(rich);
      lastHTML=rich.innerHTML;syncing=true;source.value=markdown;
      source.dispatchEvent(new Event('input',{bubbles:true}));syncing=false;
      rich.setAttribute('aria-invalid',String(source.maxLength>0 && markdown.length>source.maxLength));
    }
    function hydrate() {
      if(syncing)return;
      const rendered=render(source.value);
      if(mode==='rich' && !rendered) mode='source';
      if(rendered && mode==='rich'){rich.replaceChildren(...rendered.childNodes);lastHTML=rich.innerHTML;}
      source.hidden=mode==='rich';rich.hidden=mode!=='rich';
      source.required=mode==='source' && required;
      toggle.textContent=mode==='rich'?'Markdown':'Formatted';
      toggle.setAttribute('aria-label',mode==='rich'?'Switch to Markdown editing':'Switch to formatted editing');
      hint.textContent=mode==='rich'?'Select text to format':rendered?'Markdown editing':'Advanced formatting · Markdown editing';
      rich.contentEditable=String(!source.disabled && !source.readOnly);rich.setAttribute('aria-disabled',String(source.disabled));toggle.disabled=source.disabled || mode==='source' && !rendered;
      if(mode!=='rich')format.hidden=true;
    }
    const value=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');
    Object.defineProperty(source,'value',{configurable:true,get(){return value.get.call(this);},set(v){value.set.call(this,v);hydrate();}});
    const focus=source.focus.bind(source);source.focus=options=>mode==='rich'?rich.focus(options):focus(options);
    function toSource() {
      if(mode!=='rich')return;
      const clone=rich.cloneNode(true), range=savedRange;
      const begin='COMMUNITYSTART'+Date.now()+'MARK',end='COMMUNITYEND'+Date.now()+'MARK';
      function map(node) {const path=[];while(node!==rich){path.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes,node));node=node.parentNode;}let target=clone;for(const i of path)target=target.childNodes[i];return target;}
      if(range && rich.contains(range.startContainer) && rich.contains(range.endContainer)) {
        const r=document.createRange();r.setStart(map(range.startContainer),range.startOffset);r.setEnd(map(range.endContainer),range.endOffset);
        const tail=r.cloneRange();tail.collapse(false);tail.insertNode(document.createTextNode(end));
        r.collapse(true);r.insertNode(document.createTextNode(begin));
        const marked=serialize(clone),start=marked.indexOf(begin),finish=marked.indexOf(end)-begin.length;
        mode='source';source.value=marked.replace(begin,'').replace(end,'');hydrate();source.setSelectionRange(Math.max(0,start),Math.max(0,finish));
      } else {sync();mode='source';hydrate();source.setSelectionRange(source.value.length,source.value.length);}
    }
    toggle.addEventListener('click',()=>{if(mode==='rich')toSource();else if(render(source.value)){mode='rich';hydrate();}source.focus();});
    function insertParallel() {
      if(source.disabled || source.readOnly || !window.CommunityParallelText)return;
      let markdown=source.value, position=source.selectionStart;
      if(mode==='rich') {
        // Locate the caret in a detached clone, preserving inline formatting and
        // distinguishing identical paragraphs without touching the live selection.
        const range=savedRange, clone=rich.cloneNode(true), marker='COMMUNITYCARET'+Date.now()+'END';
        if(range && rich.contains(range.startContainer)) {
          const path=[];let current=range.startContainer;
          while(current!==rich){path.unshift(Array.prototype.indexOf.call(current.parentNode.childNodes,current));current=current.parentNode;}
          let target=clone;for(const index of path)target=target.childNodes[index];
          let offset=range.startOffset;
          if(target.nodeType===1 && offset>0) {
            target=target.childNodes[offset-1];while(target.lastChild)target=target.lastChild;
            offset=target.nodeType===3?target.nodeValue.length:target.childNodes.length;
            if(target.nodeName==='BR'){offset=Array.prototype.indexOf.call(target.parentNode.childNodes,target);target=target.parentNode;}
          }
          const caret=document.createRange();caret.setStart(target,offset);caret.collapse(true);caret.insertNode(document.createTextNode(marker));
        } else clone.append(document.createTextNode(marker));
        const marked=serialize(clone);position=marked.indexOf(marker);markdown=marked.replace(marker,'');
        if(position<0)return;
        mode='source';source.value=markdown;hydrate();
      }
      const edit=window.CommunityParallelText.replacement(markdown,position);
      source.focus();source.setSelectionRange(edit.start,edit.end);
      if(!document.execCommand?.('insertText',false,edit.text))source.setRangeText(edit.text,edit.start,edit.end,'end');
      source.setSelectionRange(edit.selectStart,edit.selectEnd);
      source.dispatchEvent(new Event('input',{bubbles:true}));
    }
    const commands=[['Bold','type-bold','bold'],['Italic','type-italic','italic'],['Strikethrough','type-strikethrough','strikeThrough'],['Code','code','code'],['Bulleted list','list-ul','insertUnorderedList'],['Numbered list','list-ol','insertOrderedList'],['Quote','blockquote-left','formatBlock','blockquote'],['Link','link-45deg','link'],['Parallel English and Arabic text',null,'parallel']];
    function selection() {
      if(source.disabled || source.readOnly){format.hidden=true;return;}
      if(mode==='source') {
        format.hidden=!(source.ownerDocument.activeElement===source || format.contains(source.ownerDocument.activeElement)) || source.selectionStart===source.selectionEnd;
        return;
      }
      const s=window.getSelection();
      if(!s)return;
      if(s.rangeCount && rich.contains(s.anchorNode) && rich.contains(s.focusNode)) {
        savedRange=s.getRangeAt(0).cloneRange();format.hidden=s.isCollapsed;
      } else if(!format.contains(source.ownerDocument.activeElement)) format.hidden=true;
    }
    for(const event of ['select','keyup','mouseup','focus','blur'])source.addEventListener(event,selection);
    format.addEventListener('mousedown',e=>e.preventDefault());
    for(const [label,glyph,command,arg] of commands){
      const b=document.createElement('button');b.type='button';b.title=label;b.setAttribute('aria-label',label);
      b.dataset.command=command;
      const i=document.createElement(glyph?'i':'span');i.className=glyph?'bi bi-'+glyph:'community-parallel-icon';if(!glyph){i.textContent='a|ج';i.dir='ltr';}i.setAttribute('aria-hidden','true');b.append(i);format.append(b);
      b.addEventListener('click',()=>formatAction(command,arg));
    }
    function formatAction(command,arg) {
      if(source.disabled || source.readOnly)return true;
      if(command==='parallel'){insertParallel();selection();return true;}
      if(mode!=='rich') {
        const start=source.selectionStart,end=source.selectionEnd,value=source.value;
        if(start===end)return false;
        const selected=value.slice(start,end),markers={bold:'**',italic:'*',strikeThrough:'~~',code:'`'};
        let text;
        if(markers[command])text=markers[command]+selected+markers[command];
        else if(command==='link') {
          const url=window.prompt('Link URL','https://');if(!url)return true;
          if(!safeLink(url)){hint.textContent='Use an http, https, or mailto link.';return true;}
          text='['+selected+']('+url.replace(/\(/g,'%28').replace(/\)/g,'%29')+')';
        } else if(['insertUnorderedList','insertOrderedList','formatBlock'].includes(command)) {
          const begin=value.lastIndexOf('\n',start-1)+1,stop=value.indexOf('\n',end);
          const finish=stop<0?value.length:stop;
          text=value.slice(begin,finish).split('\n').map((line,i)=>(command==='formatBlock'?'> ':command==='insertOrderedList'?(i+1)+'. ':'- ')+line).join('\n');
          source.setRangeText(text,begin,finish,'select');source.dispatchEvent(new Event('input',{bubbles:true}));selection();return true;
        } else return false;
        source.setRangeText(text,start,end,'select');source.dispatchEvent(new Event('input',{bubbles:true}));selection();return true;
      }
      if(!savedRange){rich.focus();selection();}
      if(!savedRange)return true;
      const s=window.getSelection();rich.focus();s.removeAllRanges();s.addRange(savedRange);
      if(command==='code'){
        const code=document.createElement('code');code.textContent=s.toString();document.execCommand('insertHTML',false,code.outerHTML);
      }else if(command==='link'){
        const url=window.prompt('Link URL','https://');if(!url)return true;
        if(!safeLink(url)){hint.textContent='Use an http, https, or mailto link.';return true;}
        document.execCommand('createLink',false,url);
      }else document.execCommand(command,false,arg);
      sync();selection();return true;
    }
    rich.addEventListener('focus',selection);
    rich.addEventListener('keyup',selection);
    rich.addEventListener('mouseup',selection);
    rich.addEventListener('compositionstart',()=>{composing=true;});
    rich.addEventListener('compositionend',()=>{composing=false;sync();});
    rich.addEventListener('input',()=>{if(!composing)sync();});
    // Pasted HTML never enters the editable DOM. Plain-text paste preserves
    // paragraph breaks and excludes external markup, handlers and tracking URLs.
    rich.addEventListener('paste',event=>{
      event.preventDefault();
      if(Array.from(event.clipboardData?.items || []).some(item=>item.kind==='file' && item.type.startsWith('image/'))) {
        toSource();source.dispatchEvent(new ClipboardEvent('paste',{clipboardData:event.clipboardData,bubbles:true,cancelable:true}));return;
      }
      document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));sync();
    });
    rich.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});
    rich.addEventListener('drop',event=>{event.preventDefault();if(event.dataTransfer?.files.length){toSource();source.dispatchEvent(new DragEvent('drop',{dataTransfer:event.dataTransfer,bubbles:true,cancelable:true}));}});
    rich.addEventListener('keydown',event=>{
      if(source.disabled || source.readOnly)return;
      if(event.key==='Enter' && !event.shiftKey && !event.isComposing) {
        const active=window.getSelection();
        let block=active.anchorNode?.nodeType===1?active.anchorNode:active.anchorNode?.parentElement;
        block=block?.closest('p,div,li');
        if(active.isCollapsed && block && rich.contains(block) && /^[ \t]*(?:quran:\d{1,3}:\d{1,3}(?:-\d{1,3})?|[a-z][a-z0-9_-]*:\d+[a-z]?)[ \t]*$/i.test(block.textContent)) {
          event.preventDefault();selection();toSource();source.focus();
          source.setRangeText('\n',source.selectionStart,source.selectionEnd,'end');
          source.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertParagraph',data:'\n'}));return;
        }
      }
      if((event.metaKey||event.ctrlKey)&&['b','i'].includes(event.key.toLowerCase())){event.preventDefault();document.execCommand(event.key.toLowerCase()==='b'?'bold':'italic');sync();}
      if(event.key==='Escape'){format.hidden=true;event.stopPropagation();}
    });
    source.addEventListener('input',()=>{if(!syncing)hydrate();});
    source.form?.addEventListener('reset',()=>queueMicrotask(()=>{mode='rich';hydrate();}));
    source.form?.addEventListener('submit',event=>{sync();if(required&&!source.value.trim() || source.maxLength>0&&source.value.length>source.maxLength){event.preventDefault();event.stopImmediatePropagation();rich.setAttribute('aria-invalid','true');source.focus();}},true);
    new MutationObserver(hydrate).observe(source,{attributes:true,attributeFilter:['disabled','readonly']});
    // One document listener serves every mounted editor, including feed replies.
    instances.set(source,{selection,hydrate,toSource,format:formatAction,get mode(){return mode;}});hydrate();
    return instances.get(source);
  }
  document.addEventListener('selectionchange',()=>document.querySelectorAll('[data-short-editor]').forEach(el=>instances.get(el)?.selection()));
  function scan(root=document){root.querySelectorAll('textarea[data-short-editor]').forEach(install);}
  window.CommunityShortEditor={install,render,serialize,get:source=>instances.get(source)};
  scan();new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1){if(n.matches('textarea[data-short-editor]'))install(n);scan(n);}}).observe(document.body,{childList:true,subtree:true});
})();
