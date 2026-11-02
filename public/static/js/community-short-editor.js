(() => {
  'use strict';
  // Keep Markdown as the storage contract. Unsupported notebook constructs stay
  // in source mode; never round-trip them through a lossy rich-text conversion.
  const instances = new WeakMap();
  let formattingMenuId=0;
  function safeLink(value) {
    try { const u = new URL(value, location.origin); return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? value : null; } catch (_) { return null; }
  }
  const escape = text => text.replace(/([\\`*_{}\[\]<>#|~^])/g, '\\$1').replace(/^([ \t]*)([-+] |\d+\. )/gm, '$1\\$2');
  function footnoteRow(label, contents) {
    const row=document.createElement('div');row.dataset.footnote=label;row.className='community-edit-footnote';
    const caption=document.createElement('span');caption.className='community-footnote-label';caption.contentEditable='false';caption.textContent='Footnote '+label;
    const body=document.createElement('div');body.className='community-footnote-body';body.dir='auto';body.setAttribute('aria-label','Footnote '+label);body.append(...contents.childNodes);
    row.append(caption,body);return row;
  }
  function reconcileFootnotes(root) {
    const labels=new Set(Array.from(root.querySelectorAll('[data-footnote-ref]'),el=>el.dataset.footnoteRef));
    root.querySelectorAll('[data-footnote]').forEach(row=>{
      const orphan=!labels.has(row.dataset.footnote);row.classList.toggle('community-orphan-footnote',orphan);
      const caption=row.querySelector('.community-footnote-label');
      if(caption)caption.textContent=(orphan?'Orphaned footnote ':'Footnote ')+row.dataset.footnote;
    });
  }
  function styleContent(root, editing=false) {
    const direction = text => /\p{Script_Extensions=Arabic}/u.test(text.match(/\p{L}/u)?.[0] || '') ? 'rtl' : 'ltr';
    // Keep DOM boundary points, including empty paragraphs and positions after
    // a BR. A document-wide text offset cannot distinguish those positions.
    const selection=window.getSelection();
    const points=selection?.anchorNode && root.contains(selection.anchorNode) && root.contains(selection.focusNode)
      ? [[selection.anchorNode,selection.anchorOffset],[selection.focusNode,selection.focusOffset]] : [];
    let moved=false;
    const remap=(old,resolve)=>points.forEach(point=>{
      if(point[0]===old){[point[0],point[1]]=resolve(point[1]);moved=true;}
    });
    root.querySelectorAll('blockquote').forEach(quote=>{
      if(quote.closest('[data-notebook-raw]') || [...quote.children].some(el=>/^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|PRE|TABLE)$/.test(el.tagName)))return;
      const paragraph=document.createElement('p');paragraph.append(...quote.childNodes);quote.append(paragraph);moved=true;
      remap(quote,offset=>[paragraph,offset]);
    });
    // Native undo retains references to edited text nodes. Never replace those
    // nodes during input; the Unicode font face handles newly typed Arabic.
    if(!editing){
    const arabic=/[\p{Script_Extensions=Arabic}\u200c\u200d]+(?:[ \t]+[\p{Script_Extensions=Arabic}\u200c\u200d]+)*/gu;
    root.querySelectorAll('.notebook-arabic').forEach(span=>{
      if(span.closest('[data-notebook-raw]'))return;
      if(!/^[\p{Script_Extensions=Arabic}\u200c\u200d \t]+$/u.test(span.textContent)){
        const parent=span.parentNode,index=[...parent.childNodes].indexOf(span);
        remap(span,offset=>[parent,index+offset]);
        span.replaceWith(...span.childNodes);moved=true;
      }
    });
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),texts=[];
    while(walker.nextNode())texts.push(walker.currentNode);
    for(const text of texts){
      if(text.parentElement?.closest('.notebook-arabic,[data-notebook-raw],[contenteditable="false"],.community-footnote-label'))continue;
      const matches=[...text.data.matchAll(arabic)];if(!matches.length)continue;
      const fragment=document.createDocumentFragment();let offset=0;
      for(const match of matches){
        if(match.index>offset)fragment.append(document.createTextNode(text.data.slice(offset,match.index)));
        const span=document.createElement('span');span.className='notebook-arabic';span.textContent=match[0];fragment.append(span);offset=match.index+match[0].length;
      }
      if(offset<text.length)fragment.append(document.createTextNode(text.data.slice(offset)));
      remap(text,position=>{
        const walk=document.createTreeWalker(fragment,NodeFilter.SHOW_TEXT);let node,last;
        while((node=walk.nextNode())){last=node;if(position<=node.length)return [node,position];position-=node.length;}
        return [last,last.length];
      });
      text.replaceWith(fragment);moved=true;
    }
    }
    root.querySelectorAll('.notebook-arabic').forEach(span=>{
      span.classList.toggle('notebook-edit-mixed',!/^\p{Script_Extensions=Arabic}[\p{Script_Extensions=Arabic}\u200c\u200d \t]*$/u.test(span.textContent));
    });
    if(moved && points.length)selection.setBaseAndExtent(...points[0],...points[1]);
    root.querySelectorAll('p,li,blockquote,h1,h2,h3,h4,h5,h6,.notebook-rich-line').forEach(el => {
      if (el.closest('[data-notebook-raw]')) return;
      let text=el.textContent;
      if(el.tagName==='LI'){
        const own=el.cloneNode(true);own.querySelectorAll('ul,ol,blockquote').forEach(node=>node.remove());text=own.textContent;
      }
      el.dir = direction(text);
      el.classList.toggle('notebook-edit-has-arabic',editing && /\p{Script_Extensions=Arabic}/u.test(el.textContent) && !el.querySelector('.notebook-arabic:not(.notebook-edit-mixed)'));
    });
    root.querySelectorAll('.notebook-quote-section,.notebook-quote-switch').forEach(el => el.classList.remove('notebook-quote-section','notebook-quote-switch'));
    root.querySelectorAll('blockquote').forEach(quote => {
      if (quote.closest('[data-notebook-raw]')) return;
      if(quote.dataset.calloutKind){
        quote.classList.remove('notebook-edit-quote');
        const title=quote.querySelector(':scope > .markdown-callout-title');
        quote.dir=direction(title?.textContent || quote.textContent);
        quote.querySelectorAll(':scope > .markdown-callout-title').forEach(node=>{if(node!==title)node.classList.remove('markdown-callout-title');});
        return;
      }
      quote.classList.add('notebook-edit-quote');
      let previous = null;
      for (const child of quote.children) {
        if (child.tagName === 'BLOCKQUOTE') { previous = null; continue; }
        const sections = child.querySelectorAll(':scope > .notebook-rich-line');
        for (const section of sections.length ? sections : [child]) {
          section.dir = direction(section.textContent);
          section.classList.add('notebook-quote-section');
          if (previous && previous.dir !== section.dir) section.classList.add('notebook-quote-switch');
          previous = section;
        }
      }
    });
  }
  function render(markdown, propheticSpeech = false) {
    const guarded=markdown.replace(/\[\^[^\]\s]+\]/g,'footnote');
    if (!window.marked || /(?<!\\)\^\[/.test(markdown) || /^---[ \t]*\r?\n/.test(markdown) || /__|[{}]|:[a-z_+-]+:|^\s*[:~] |^\s*\[[^\]]+\]:/m.test(guarded.replace(/\{\.callout\}/g,'').replace(/^ {0,3}(?:_[ \t]*){3,}$/gm,''))) return null;
    const root = document.createElement('div');
    let parser;const definitions=new Map();
    function append(tokens, parent) {
      for (const t of tokens) {
        if (t.type === 'space') continue;
        if(t.type==='blockquote' && t.tokens?.[0]?.type==='paragraph' && (/^\[![a-z][a-z0-9_-]*\]/i.test(t.text) || /\{\.callout\}/.test(t.text))){
          const marker=/^\[!([a-z][a-z0-9_-]*)\][ \t]*/i.exec(t.text),kind=marker?marker[1].toLowerCase():'note';
          const clean=t.text.replace(/[ \t]*\{\.callout\}/g,'').replace(/^\[![a-z][a-z0-9_-]*\][ \t]*/i,'');
          const newline=clean.indexOf('\n'),title=(newline<0?clean:clean.slice(0,newline)).trim(),body=newline<0?'':clean.slice(newline+1);
          const quote=document.createElement('blockquote');quote.className='markdown-callout markdown-callout-'+kind;
          quote.dataset.calloutKind=kind;quote.dataset.calloutRaw=t.raw.trimEnd();
          const heading=document.createElement('p');heading.className='markdown-callout-title';
          const defaultTitle=kind.charAt(0).toUpperCase()+kind.slice(1);
          append(new window.marked.Lexer(parser.defaults).inlineTokens(title || defaultTitle),heading);quote.append(heading);
          if(!title)quote.dataset.calloutDefaultTitle=defaultTitle;
          append(parser.lexer(body),quote);parent.append(quote);continue;
        }

        if(t.type==='footnoteDefinition'){
          if(definitions.has(t.label))throw Error('Duplicate footnote definition');
          const content=document.createElement('div');append(parser.lexer(t.text),content);
          const row=footnoteRow(t.label,content);row.dataset.footnoteRaw=t.raw.trimEnd();row.dataset.footnoteHtml=row.querySelector('.community-footnote-body').innerHTML;definitions.set(t.label,row);continue;
        }
        if(t.type==='notebookWiki'){
          const link=document.createElement('a');link.dataset.wikiTarget=t.target;
          link.dataset.wikiRaw=t.raw;link.dataset.wikiLabel=t.label;
          link.href='/notebook?note='+encodeURIComponent(t.target);link.title=t.target;
          link.textContent=t.label;parent.append(link);continue;
        }
        if(t.type==='footnoteReference'){
          const marker=document.createElement('sup');marker.dataset.footnoteRef=t.label;marker.contentEditable='false';marker.textContent='['+t.label+']';marker.setAttribute('aria-label','Footnote '+t.label);parent.append(marker);continue;
        }
        if(t.type==='subscript' || t.type==='superscript'){const el=document.createElement(t.type==='subscript'?'sub':'sup');el.textContent=t.text;parent.append(el);continue;}
        if(t.type==='subtext'){const el=document.createElement('p');el.className='notebook-subtext';el.dir='auto';append(t.tokens,el);parent.append(el);continue;}
        if(t.type==='center'){const el=document.createElement('center');append(parser.lexer(t.text),el);parent.append(el);continue;}
        if (t.type === 'parallel') {
          const row=document.createElement('div');row.className='community-edit-parallel';row.dir='ltr';
          for(const [index,text] of [t.left,t.right].entries()) {
            const cell=document.createElement('div');cell.className='community-edit-parallel-cell';cell.dir='auto';
            cell.setAttribute('aria-label',index?'Second column':'First column');
            append(parser.lexer(text.trim()),cell);
            if(!cell.childNodes.length)cell.append(document.createElement('br'));
            row.append(cell);
          }
          row.dataset.parallelSource=t.raw.replace(/\n$/,'');row.dataset.parallelHtml=row.innerHTML;
          parent.append(row);continue;
        }
        if (t.type === 'text' || t.type === 'escape') {
          if (t.tokens) append(t.tokens, parent); else {const decoded=document.createElement('textarea');decoded.innerHTML=t.text.replace(/</g,'&lt;');parent.append(document.createTextNode(decoded.value));}
          continue;
        }
        const tags = {hr:'hr',highlight:'mark',paragraph:'p',strong:'strong',em:'em',del:'s',codespan:'code',br:'br',blockquote:'blockquote',heading:'h'+t.depth,link:'a',list:t.ordered?'ol':'ul',list_item:'li'};
        if (!tags[t.type] || t.task || t.title) throw Error('Use Markdown for this content');
        const el = document.createElement(tags[t.type]);
        if (propheticSpeech && t.type === 'em') el.className = t.raw.startsWith('*') ? 'source-prophetic-speech' : 'source-italic';
        if (['paragraph','heading','list_item','blockquote'].includes(t.type)) el.dir = 'auto';
        if (t.type === 'link') { const href = safeLink(t.href); if (!href) throw Error('Unsafe link'); el.setAttribute('href', href); }
        if (t.type === 'list' && t.ordered && t.start !== 1) el.start = t.start;
        if (t.type === 'codespan') el.textContent = t.text;
        else if (t.type !== 'br') append(t.items || t.tokens || [], el);
        if((t.type==='paragraph' || t.type==='list_item' && !el.querySelector('p,ul,ol,blockquote')) && el.querySelector('br')) {
          // Give each authored line its own bidi paragraph without adding blank
          // lines to the stored Markdown. Clone inline ancestors across breaks.
          const lines=[],breaks=[...el.querySelectorAll('br')];
          const range=document.createRange();range.setStart(el,0);
          for(const br of breaks) {
            range.setEndBefore(br);const line=document.createElement('span');
            line.className='notebook-rich-line';line.dir='auto';line.append(range.cloneContents());lines.push(line);
            range.setStartAfter(br);
          }
          range.setEnd(el,el.childNodes.length);
          const line=document.createElement('span');line.className='notebook-rich-line';line.dir='auto';line.append(range.cloneContents());lines.push(line);
          el.replaceChildren(...lines);
        }
        parent.append(el);
      }
    }
    try {
      const split=window.CommunityParallelText?.separator;
      if(!split && markdown.includes('||'))return null;
      parser=new window.marked.Marked({breaks:true});
      parser.use({extensions:[
        {name:'notebookWiki',level:'inline',start(src){return src.indexOf('[[');},tokenizer(src){
          const m=/^\[\[([^\[\]|\r\n]+)(?:\|([^\[\]\r\n]+))?\]\]/.exec(src);
          if(m && m[1].trim() && (m[2]===undefined || m[2].trim()))return {type:'notebookWiki',raw:m[0],target:m[1].trim(),label:(m[2] || m[1]).trim()};
        }},
        ...[['subscript','~'],['superscript','^']].map(([name,marker])=>({name,level:'inline',start(src){return src.indexOf(marker);},tokenizer(src){
          if(src[0]!==marker || src[1]===marker)return;
          let text='',at=1;
          for(;at<src.length;at++){
            const char=src[at];if(char===marker){if(text && src[at+1]!==marker)return {type:name,raw:src.slice(0,at+1),text};return;}
            if(char==='\\' && at+1<src.length && !/[\r\n]/.test(src[at+1])){
              const next=src[++at],code=next.charCodeAt(0);
              text+=(code===32 || code>=33 && code<=47 || code>=58 && code<=64 || code>=91 && code<=96 || code>=123 && code<=126)?next:'\\'+next;continue;
            }
            if(/\s/.test(char))return;text+=char;
          }
        }})),
        {name:'footnoteDefinition',level:'block',start(src){return /^ {0,3}\[\^[^\]\s]+\]:/m.exec(src)?.index;},tokenizer(src){
          const match=/^ {0,3}\[\^([^\]\s]+)\]:[ \t]*([^\n]*)(?:\n|$)/.exec(src);if(!match)return;
          let raw=match[0],text=match[2],rest=src.slice(raw.length),part;
          while((part=/^(?:[ \t]*\n)*(?: {4}|\t)[^\n]*(?:\n|$)/.exec(rest))){raw+=part[0];text+='\n'+part[0].replace(/^(?: {4}|\t)/gm,'').replace(/\n$/,'');rest=rest.slice(part[0].length);}
          if(/\[\^[^\]]+\]/.test(text))throw Error('Nested footnotes use Markdown');
          return {type:'footnoteDefinition',raw,label:match[1],text};
        }},
        {name:'footnoteReference',level:'inline',start(src){return src.indexOf('[^');},tokenizer(src){const match=/^\[\^([^\]\s]+)\]/.exec(src);if(match)return {type:'footnoteReference',raw:match[0],label:match[1]};}},
        {name:'subtext',level:'block',start(src){return /^-# /m.exec(src)?.index;},tokenizer(src){const match=/^-# ([^\n]*)(?:\n|$)/.exec(src);if(match)return {type:'subtext',raw:match[0],tokens:this.lexer.inlineTokens(match[1])};}},
        {name:'highlight',level:'inline',start(src){return src.indexOf('==');},tokenizer(src){const match=/^==(?=\S)([^\n]+?\S|\S)==/.exec(src);if(match)return {type:'highlight',raw:match[0],tokens:this.lexer.inlineTokens(match[1])};}},
        {name:'center',level:'block',start(src){const match=/^<center>[ \t]*\n/im.exec(src);return match?.index;},tokenizer(src){const match=/^<center>[ \t]*\n([\s\S]*?)\n<\/center>[ \t]*(?:\n|$)/i.exec(src);if(match && !/<\/?center>/i.test(match[1]))return {type:'center',raw:match[0],text:match[1]};}}
      ]});
      if(split)parser.use({extensions:[{name:'parallel',level:'block',
        start(src){let offset=0;for(const line of src.split('\n')){if(split(line)>=0)return offset;offset+=line.length+1;}},
        tokenizer(src){const line=src.split('\n')[0],at=split(line);if(at<0 || /^ {4}|^\t/.test(line))return;
          return {type:'parallel',raw:line+(src[line.length]==='\n'?'\n':''),left:line.slice(0,at),right:line.slice(at+2)};}
      }]});
      append(parser.lexer(markdown),root);
      for(const marker of root.querySelectorAll('[data-footnote-ref]'))if(!definitions.has(marker.dataset.footnoteRef)){
        const content=document.createElement('p');content.textContent='Footnote text';const holder=document.createElement('div');holder.append(content);definitions.set(marker.dataset.footnoteRef,footnoteRow(marker.dataset.footnoteRef,holder));
      }
      root.append(...definitions.values());reconcileFootnotes(root);styleContent(root);
      [...root.querySelectorAll('[data-callout-kind]')].reverse().forEach(quote=>{quote.dataset.calloutContent=serialize(quote);});
      root.querySelectorAll('[data-footnote]').forEach(row=>{if(row.dataset.footnoteRaw!==undefined)row.dataset.footnoteHtml=row.querySelector('.community-footnote-body').innerHTML;});
      return root;
    } catch (_) { return null; }
  }
  function serialize(root) {
    const preserved = [];
    const rawPrefix = 'NOTEBOOKRAW' + Math.random().toString(36).slice(2) + 'BLOCK';
    const referenced=new Set(Array.from(root.querySelectorAll('[data-footnote-ref]'),el=>el.dataset.footnoteRef));
    function contents(parent) {
      let result='';
      for(const child of parent.childNodes) {
        if(child.nodeType===1 && /^(P|DIV|H[1-6]|HR|BLOCKQUOTE|CENTER|UL|OL)$/.test(child.tagName) && result && !result.endsWith('\n'))result+='\n\n';
        result+=read(child);
      }
      return result;
    }
    function read(el) {
      if (el.nodeType === 3) return escape(el.nodeValue.replace(/\u00a0/g, ' '));
      if (el.nodeType !== 1) return '';
      if(el.dataset.wikiTarget !== undefined)return el.textContent===el.dataset.wikiLabel && el.dataset.wikiRaw ? el.dataset.wikiRaw : '[['+el.dataset.wikiTarget+'|'+el.textContent+']]';
      if(el.dataset.notebookRaw !== undefined){const index=preserved.push(el.dataset.notebookRaw.trimEnd())-1;return rawPrefix+index+'END\n\n';}
      if(el.classList.contains('community-footnote-label'))return '';
      if(el.dataset.footnoteRef)return '[^'+el.dataset.footnoteRef+']';
      if(el.dataset.footnote){
        const body=el.querySelector('.community-footnote-body') || el,text=contents(body).trim();
        if(!referenced.has(el.dataset.footnote))return 'Orphaned footnote ('+escape(el.dataset.footnote)+'): '+text+'\n\n';
        if(body.innerHTML===el.dataset.footnoteHtml)return el.dataset.footnoteRaw+'\n\n';
        return '[^'+el.dataset.footnote+']: '+text.replace(/\n/g,'\n    ')+'\n\n';
      }
      if(el.classList.contains('community-edit-parallel')) {
        if(el.innerHTML===el.dataset.parallelHtml)return el.dataset.parallelSource+'\n\n';
        return Array.from(el.children,cell=>contents(cell).trim().replace(/\n+/g,' ')).join(' || ')+'\n\n';
      }
      if(el.classList.contains('notebook-rich-line'))return contents(el)+(el.nextSibling?'\n':'');
      if(el.classList.contains('notebook-subtext'))return '-# '+contents(el).trim()+'\n\n';
      const text = () => contents(el);
      const wrap = marker => { const s=text();return s.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_,a,b,c)=>a+(b?marker+b+marker:'')+c); };
      switch (el.tagName) {
        case 'SUB': case 'SUP': {const marker=el.tagName==='SUB'?'~':'^';return marker+escape(el.textContent).replace(/ /g,'\\ ')+marker;}
        case 'HR': return '***\n\n';
        case 'BR': return '\n';
        case 'CENTER': return '<center>\n'+text().trim()+'\n</center>\n\n';
        case 'MARK': return wrap('==');
        case 'B': case 'STRONG': return wrap('**');
        case 'I': case 'EM': return wrap(el.classList.contains('source-prophetic-speech') ? '*' : root.dataset.propheticSpeech !== undefined ? '_' : '*');
        case 'S': case 'STRIKE': case 'DEL': return wrap('~~');
        case 'CODE': {const t=el.textContent; const ticks='`'.repeat(Math.max(0,...(t.match(/`+/g)||[]).map(s=>s.length))+1);return ticks+' '+t+' '+ticks;}
        case 'A': {const href=safeLink(el.getAttribute('href'));return href?'['+text()+']('+href.replace(/\(/g,'%28').replace(/\)/g,'%29')+')':text();}
        case 'P': case 'DIV': return text()+'\n\n';
        case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': return '#'.repeat(Number(el.tagName[1]))+' '+text()+'\n\n';
        case 'BLOCKQUOTE': {
          if(el.dataset.calloutKind){
            const current=text().replace(/\n{3,}/g,'\n\n').trim();
            if(current===el.dataset.calloutContent)return el.dataset.calloutRaw+'\n\n';
            const title=el.querySelector(':scope > .markdown-callout-title');
            const heading=title?read(title).trim():'';
            const body=Array.from(el.childNodes).filter(node=>node!==title).map(read).join('').trim();
            const label=heading===el.dataset.calloutDefaultTitle?'':heading;
            return ('[!'+el.dataset.calloutKind+']'+(label?' '+label:'')+(body?'\n\n'+body:'')).split('\n').map(line=>'> '+line).join('\n')+'\n\n';
          }
          if(!Array.from(el.children).some(child=>child.dataset.quoteLine==='true'))return text().trim().split('\n').map(line=>'> '+line).join('\n')+'\n\n';
          let quote='';
          for(const child of el.childNodes){
            const part=read(child).trimEnd();if(!part && child.nodeType!==1)continue;
            if(quote)quote+=child.dataset?.quoteLine==='true'?'\n':'\n\n';
            quote+=part;
          }
          return quote.trim().split('\n').map(line=>'> '+line).join('\n')+'\n\n';
        }
        case 'UL': case 'OL': return Array.from(el.children).map((li,i)=>{const prefix=el.tagName==='OL'?(Number(el.getAttribute('start'))||1)+i+'. ':'- ';return prefix+contents(li).trim().replace(/\n/g,'\n'+' '.repeat(prefix.length));}).join('\n')+'\n\n';
        default: return text();
      }
    }
    let result = contents(root).replace(/\n{3,}/g,'\n\n').trim();
    preserved.forEach((raw,index) => { result=result.replace(rawPrefix+index+'END', () => raw); });
    return result;
  }
  const previewRenderers=new WeakMap(),previewCaches=new WeakMap();
  function renderAdvanced(markdown, source) {
    const root = document.createElement('div');
    const cache=previewCaches.get(source) || new Map();previewCaches.set(source,cache);
    // Reference definitions and footnotes depend on the full document context.
    const dependent = /\[\^|^ {0,3}\[[^\]]+\]:/m.test(markdown);
    const tokens = dependent ? [{raw: markdown}] : window.marked.lexer(markdown);
    for (const token of tokens) {
      if (token.type === 'space') continue;
      const formatted = !dependent && render(token.raw, source.dataset.propheticSpeech !== undefined);
      if (formatted) { root.append(...formatted.childNodes); continue; }
      const block = document.createElement('div');
      block.dataset.notebookRaw = token.raw;
      block.contentEditable = 'false';
      block.title = 'Use Markdown to edit this advanced formatting';
      block.className = 'notebook-advanced-block';
      const controls=document.createElement('div');controls.className='community-advanced-tools';
      const label=document.createElement('span');label.textContent='Markdown block';
      const code=document.createElement('button');code.type='button';code.textContent='Edit code';code.setAttribute('aria-label','Edit block Markdown');
      controls.append(label,code);
      const preview=document.createElement('div');preview.className='notebook-advanced-content';preview.textContent='Loading formatted content…';
      block.append(controls,preview);
      code.addEventListener('click',()=>{
        const surface=instances.get(source);if(!surface || source.disabled || source.readOnly)return;
        let cursor=0,start=0;
        for(const current of surface.rich.querySelectorAll('[data-notebook-raw]')){const found=source.value.indexOf(current.dataset.notebookRaw.trimEnd(),cursor);if(found>=0){start=found;cursor=found+current.dataset.notebookRaw.trimEnd().length;}if(current===block)break;}
        surface.toSource();source.focus();source.setSelectionRange(start,cursor);
      });
      root.append(block);
      if (previewRenderers.has(source)) {
        let result = cache.get(token.raw);
        if (!result) {
          result = Promise.resolve().then(() => previewRenderers.get(source)(token.raw));
          if (cache.size >= 100) cache.clear();
          cache.set(token.raw, result);
        }
        result.then(html => { preview.innerHTML = html; }).catch(() => {
          cache.delete(token.raw);
          preview.textContent = 'Preview unavailable. Use Edit code to edit this block.';
        });
      } else preview.textContent='Use Edit code to edit this block.';
    }
    return root;
  }
  function caretOffset(editor, surface, event, sourceCaret, point) {
    const locatingPreview = sourceCaret !== undefined;
    let lastRange = null;
    const renderedRange = (part, index) => {
      const range = document.createRange();
      range.setStart(part, index); range.collapse(true);
      return range;
    };
    let node, offset = 0;
    if (!locatingPreview) {
      const caret = event ? document.caretPositionFromPoint?.(event.clientX, event.clientY) : null;
      const range = caret ? null : event ? document.caretRangeFromPoint?.(event.clientX, event.clientY) : window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null;
      node = point?.node || caret?.offsetNode || range?.startContainer;
      offset = point ? point.offset : caret ? caret.offset : range?.startOffset;
      if (!node || node.nodeType !== Node.TEXT_NODE || !surface.contains(node)) {
        if (!event) return 0;
        // Paragraph margins, blank space and some browser hit tests return an
        // element (or nothing). Resolve the nearest rendered text, never note end.
        const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
        const probe = document.createRange();
        let part, nearest = null, best = Infinity;
        const distance = rect => {
          const dy = Math.max(rect.top - event.clientY, event.clientY - rect.bottom, 0);
          const dx = Math.max(rect.left - event.clientX, event.clientX - rect.right, 0);
          return dy * 100000 + dx;
        };
        while ((part = walker.nextNode())) {
          if (!part.nodeValue.trim() || part.parentElement.closest('button, .footnote-backref, .community-footnote-label, .community-advanced-tools, [data-footnote-ref]')) continue;
          probe.selectNodeContents(part);
          for (const rect of probe.getClientRects()) {
            if (!rect.height) continue;
            const score = distance(rect);
            if (score < best) { best = score; nearest = part; }
          }
        }
        if (!nearest) return 0;
        node = nearest; offset = 0; best = Infinity;
        // Collapsed ranges give visual caret positions even in right-to-left text.
        for (let i = 0; i <= node.length; i++) {
          if (i && i < node.length && /[\uDC00-\uDFFF]/.test(node.nodeValue[i])) continue;
          probe.setStart(node, i); probe.collapse(true);
          for (const rect of probe.getClientRects()) {
            if (!rect.height) continue;
            const score = distance(rect);
            if (score < best) { best = score; offset = i; }
          }
        }
      }
    }

    // Decode source escapes/entities while retaining UTF-16 textarea offsets.
    const source = editor.value, positions = [], decoder = document.createElement('textarea');
    let text = '';
    for (let i = 0; i < source.length;) {
      const start = i;
      let value = source[i++];
      if (value.charCodeAt(0) === 92 && /[!-/:-@[-`{-~]/.test(source[i] || '')) {
        value = source[i++];
      } else if (value === '&') {
        const entity = source.slice(start).match(/^&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/);
        if (entity) { decoder.innerHTML = entity[0]; value = decoder.value; i = start + entity[0].length; }
      }
      for (let j = 0; j < value.length; j++) positions.push(start);
      text += value;
    }
    positions.push(source.length);
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    let cursor = 0, part;
    while ((part = walker.nextNode())) {
      if (part.parentElement.closest('button, .footnote-backref, .community-footnote-label, .community-advanced-tools, [data-footnote-ref]')) continue;
      // Arabic underline adds a display-only Unicode combining overline.
      const overlined = part.parentElement.closest('[data-notebook-overline]');
      const value = overlined ? part.nodeValue.replace(/\u0305/g, '') : part.nodeValue;
      const sourceOffset = overlined ? part.nodeValue.slice(0, offset).replace(/\u0305/g, '').length : offset;
      if (!value.trim()) {
        if (part === node) return positions[cursor];
        continue;
      }
      // Walking in document order disambiguates repeated words and paragraphs.
      let start = text.indexOf(value, cursor);
      if (start < 0) {
        // Inline code and Markdown hard breaks can normalize whitespace.
        let matched = cursor;
        for (let j = 0; j < value.length; j++) {
          const next = text.indexOf(value[j], matched);
          if (next < 0) break;
          if (part === node && j === sourceOffset) return positions[next];
          matched = next + 1;
        }
        if (part === node) return positions[matched];
        continue;
      }
      if (locatingPreview) {
        if (sourceCaret <= positions[start + value.length]) {
          let index = 0;
          while (index < value.length && positions[start + index] < sourceCaret) index++;
          if (overlined) {
            let visible = 0, rendered = 0;
            while (rendered < part.length && visible < index) {
              if (part.nodeValue[rendered++] !== '\u0305') visible++;
            }
            index = rendered;
          }
          return renderedRange(part, index);
        }
        lastRange = renderedRange(part, part.length);
      }
      if (part === node) return positions[start + Math.min(sourceOffset, value.length)];
      cursor = start + value.length;
    }
    // Whitespace outside text nodes uses the nearest preceding source position.
    return locatingPreview ? lastRange : positions[cursor];
  }
  function install(source) {
    if (!source || instances.has(source) || !window.marked) return;
    const isArticle=source.dataset.articleEditor!==undefined;
    const renderContent = text => render(text, source.dataset.propheticSpeech !== undefined) || (previewRenderers.has(source) ? renderAdvanced(text,source) : null);
    function toFormatted() { mode='rich'; hydrate(); }
    const shell=document.createElement('div'); shell.className='community-short-editor'+(source.dataset.articleEditor!==undefined?' community-article-surface':'');
    const tools=document.createElement('div'); tools.className='community-short-tools';
    const toggle=document.createElement('button');toggle.type='button';toggle.className='community-editor-mode';toggle.textContent='Markdown';toggle.setAttribute('aria-label','Switch to Markdown editing');
    const format=document.createElement('div');format.className='community-selection-tools';format.hidden=true;format.setAttribute('role','group');format.setAttribute('aria-label','Text formatting');
    const rich=document.createElement('div');rich.className='community-rich-input notebook-markdown';rich.contentEditable='true';rich.setAttribute('role','textbox');rich.setAttribute('aria-multiline','true');rich.setAttribute('aria-label',source.getAttribute('aria-label') || source.labels?.[0]?.textContent || source.placeholder || 'Post text');rich.dataset.placeholder=source.placeholder;rich.dir='auto';
    if (source.dataset.propheticSpeech !== undefined) rich.dataset.propheticSpeech = '';
    const hint=document.createElement('span');hint.className='community-editor-hint';hint.textContent=isArticle?'Use the formatting bar above':'Select text to format';
    const removeColumns=document.createElement('button');removeColumns.type='button';removeColumns.className='community-remove-columns community-editor-mode';removeColumns.textContent='×';removeColumns.title='Remove column layout';removeColumns.setAttribute('aria-label','Remove column layout');removeColumns.hidden=true;
    const undoColumns=document.createElement('button');undoColumns.type='button';undoColumns.className='community-remove-columns community-editor-mode';undoColumns.textContent='Undo column layout change';undoColumns.hidden=true;
    let activeRow=null, removedColumns=null, formatHistory=[], formatHistoryIndex=0;
    tools.append(hint,toggle);shell.append(tools,format,removeColumns,undoColumns,rich);source.before(shell);shell.insertBefore(source,rich);
    const footerMode=isArticle && source.form?.querySelector('[data-article-editor-mode]');
    if(footerMode){footerMode.append(toggle);tools.hidden=true;}
    let mode='rich', syncing=false, savedRange=null, composing=false, lastHTML='', lastMarkdown='';
    const required=source.required;source.required=false;
    function sync() {
      if(mode!=='rich'||syncing||rich.innerHTML===lastHTML)return;
      styleContent(rich,true);
      reconcileFootnotes(rich);
      const markdown=serialize(rich);
      if(markdown===lastMarkdown){lastHTML=rich.innerHTML;return;}
      lastMarkdown=markdown;
      lastHTML=rich.innerHTML;syncing=true;source.value=markdown;
      source.dispatchEvent(new Event('input',{bubbles:true}));syncing=false;
      rich.setAttribute('aria-invalid',String(source.maxLength>0 && markdown.length>source.maxLength));
    }
    function sizeSource() {
      if(mode!=='source' || source.hidden || source.id==='notebook-editor')return;
      if(isArticle){
        // Measuring the live textarea at zero height collapses the page and
        // clamps its scroll position before the full article height is restored.
        const measure=document.createElement('textarea'),style=getComputedStyle(source);
        for(const property of Array.from(style))measure.style.setProperty(property,style.getPropertyValue(property));
        Object.assign(measure.style,{position:'fixed',top:'0',left:'0',visibility:'hidden',pointerEvents:'none',height:'0',minHeight:'0',maxHeight:'none',overflow:'hidden'});
        measure.tabIndex=-1;measure.setAttribute('aria-hidden','true');measure.value=source.value;
        document.body.append(measure);
        const border=style.boxSizing==='border-box'?(parseFloat(style.borderTopWidth)||0)+(parseFloat(style.borderBottomWidth)||0):-(parseFloat(style.paddingTop)||0)-(parseFloat(style.paddingBottom)||0);
        const height=measure.scrollHeight+border;measure.remove();
        source.style.height=height+'px';
        return;
      }
      source.style.height='0px';source.style.height=source.scrollHeight+'px';
    }
    function hydrate() {
      if(syncing)return;
      removedColumns=null;formatHistory=[];formatHistoryIndex=0;undoColumns.hidden=true;removeColumns.hidden=true;activeRow=null;
      const rendered=renderContent(source.value);
      if(mode==='rich' && !rendered) mode='source';
      if(rendered && mode==='rich'){rich.replaceChildren(...rendered.childNodes);lastHTML=rich.innerHTML;lastMarkdown=serialize(rich);}
      source.hidden=mode==='rich';rich.hidden=mode!=='rich';
      source.required=mode==='source' && required;
      toggle.textContent=mode==='rich'?'Edit Markdown':'Formatted editing';
      toggle.setAttribute('aria-label',mode==='rich'?'Switch to Markdown editing':'Switch to formatted editing');
      hint.textContent=mode==='rich'?(isArticle?'Use the formatting bar above':'Select text to format'):rendered?'Markdown editing':'Advanced formatting · Markdown editing';
      rich.contentEditable=String(!source.disabled && !source.readOnly);rich.setAttribute('aria-disabled',String(source.disabled));toggle.disabled=source.disabled || mode==='source' && !rendered;
      if(mode!=='rich'){format.hidden=true;removeColumns.hidden=true;activeRow=null;sizeSource();}
    }
    if(window.ResizeObserver)new ResizeObserver(sizeSource).observe(shell);
    const value=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');
    Object.defineProperty(source,'value',{configurable:true,get(){return value.get.call(this);},set(v){const previous=value.get.call(this);value.set.call(this,v);if(value.get.call(this)!==previous)hydrate();}});
    const focus=source.focus.bind(source);source.focus=options=>mode==='rich'?rich.focus(options):focus(options);
    function toSource() {
      if(mode!=='rich')return;
      const clone=rich.cloneNode(true), range=savedRange;
      // Async block previews may change HTML without changing authored text.
      // Switching modes must not normalize that untouched Markdown.
      const textPoint=(node,offset)=>{
        if(node.nodeType===3)return {node,offset};
        const next=node.childNodes[offset],previous=node.childNodes[offset-1];
        const edge=(child,last)=>{if(!child)return null;if(child.nodeType===3)return {node:child,offset:last?child.length:0};const walk=document.createTreeWalker(child,NodeFilter.SHOW_TEXT);let text,found;while((text=walk.nextNode())){found=text;if(!last)break;}return found?{node:found,offset:last?found.length:0}:null;};
        return edge(next,false)||edge(previous,true);
      };
      const firstPoint=range && textPoint(range.startContainer,range.startOffset),lastPoint=range && textPoint(range.endContainer,range.endOffset);
      if(firstPoint && lastPoint && serialize(rich)===lastMarkdown){
        const start=caretOffset(source,rich,null,undefined,firstPoint);
        const end=caretOffset(source,rich,null,undefined,lastPoint);
        const selected=window.getSelection(),backward=selected?.focusNode===range.startContainer && selected.focusOffset===range.startOffset;
        mode='source';hydrate();source.setSelectionRange(start,end,backward?'backward':'forward');return;
      }

      const begin='COMMUNITYSTART'+Date.now()+'MARK',end='COMMUNITYEND'+Date.now()+'MARK';
      function map(node) {const path=[];while(node!==rich){path.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes,node));node=node.parentNode;}let target=clone;for(const i of path)target=target.childNodes[i];return target;}
      const protectedPoint=node=>(node.nodeType===1?node:node.parentElement)?.closest('[data-notebook-raw]');
      if(range && !protectedPoint(range.startContainer) && !protectedPoint(range.endContainer) && rich.contains(range.startContainer) && rich.contains(range.endContainer)) {
        const r=document.createRange();r.setStart(map(range.startContainer),range.startOffset);r.setEnd(map(range.endContainer),range.endOffset);
        const tail=r.cloneRange();tail.collapse(false);tail.insertNode(document.createTextNode(end));
        r.collapse(true);r.insertNode(document.createTextNode(begin));
        const marked=serialize(clone),start=marked.indexOf(begin),finish=marked.indexOf(end)-begin.length;
        mode='source';source.value=marked.replace(begin,'').replace(end,'');hydrate();source.setSelectionRange(Math.max(0,start),Math.max(0,finish));
      } else {sync();mode='source';hydrate();source.setSelectionRange(source.value.length,source.value.length);}
    }
    toggle.addEventListener('click',()=>{
      if(mode==='rich'){toSource();source.focus();return;}
      if(!renderContent(source.value))return;
      const start=source.selectionStart,end=source.selectionEnd,direction=source.selectionDirection;
      const active=direction==='backward'?start:end;
      const rect=window.NotebookWiki?.caretRect(source,active);
      const viewportY=rect ? rect.top-source.getBoundingClientRect().top : source.clientHeight/2;
      mode='rich';hydrate();source.focus({preventScroll:true});
      const first=caretOffset(source,rich,null,start),last=caretOffset(source,rich,null,end);
      if(first && last){
        const anchor=direction==='backward'?last:first,focus=direction==='backward'?first:last;
        window.getSelection().setBaseAndExtent(anchor.startContainer,anchor.startOffset,focus.startContainer,focus.startOffset);
        const rect=focus.getBoundingClientRect(),delta=rect.top-rich.getBoundingClientRect().top-Math.max(0,Math.min(viewportY,rich.clientHeight-rect.height));
        if(getComputedStyle(rich).overflowY==='visible')window.scrollBy(0,delta);else rich.scrollTop+=delta;
        selection();
      }

    });
    function insertParallel() {
      if(source.disabled || source.readOnly || !window.CommunityParallelText)return;
      const wasRich=mode==='rich';
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
      if(wasRich && renderContent(source.value)) {
        const rowIndex=markdown.slice(0,edit.start).split('\n').filter(line=>window.CommunityParallelText.separator(line)>=0).length;
        mode='rich';hydrate();rich.focus();
        const cell=rich.querySelectorAll('.community-edit-parallel')[rowIndex]?.lastElementChild;
        if(cell){const range=document.createRange();range.selectNodeContents(cell);const selected=window.getSelection();selected.removeAllRanges();selected.addRange(range);selection();}
      }
    }
    const commands=[['Bold','type-bold','bold'],['Italic','type-italic','italic'],['Underline','type-underline','underline'],['Strikethrough','type-strikethrough','strikeThrough'],['Subscript',null,'subscript'],['Superscript',null,'superscript'],['Highlight','brush','highlight'],['Align center','text-center','center'],['Numbered list','list-ol','insertOrderedList'],['Bullet list','list-ul','insertUnorderedList'],['Quotation','quote','formatBlock','blockquote'],['Insert link','link-45deg','link'],['Clear formatting','eraser','removeFormat'],['Parallel English and Arabic text',null,'parallel']];
    const textStyle=document.createElement('select');textStyle.setAttribute('aria-label','Text style');
    for(const [value,label] of [['0','Normal'],...Array.from({length:6},(_,i)=>[String(i+1),'Heading '+(i+1)]),['subtext','Subtext']]){const option=document.createElement('option');option.value=value;option.textContent=label;textStyle.append(option);}
    format.append(textStyle);textStyle.addEventListener('change',()=>formatAction('style',textStyle.value));
    function updateTextStyle() {
      let value='0';
      if(mode==='source') {
        if(document.activeElement!==source)return;
        const caret=source.selectionDirection==='backward'?source.selectionStart:source.selectionEnd;
        const before=source.value.slice(0,caret),start=before.lastIndexOf('\n')+1;
        const line=source.value.slice(start).split('\n')[0];
        let fence=null;
        for(const previous of source.value.slice(0,start).split('\n')){
          const match=/^\s{0,3}(`{3,}|~{3,})/.exec(previous);
          if(match){if(!fence)fence=match[1];else if(match[1][0]===fence[0] && match[1].length>=fence.length)fence=null;}
        }
        if(!fence){
          const content=line.replace(/^\s{0,3}(?:>\s*)+/,'').replace(/^\s{0,3}(?:[-+*]|\d+[.)])\s+/,'');
          const heading=/^ {0,3}(#{1,6})(?:\s|$)/.exec(content);
          if(heading)value=String(heading[1].length);
          else if(/^ {0,3}-#(?:\s|$)/.test(content))value='subtext';
          else {
            const next=source.value.slice(start+line.length+1).split('\n')[0];
            if(content.trim() && /^ {0,3}(?:=+|-+)\s*$/.test(next))value=next.trim()[0]==='='?'1':'2';
          }
        }
      } else {
        const selected=window.getSelection(),node=selected?.focusNode;
        if(!node || !rich.contains(node))return;
        const element=node.nodeType===1?node:node.parentElement;
        const block=element.closest('p,div,li,h1,h2,h3,h4,h5,h6');
        if(block?.classList.contains('notebook-subtext'))value='subtext';
        else if(/^H[1-6]$/.test(block?.tagName || ''))value=block.tagName[1];
      }
      textStyle.value=value;
      if(isArticle){const articleStyle=document.getElementById(source.id==='notebook-editor'?'notebook-format-style':'community-format-style');if(articleStyle)articleStyle.value=value;}
    }
    function selection() {
      if(typeof document==='undefined')return;
      updateTextStyle();
      if(source.disabled || source.readOnly){format.hidden=true;removeColumns.hidden=true;return;}
      if(mode==='source') {
        format.hidden=isArticle || !(source.ownerDocument.activeElement===source || format.contains(source.ownerDocument.activeElement)) || source.selectionStart===source.selectionEnd;
        return;
      }
      if(format.contains(document.activeElement)){format.hidden=isArticle;return;}
      const s=window.getSelection();
      if(!s)return;
      if(document.activeElement!==removeColumns){
        activeRow=mode==='rich' && rich.contains(s.anchorNode)?parallelCell(s.anchorNode)?.parentElement:null;
        removeColumns.hidden=!activeRow;
      }
      if(s.rangeCount && rich.contains(s.anchorNode) && rich.contains(s.focusNode)) {
        savedRange=s.getRangeAt(0).cloneRange();format.hidden=isArticle || s.isCollapsed;
      } else if(!format.contains(source.ownerDocument.activeElement)) format.hidden=true;
      positionColumnControl();
    }
    for(const event of ['select','keyup','mouseup','focus'])source.addEventListener(event,selection);
    source.addEventListener('blur',()=>window.setTimeout(selection,0));
    // Read the completed native word selection, after the double-click's
    // default action (some browsers update it after mouseup).
    for(const surface of [rich,source])surface.addEventListener('dblclick',()=>{
      window.setTimeout(selection,0);
    });
    function positionColumnControl(){
      if(!activeRow || removeColumns.hidden)return;
      const row=activeRow.getBoundingClientRect(),box=shell.getBoundingClientRect(),surface=rich.getBoundingClientRect();
      removeColumns.style.top=(row.bottom-box.top)+'px';removeColumns.style.left=Math.max(0,row.left-box.left+row.width/2-removeColumns.offsetWidth/2)+'px';
      removeColumns.style.visibility=row.bottom>surface.bottom || row.bottom<surface.top?'hidden':'';
    }
    rich.addEventListener('scroll',positionColumnControl,{passive:true});
    if(window.ResizeObserver)new ResizeObserver(positionColumnControl).observe(rich);
    removeColumns.addEventListener('mousedown',e=>e.preventDefault());
    removeColumns.addEventListener('click',()=>{
      const row=activeRow;if(mode!=='rich' || !row || !rich.contains(row) || source.disabled || source.readOnly)return;
      const marker=document.createComment('column layout');
      const lines=Array.from(row.children,cell=>{const line=document.createElement('div');line.dir='auto';line.append(...Array.from(cell.childNodes,node=>node.cloneNode(true)));return line;});
      row.before(marker,...lines);row.remove();
      removedColumns={row,marker,lines};activeRow=null;removeColumns.hidden=true;undoColumns.hidden=false;
      rich.focus();const range=document.createRange();range.setStartAfter(marker);range.collapse(true);
      const selected=window.getSelection();selected.removeAllRanges();selected.addRange(range);
      sync();selection();removedColumns.after=rich.innerHTML;
    });
    function undoColumnRemoval(){
      if(!removedColumns || !rich.contains(removedColumns.marker) || source.disabled || source.readOnly)return false;
      const {row,marker,lines}=removedColumns;
      // Retain any edits made to the unwrapped text when restoring its layout.
      if(lines.some(line=>!rich.contains(line)))return false;
      lines.forEach((line,index)=>{row.children[index].replaceChildren(...Array.from(line.childNodes,node=>node.cloneNode(true)));line.remove();});
      marker.replaceWith(row);removedColumns=null;undoColumns.hidden=true;
      rich.focus();const range=document.createRange();range.selectNodeContents(row.firstElementChild);range.collapse(true);
      const selected=window.getSelection();selected.removeAllRanges();selected.addRange(range);sync();selection();return true;
    }
    undoColumns.addEventListener('mousedown',e=>e.preventDefault());
    undoColumns.addEventListener('click',undoColumnRemoval);
    format.addEventListener('mousedown',e=>{if(e.target.closest('button'))e.preventDefault();});
    const secondaryCommands=new Set(['underline','strikeThrough','subscript','superscript']);
    const more=document.createElement('button');more.type='button';more.className='community-format-more';
    more.textContent='…';more.title='More formatting';more.setAttribute('aria-label','More formatting');more.setAttribute('aria-expanded','false');
    const secondary=document.createElement('div');secondary.className='community-format-secondary';secondary.hidden=true;
    secondary.id='community-format-secondary-'+(++formattingMenuId);secondary.setAttribute('role','group');secondary.setAttribute('aria-label','Additional formatting');more.setAttribute('aria-controls',secondary.id);
    function closeMore(){secondary.hidden=true;more.setAttribute('aria-expanded','false');}
    more.addEventListener('click',()=>{
      secondary.hidden=!secondary.hidden;more.setAttribute('aria-expanded',String(!secondary.hidden));
      if(!secondary.hidden){const anchor=more.getBoundingClientRect(),menu=secondary.getBoundingClientRect();
        secondary.style.left=Math.max(8,Math.min(anchor.right-menu.width,window.innerWidth-menu.width-8))+'px';
        secondary.style.top=(anchor.bottom+menu.height+8<=window.innerHeight?anchor.bottom+4:Math.max(8,anchor.top-menu.height-4))+'px';
      }
    });
    format.addEventListener('keydown',event=>{if(event.key==='Escape' && !secondary.hidden){event.preventDefault();event.stopPropagation();closeMore();more.focus();}});
    document.addEventListener('pointerdown',event=>{if(!format.contains(event.target))closeMore();});
    document.addEventListener('scroll',event=>{if(!format.contains(event.target))closeMore();},true);
    window.addEventListener('resize',closeMore);
    new MutationObserver(()=>{if(format.hidden)closeMore();}).observe(format,{attributes:true,attributeFilter:['hidden']});

    for(const [label,glyph,command,arg] of commands){
      const b=document.createElement('button');b.type='button';b.title=label;b.setAttribute('aria-label',label);
      b.dataset.command=command;
      const i=document.createElement(glyph?'i':'span');i.className=glyph?'bi bi-'+glyph:'community-parallel-icon';if(!glyph){if(command==='subscript'||command==='superscript'){i.className='community-script-icon';i.append('x');const number=document.createElement(command==='subscript'?'sub':'sup');number.textContent='2';i.append(number);}else i.textContent='a|ج';i.dir='ltr';}i.setAttribute('aria-hidden','true');b.append(i);
      if(secondaryCommands.has(command)){b.append(document.createTextNode(label));secondary.append(b);}else format.append(b);
      b.addEventListener('click',()=>{const restoreFocus=secondary.contains(document.activeElement);closeMore();formatAction(command,arg);if(restoreFocus)source.focus({preventScroll:true});});
    }
    format.append(more,secondary);
    function parallelCell(node) {return (node?.nodeType===1?node:node?.parentElement)?.closest('.community-edit-parallel-cell');}
    function crossesColumns() {
      const s=window.getSelection();if(!s || s.isCollapsed)return false;
      const first=parallelCell(s.anchorNode),last=parallelCell(s.focusNode);
      return first!==last && !!(first || last);
    }
    rich.addEventListener('beforeinput',event=>{if(crossesColumns()){event.preventDefault();hint.textContent='Edit one column at a time';}});
    function formatAction(command,arg) {
      // Source-backed formatting rebuilds the DOM. Keep it in the same
      // structural undo history instead of losing the operation on hydration.
      const wasRich=mode==='rich',before=rich.innerHTML,beforeMarkdown=source.value,beforePoint=formatCaret();
      const history=formatHistory,index=formatHistoryIndex;
      const preserveViewport=wasRich && ['style','center','formatBlock'].includes(command);
      const scrollParents=[];if(preserveViewport)for(let parent=shell.parentElement;parent;parent=parent.parentElement)scrollParents.push([parent,parent.scrollTop,parent.scrollLeft]);
      const scrollX=window.scrollX,scrollY=window.scrollY,minHeight=shell.style.minHeight;
      if(preserveViewport)shell.style.minHeight=shell.getBoundingClientRect().height+'px';
      let result;
      try { result=applyFormatAction(command,arg); }
      finally {
        shell.style.minHeight=minHeight;
        for(const [parent,top,left] of scrollParents){parent.scrollTop=top;parent.scrollLeft=left;}
        if(preserveViewport)window.scrollTo(scrollX,scrollY);
      }
      if(wasRich && mode==='rich' && history!==formatHistory && before!==rich.innerHTML){
        formatHistory=history;formatHistoryIndex=index;recordFormatChange(before,beforePoint,beforeMarkdown);
      }
      return result;
    }
    function applyFormatAction(command,arg) {
      if(source.disabled || source.readOnly)return true;
      if(mode==='rich' && crossesColumns()){hint.textContent='Select text within one column to format';return true;}
      if(command==='wiki') {
        const range=savedRange;
        const node=range?.startContainer;
        const existing=(node?.nodeType===1?node:node?.parentElement)?.closest('a[data-wiki-target]');
        const selected=mode==='rich'?(range?.toString() || ''):source.value.slice(source.selectionStart,source.selectionEnd);
        const target=window.prompt('Internal note title',existing?.dataset.wikiTarget || selected);
        if(target===null || !target.trim())return true;
        const label=window.prompt('Display text',existing?.textContent || selected || target.trim());
        if(label===null || !label.trim())return true;
        if(/[\[\]\r\n|]/.test(target) || /[\[\]\r\n]/.test(label)){hint.textContent='Use a note title and display text without brackets or newlines.';return true;}
        const title=target.trim(),text=label.trim();
        if(mode==='source') {
          source.setRangeText('[['+title+(text===title?'':'|'+text)+']]',source.selectionStart,source.selectionEnd,'end');
          source.dispatchEvent(new Event('input',{bubbles:true}));return true;
        }
        rich.focus();
        const active=window.getSelection();
        if(range && rich.contains(range.startContainer)){active.removeAllRanges();active.addRange(range);}
        const link=document.createElement('a');link.dataset.wikiTarget=title;link.href='/notebook?note='+encodeURIComponent(title);link.title=title;link.textContent=text;
        if(existing){const replace=document.createRange();replace.selectNode(existing);active.removeAllRanges();active.addRange(replace);}
        document.execCommand('insertHTML',false,link.outerHTML);sync();selection();return true;
      }
      if(command==='footnote' && mode==='rich'){
        const anchor=savedRange?.startContainer;
        if((anchor?.nodeType===1?anchor:anchor?.parentElement)?.closest('.community-footnote-body')){
          hint.textContent='Place the footnote reference in the article text';return true;
        }
      }
      if(command==='divider' || command==='footnote'){
        const wasRich=mode==='rich';if(wasRich)toSource();
        const value=source.value,end=source.selectionEnd;
        let label;
        if(command==='footnote'){
          const used=new Set(Array.from(value.matchAll(/\[\^([^\]\s]+)\]/g),m=>m[1]));let number=1;while(used.has(String(number)))number++;label=String(number);
          source.value=value.slice(0,end)+'[^'+label+']'+value.slice(end)+'\n\n[^'+label+']: Footnote text';
          const start=source.value.lastIndexOf('Footnote text');source.setSelectionRange(start,start+13);
        }else{
          const next=value.indexOf('\n',end),at=next<0?value.length:next;
          source.setRangeText('\n\n***\n\n',at,at,'end');
        }
        source.dispatchEvent(new Event('input',{bubbles:true}));
        if(wasRich && renderContent(source.value)){
          mode='rich';hydrate();rich.focus();
          if(label){const body=Array.from(rich.querySelectorAll('[data-footnote]')).find(row=>row.dataset.footnote===label)?.querySelector('.community-footnote-body');if(body){const range=document.createRange();range.selectNodeContents(body);const selected=window.getSelection();selected.removeAllRanges();selected.addRange(range);body.scrollIntoView?.({block:'nearest'});selection();}}
        }return true;
      }
      if(command==='parallel'){insertParallel();selection();return true;}
      if(command==='style') {
        if(!/^(?:[0-6]|subtext)$/.test(String(arg)))return false;
        if(mode==='rich' && arg!=='subtext' && ![...rich.querySelectorAll('.notebook-subtext')].some(node=>savedRange?.intersectsNode(node)) && document.execCommand){
          rich.focus();if(savedRange){const selected=window.getSelection();selected.removeAllRanges();selected.addRange(savedRange);}
          if(document.execCommand('formatBlock',false,String(arg)==='0'?'p':'h'+arg)){sync();selection();return true;}
        }
        const wasRich=mode==='rich';if(wasRich)toSource();
        const selectionStart=source.selectionStart,selectionEnd=source.selectionEnd;
        const value=source.value,start=source.selectionStart?value.lastIndexOf('\n',source.selectionStart-1)+1:0;
        const last=source.selectionEnd>source.selectionStart && value[source.selectionEnd-1]==='\n'?source.selectionEnd-1:source.selectionEnd;
        const next=value.indexOf('\n',last),end=next<0?value.length:next;
        const prefix=arg==='subtext'?'-# ':String(arg)==='0'?'':'#'.repeat(Number(arg))+' ';
        const text=value.slice(start,end).split('\n').map(line=>line.replace(/^([ \t]*(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+)?(?:\[\^[^\]\s]+\]:[ \t]*)?)(.*)$/,(_,indent,body)=>indent+prefix+body.replace(/^(?:#{1,6}|-#)\s+/,''))).join('\n');
        const delta=text.length-(end-start),firstDelta=text.split('\n')[0].length-value.slice(start,end).split('\n')[0].length;
        source.setRangeText(text,start,end,'select');source.dispatchEvent(new Event('input',{bubbles:true}));
        if(wasRich && renderContent(source.value)){restoreFormattedSelection(selectionStart+firstDelta,selectionEnd+delta);}return true;
      }
      if(command==='center') {
        if(mode==='rich'){
          const node=savedRange?.startContainer,element=node?.nodeType===1?node:node?.parentElement;
          const centered=element?.closest('center');
          if(centered && centered.contains(savedRange.endContainer)){
            const before=rich.innerHTML,beforeMarkdown=source.value,beforePoint=formatCaret(),range=savedRange.cloneRange();
            centered.replaceWith(...centered.childNodes);
            rich.focus();window.getSelection().removeAllRanges();window.getSelection().addRange(range);
            sync();selection();recordFormatChange(before,beforePoint,beforeMarkdown);return true;
          }
        }
        const wasRich=mode==='rich';if(wasRich)toSource();
        const selectionStart=source.selectionStart,selectionEnd=source.selectionEnd;
        const value=source.value,start=source.selectionStart?value.lastIndexOf('\n',source.selectionStart-1)+1:0;
        const last=source.selectionEnd>source.selectionStart && value[source.selectionEnd-1]==='\n'?source.selectionEnd-1:source.selectionEnd;
        const next=value.indexOf('\n',last),end=next<0?value.length:next;
        const centeredSource=/^([ \t]*)<center>\n([\s\S]*)\n\1<\/center>$/.exec(value.slice(start,end));
        if(centeredSource){
          source.setRangeText(centeredSource[2],start,end,'select');source.dispatchEvent(new Event('input',{bubbles:true}));
          if(wasRich && renderContent(source.value))restoreFormattedSelection(start,start+centeredSource[2].length);
          return true;
        }
        const lines=value.slice(start,end).split('\n');
        const lead=/^([ \t]*)(\[\^[^\]\s]+\]:[ \t]*)?/.exec(lines[0]);
        const indent=lead[2]?lead[1]+'    ':lead[1];
        lines[0]=lines[0].slice(lead[0].length);
        for(let i=1;i<lines.length;i++)if(indent && lines[i].startsWith(indent))lines[i]=lines[i].slice(indent.length);
        source.setRangeText(lead[0]+'<center>\n'+lines.map(line=>indent+line).join('\n')+'\n'+indent+'</center>',start,end,'select');
        source.dispatchEvent(new Event('input',{bubbles:true}));
        if(wasRich && renderContent(source.value)){restoreFormattedSelection(selectionStart+9+indent.length,selectionEnd+9+indent.length);}return true;
      }
      const richQuote=command==='formatBlock' && arg==='blockquote' && mode==='rich';
      if((command==='underline' || richQuote) && mode==='rich')toSource();
      if(mode!=='rich') {
        const start=source.selectionStart,end=source.selectionEnd,value=source.value;
        const selected=value.slice(start,end),markers={bold:'**',italic:'*',strikeThrough:'~~',code:'`',underline:'__',highlight:'=='};
        let text;
        if(markers[command] && window.NotebookShortcuts){
          const marker=markers[command];
          const edit=start===end?{start,end,text:marker+'text'+marker,selectStart:start+marker.length,selectEnd:start+marker.length+4}:window.NotebookShortcuts.replacement(value,start,end,marker);
          if(!edit)return true;
          source.setRangeText(edit.text,edit.start,edit.end,'end');source.setSelectionRange(edit.selectStart,edit.selectEnd);
          source.dispatchEvent(new Event('input',{bubbles:true}));selection();return true;
        }
        if(command==='subscript'||command==='superscript'){const marker=command==='subscript'?'~':'^';text=marker+escape(selected).replace(/ /g,'\\ ')+marker;}
        else if(markers[command])text=markers[command]+selected+markers[command];
        else if(command==='removeFormat')text=selected.replace(/(\*\*|__|~~|==)(.+?)\1/g,'$2').replace(/([*`_])([^\n]+?)\1/g,'$2');
        else if(command==='link') {
          const url=window.prompt('Link URL','https://');if(!url)return true;
          if(!safeLink(url)){hint.textContent='Use an http, https, or mailto link.';return true;}
          text='['+selected+']('+url.replace(/\(/g,'%28').replace(/\)/g,'%29')+')';
        } else if(['insertUnorderedList','insertOrderedList','formatBlock'].includes(command)) {
          const begin=start?value.lastIndexOf('\n',start-1)+1:0;
          const last=end>start && value[end-1]==='\n'?end-1:end,stop=value.indexOf('\n',last);
          const finish=stop<0?value.length:stop,lines=value.slice(begin,finish).split('\n');
          const pattern=command==='formatBlock'?/^(\s*)> ?/:command==='insertOrderedList'?/^(\s*)\d+[.)] +/:/^(\s*)[-+*] +/;
          const already=lines.every(line=>!line.trim() || pattern.test(line));
          text=lines.map((line,i)=>{
            if(!line.trim())return line;
            if(already)return line.replace(pattern,'$1');
            const match=/^([ \t]*)(.*)$/.exec(line);
            const body=command==='formatBlock'?match[2]:match[2].replace(/^(?:[-+*]|\d+[.)]) +/,'');
            return match[1]+(command==='formatBlock'?'> ':command==='insertOrderedList'?(i+1)+'. ':'- ')+body;
          }).join('\n');
          const firstDelta=text.split('\n')[0].length-lines[0].length,delta=text.length-(finish-begin);
          source.setRangeText(text,begin,finish,'select');source.dispatchEvent(new Event('input',{bubbles:true}));
          if(richQuote)restoreFormattedSelection(start+firstDelta,end+delta);else selection();
          return true;
        } else return false;
        source.setRangeText(text,start,end,'select');source.dispatchEvent(new Event('input',{bubbles:true}));selection();return true;
      }
      if(!savedRange){rich.focus();selection();}
      if(!savedRange)return true;
      const s=window.getSelection();rich.focus();s.removeAllRanges();s.addRange(savedRange);
      if(command==='removeFormat' && !s.isCollapsed){
        const before=rich.innerHTML,beforeMarkdown=source.value,beforePoint=formatCaret(),range=s.getRangeAt(0).cloneRange();
        const blocks=[...rich.querySelectorAll('.notebook-rich-line,p,li,h1,h2,h3,h4,h5,h6')].filter(block=>!block.querySelector('.notebook-rich-line,p,li,h1,h2,h3,h4,h5,h6') && !block.closest('[data-notebook-raw]') && range.intersectsNode(block));
        const markers=[];
        for(const block of blocks){
          const part=document.createRange();part.selectNodeContents(block);
          if(range.compareBoundaryPoints(Range.START_TO_START,part)>0)part.setStart(range.startContainer,range.startOffset);
          if(range.compareBoundaryPoints(Range.END_TO_END,part)<0)part.setEnd(range.endContainer,range.endOffset);
          if(part.collapsed)continue;
          const left=document.createRange(),right=document.createRange();
          left.selectNodeContents(block);left.setEnd(part.startContainer,part.startOffset);
          right.selectNodeContents(block);right.setStart(part.endContainer,part.endOffset);
          const leftContent=left.cloneContents(),rightContent=right.cloneContents(),middle=document.createElement('span');
          middle.append(part.cloneContents());
          middle.querySelectorAll('strong,b,em,i,u,s,strike,del,mark,code,sub,sup:not([data-footnote-ref])').forEach(node=>node.replaceWith(...node.childNodes));
          middle.querySelectorAll('[style]').forEach(node=>node.removeAttribute('style'));
          block.replaceChildren(leftContent,middle,rightContent);markers.push(middle);
        }
        if(markers.length){
          const selected=document.createRange();selected.setStartBefore(markers[0]);selected.setEndAfter(markers[markers.length-1]);
          // Keep ordinary spans as selection boundaries; serialization ignores them.
          s.removeAllRanges();s.addRange(selected);sync();selection();recordFormatChange(before,beforePoint,beforeMarkdown);return true;
        }
      }
      if(command==='highlight'){
        const range=s.getRangeAt(0),node=range.startContainer;
        const existing=(node.nodeType===1?node:node.parentElement).closest('mark');
        if(existing && existing.contains(range.endContainer)){
          const before=rich.innerHTML,beforeMarkdown=source.value,beforePoint=formatCaret();
          const left=existing.cloneNode(false),right=existing.cloneNode(false),edge=document.createRange();
          edge.selectNodeContents(existing);edge.setEnd(range.startContainer,range.startOffset);left.append(edge.cloneContents());
          edge.selectNodeContents(existing);edge.setStart(range.endContainer,range.endOffset);right.append(edge.cloneContents());
          const middle=document.createElement('span');middle.append(range.cloneContents());
          if(range.collapsed){middle.append(...existing.childNodes);existing.replaceWith(middle);}
          else existing.replaceWith(...(left.textContent?[left]:[]),middle,...(right.textContent?[right]:[]));
          const first=middle.firstChild,last=middle.lastChild;middle.replaceWith(...middle.childNodes);
          if(first && last){const selected=document.createRange();selected.setStartBefore(first);selected.setEndAfter(last);s.removeAllRanges();s.addRange(selected);}
          sync();selection();recordFormatChange(before,beforePoint,beforeMarkdown);return true;
        }else{
          const mark=document.createElement('mark');mark.dataset.editorInserted='true';mark.append(range.cloneContents());
          document.execCommand('insertHTML',false,mark.outerHTML);
          const inserted=rich.querySelector('mark[data-editor-inserted]');
          if(inserted){inserted.removeAttribute('data-editor-inserted');const selected=document.createRange();selected.selectNodeContents(inserted);s.removeAllRanges();s.addRange(selected);}
        }
      }else if(command==='code'){
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
      if(crossesColumns()){hint.textContent='Paste into one column at a time';return;}
      if(Array.from(event.clipboardData?.items || []).some(item=>item.kind==='file' && item.type.startsWith('image/'))) {
        toSource();source.dispatchEvent(new ClipboardEvent('paste',{clipboardData:event.clipboardData,bubbles:true,cancelable:true}));return;
      }
      const text=event.clipboardData.getData('text/plain');
      document.execCommand('insertText',false,parallelCell(window.getSelection()?.anchorNode)?text.replace(/\r?\n/g,' '):text);sync();
    });
    rich.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});
    rich.addEventListener('drop',event=>{event.preventDefault();if(event.dataTransfer?.files.length){toSource();source.dispatchEvent(new DragEvent('drop',{dataTransfer:event.dataTransfer,bubbles:true,cancelable:true}));}});
    function recordFormatChange(before,beforePoint,beforeMarkdown){
      formatHistory.splice(formatHistoryIndex);
      formatHistory.push({before,after:rich.innerHTML,beforeMarkdown,afterMarkdown:source.value,beforePoint,afterPoint:formatCaret()});
      if(formatHistory.length>100)formatHistory.shift();
      formatHistoryIndex=formatHistory.length;
    }
    function restoreFormattedSelection(start,end){
      mode='rich';hydrate();rich.focus({preventScroll:true});
      const first=caretOffset(source,rich,null,start),last=caretOffset(source,rich,null,end);
      if(first && last)window.getSelection().setBaseAndExtent(first.startContainer,first.startOffset,last.startContainer,last.startOffset);
      selection();
    }
    function formatCaret(){
      const selected=window.getSelection(),path=[];let node=selected?.anchorNode;
      if(!node || !rich.contains(node))return null;
      const offset=selected.anchorOffset;
      while(node!==rich){path.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes,node));node=node.parentNode;}
      return {path,offset};
    }
    function restoreFormatCaret(point){
      if(!point)return;let node=rich;for(const index of point.path){node=node.childNodes[index];if(!node)return;}
      window.getSelection().setBaseAndExtent(node,point.offset,node,point.offset);
    }
    function unwrapFormattingLine(selected){
      if(!selected?.isCollapsed || !rich.contains(selected.anchorNode))return false;
      const element=selected.anchorNode.nodeType===1?selected.anchorNode:selected.anchorNode.parentElement;
      if(element.closest('[data-notebook-raw]'))return false;
      const line=element.closest('.notebook-rich-line,p,li,h1,h2,h3,h4,h5,h6');
      if(!line || !line.firstChild)return false;
      const prefix=document.createRange();prefix.selectNodeContents(line);prefix.setEnd(selected.anchorNode,selected.anchorOffset);
      if(prefix.toString().length)return false;
      // Remove the nearest block style, splitting its container at authored
      // line boundaries. Other lines and inline emphasis remain untouched.
      const block=line.closest('h1,h2,h3,h4,h5,h6,.notebook-subtext,blockquote,center,li');
      const inlineSelector='strong,b,em,i,u,s,strike,del,mark,code,sub,sup:not([data-footnote-ref])';
      if(!block && !line.querySelector(inlineSelector))return false;
      const container=block?.tagName==='LI'?block.parentElement:block || (line.classList.contains('notebook-rich-line')?line.parentElement:line);
      if(!rich.contains(container))return false;
      const before=container.cloneNode(false),after=container.cloneNode(false),range=document.createRange();
      range.selectNodeContents(container);range.setEndBefore(line===container?container.firstChild:line);before.append(range.cloneContents());
      range.selectNodeContents(container);
      if(line===container)range.collapse(false);else range.setStartAfter(line);
      after.append(range.cloneContents());
      const paragraph=document.createElement('p');paragraph.dir=line.dir || 'auto';paragraph.dataset.unwrappedFormattingLine='true';
      paragraph.append(...Array.from(line.childNodes,node=>node.cloneNode(true)));
      // Nested lists stay structural siblings, never children of a paragraph.
      const trailing=[];
      if(line.tagName==='LI')for(const child of [...paragraph.children])if(/^(UL|OL)$/.test(child.tagName)){trailing.push(child);child.remove();}
      if(!block)paragraph.querySelectorAll(inlineSelector).forEach(node=>{
        if(!node.hasAttribute('data-footnote-ref'))node.replaceWith(...node.childNodes);
      });
      if(container.tagName==='OL'){
        const item=line.closest('li'),index=[...container.children].indexOf(item);
        after.start=(Number(container.getAttribute('start'))||1)+index+(line===item?1:0);
      }
      const replacement=document.createElement('div');
      const hasContent=el=>el.textContent.trim() || el.querySelector('img,hr,table,pre');
      if(hasContent(before))replacement.append(before);
      replacement.append(paragraph,...trailing);
      if(hasContent(after))replacement.append(after);
      const beforeHTML=rich.innerHTML,beforeMarkdown=source.value,beforePoint=formatCaret();
      container.replaceWith(...replacement.childNodes);
      const inserted=rich.querySelector('[data-unwrapped-formatting-line]');
      if(inserted){inserted.removeAttribute('data-unwrapped-formatting-line');const caret=document.createRange();caret.selectNodeContents(inserted);caret.collapse(true);selected.removeAllRanges();selected.addRange(caret);}
      sync();selection();recordFormatChange(beforeHTML,beforePoint,beforeMarkdown);return true;
    }
    rich.addEventListener('keydown',event=>{
      if(source.disabled || source.readOnly)return;
      if((event.metaKey||event.ctrlKey) && event.key.toLowerCase()==='z'){
        const change=formatHistory[event.shiftKey?formatHistoryIndex:formatHistoryIndex-1];
        if(change && rich.innerHTML===(event.shiftKey?change.before:change.after)){
          event.preventDefault();rich.innerHTML=event.shiftKey?change.after:change.before;
          restoreFormatCaret(event.shiftKey?change.afterPoint:change.beforePoint);
          formatHistoryIndex+=event.shiftKey?1:-1;sync();
          const markdown=event.shiftKey?change.afterMarkdown:change.beforeMarkdown;
          if(source.value!==markdown){syncing=true;source.value=markdown;source.dispatchEvent(new Event('input',{bubbles:true}));syncing=false;}
          selection();return;
        }
      }
      if((event.metaKey||event.ctrlKey) && !event.shiftKey && event.key.toLowerCase()==='z' && removedColumns?.after===rich.innerHTML && undoColumnRemoval()){event.preventDefault();return;}
      const selected=window.getSelection(),cell=parallelCell(selected?.anchorNode);
      if(event.key==='Delete' && !event.isComposing && !event.altKey && !event.metaKey && !event.ctrlKey && unwrapFormattingLine(selected)){event.preventDefault();return;}
      if(cell && selected.isCollapsed && ['Backspace','Delete'].includes(event.key)) {
        const edge=selected.getRangeAt(0).cloneRange();edge.selectNodeContents(cell);
        if(event.key==='Backspace')edge.setEnd(selected.anchorNode,selected.anchorOffset);else edge.setStart(selected.anchorNode,selected.anchorOffset);
        if(!edge.toString()){event.preventDefault();return;}
      }
      if(cell && !event.isComposing && ['Enter','Tab'].includes(event.key)) {
        event.preventDefault();const row=cell.parentElement;
        let target=event.shiftKey?cell.previousElementSibling:cell.nextElementSibling;
        if(!target){target=event.shiftKey?row.previousElementSibling:row.nextElementSibling;
          if(!target){target=document.createElement('p');target.append(document.createElement('br'));event.shiftKey?row.before(target):row.after(target);}}
        const range=document.createRange();range.selectNodeContents(target);range.collapse(true);selected.removeAllRanges();selected.addRange(range);sync();selection();return;
      }
      if(event.key==='Enter' && !event.isComposing) {
        const active=window.getSelection();
        let block=active.anchorNode?.nodeType===1?active.anchorNode:active.anchorNode?.parentElement;
        const quote=block?.closest('blockquote'),listItem=block?.closest('li');
        block=block?.closest('p,div,li,blockquote');
        if(active.isCollapsed && quote && rich.contains(quote) && !listItem) {
          // Use native editing transactions so Enter and quote exit participate
          // in browser undo. Keep the fallback for engines without these commands.
          event.preventDefault();
          const empty=!event.shiftKey && block && !block.textContent.trim();
          if(document.execCommand?.(empty?'outdent':'insertParagraph',false)) {
            const node=active.anchorNode?.nodeType===1?active.anchorNode:active.anchorNode?.parentElement;
            const next=node?.closest('p,div');
            if(!empty && next && quote.contains(next))next.dataset.quoteLine='true';
            sync();selection();return;
          }
          // Continue quote paragraphs normally; an empty paragraph exits the quote.
          if(!event.shiftKey && block && !block.textContent.trim()) {
            event.preventDefault();
            const next=document.createElement('p');next.dir='auto';next.append(document.createElement('br'));
            const tail=quote.cloneNode(false);
            if(block!==quote)while(block.nextSibling)tail.append(block.nextSibling);
            quote.after(next);if(tail.childNodes.length)next.after(tail);
            block.remove();if(!quote.textContent.trim())quote.remove();
            const caret=document.createRange();caret.selectNodeContents(next);caret.collapse(true);active.removeAllRanges();active.addRange(caret);sync();selection();return;
          }
          event.preventDefault();
          const anchor=active.anchorNode,offset=active.anchorOffset;
          if(block===quote){const paragraph=document.createElement('p');paragraph.dir='auto';paragraph.append(...quote.childNodes);quote.append(paragraph);block=paragraph;}
          const remainder=document.createRange();remainder.selectNodeContents(block);
          remainder.setStart(anchor===quote?block:anchor,offset);
          const next=document.createElement('p');next.dir='auto';next.dataset.quoteLine='true';next.append(remainder.extractContents());
          if(!next.textContent && !next.querySelector('br'))next.append(document.createElement('br'));
          if(!block.textContent && !block.querySelector('br'))block.append(document.createElement('br'));
          block.after(next);
          const caret=document.createRange();caret.selectNodeContents(next);caret.collapse(true);active.removeAllRanges();active.addRange(caret);sync();selection();return;
        }
        if(!event.shiftKey && active.isCollapsed && !listItem && !quote && block && rich.contains(block) && /^[ \t]*(?:quran:\d{1,3}:\d{1,3}(?:-\d{1,3})?|[a-z][a-z0-9_-]*:\d+[a-z]?)[ \t]*$/i.test(block.textContent)) {
          event.preventDefault();selection();toSource();source.focus();
          source.setRangeText('\n',source.selectionStart,source.selectionEnd,'end');
          source.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertParagraph',data:'\n'}));return;
        }
      }
      if((event.metaKey||event.ctrlKey) && !event.altKey && !event.isComposing){
        const key=/^[a-z]$/i.test(event.key)?event.key.toLowerCase():event.code.replace(/^Key/,'').toLowerCase();
        const command=event.shiftKey?{h:'highlight',x:'strikeThrough'}[key]:{b:'bold',i:'italic',u:'underline'}[key];
        if(command){event.preventDefault();selection();formatAction(command);}
      }
      if(event.key==='Escape'){closeMore();format.hidden=true;event.stopPropagation();}
    });
    source.addEventListener('keydown',event=>{
      if(mode!=='source' || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      const position=source.selectionDirection==='backward'?source.selectionStart:source.selectionEnd;
      const start=position?source.value.lastIndexOf('\n',position-1)+1:0,end=source.value.indexOf('\n',position);
      const probe=document.createElement('bdi');probe.dir='auto';probe.hidden=true;
      probe.textContent=source.value.slice(start,end<0?source.value.length:end);document.body.append(probe);
      source.dir=getComputedStyle(probe).direction;probe.remove();
    });
    source.addEventListener('keydown',event=>{
      if(mode!=='source' || event.defaultPrevented || source.disabled || source.readOnly || event.isComposing || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || event.key!=='Enter')return;
      const edit=window.NotebookShortcuts?.continueLine(source.value,source.selectionStart,source.selectionEnd);if(!edit)return;
      event.preventDefault();event.stopPropagation();
      source.setSelectionRange(edit.start,edit.end);
      if(!document.execCommand?.('insertText',false,edit.text))source.setRangeText(edit.text,edit.start,edit.end,'end');
      source.setSelectionRange(edit.selectStart,edit.selectEnd);
      source.dispatchEvent(new Event('input',{bubbles:true}));
    });
    // Full-bar surfaces install these with their toolbar/notebook adapter.
    // Contextual post editors use the same Markdown keyboard commands.
    if(!isArticle){
      const installShortcuts=()=>window.NotebookShortcuts?.install(source,()=>mode==='source',()=>{});
      if(window.NotebookShortcuts)installShortcuts();else document.addEventListener('DOMContentLoaded',installShortcuts,{once:true});
    }
    source.addEventListener('input',()=>{if(!syncing)hydrate();updateTextStyle();});
    source.form?.addEventListener('reset',()=>queueMicrotask(()=>{mode='rich';hydrate();}));
    source.form?.addEventListener('submit',event=>{sync();if(required&&!source.value.trim() || source.maxLength>0&&source.value.length>source.maxLength){event.preventDefault();event.stopImmediatePropagation();rich.setAttribute('aria-invalid','true');source.focus();}},true);
    new MutationObserver(hydrate).observe(source,{attributes:true,attributeFilter:['disabled','readonly']});
    // One document listener serves every mounted editor, including feed replies.
    instances.set(source,{selection,hydrate,toSource,toFormatted,shell,rich,sync,format:formatAction,get mode(){return mode;}});hydrate();
    return instances.get(source);
  }
  document.addEventListener('selectionchange',()=>document.querySelectorAll('[data-short-editor]').forEach(el=>instances.get(el)?.selection()));
  function scan(root=document){root.querySelectorAll('textarea[data-short-editor]').forEach(install);}
  window.CommunityShortEditor={install,render,serialize,styleContent,renderAdvanced,caretOffset,
    setPreviewRenderer(source,renderer){if(!source)return;previewRenderers.set(source,renderer);previewCaches.delete(source);if(instances.has(source) && !render(source.value))instances.get(source).toFormatted();},
    get:source=>instances.get(source)};
  scan();new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1){if(n.matches('textarea[data-short-editor]'))install(n);scan(n);}}).observe(document.body,{childList:true,subtree:true});
})();
