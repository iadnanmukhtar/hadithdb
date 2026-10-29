(() => {
  'use strict';
  const editor = document.getElementById('community-markdown');
  const toolbar = document.getElementById('community-format-toolbar');
  if (!editor || !toolbar) return;
  const style = document.getElementById('community-format-style');
  const markers = {bold:'**', italic:'*', underline:'__', strike:'~~', highlight:'=='};
  function apply(action) {
    if (editor.disabled || editor.readOnly) return;
    let start=editor.selectionStart, end=editor.selectionEnd, value=editor.value;
    let selected=value.slice(start,end), edit;
    if (markers[action]) {
      if (selected.trim()) edit=window.NotebookShortcuts.replacement(value,start,end,markers[action]);
      else {const marker=markers[action],text='text';edit={start,end,text:marker+text+marker,selectStart:start+marker.length,selectEnd:start+marker.length+text.length};}
    } else if (action==='link') {
      const text=selected || 'Link text',url='https://example.com';
      edit={start,end,text:'['+text+']('+url+')',selectStart:start+text.length+3,selectEnd:start+text.length+3+url.length};
    } else {
      start=value.lastIndexOf('\n',Math.max(0,start-1))+1;
      if(editor.selectionStart===0)start=0;
      const last=end>editor.selectionStart && value[end-1]==='\n'?end-1:end;
      const next=value.indexOf('\n',last);end=next<0?value.length:next;
      let lines=value.slice(start,end).split('\n');
      const strip=line=>line.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|(?:[-+*]|\d+[.)])\s+)/,'');
      const already=action==='quote'?lines.every(l=>!l.trim()||/^>\s?/.test(l)):action==='bullets'?lines.every(l=>!l.trim()||/^[-+*]\s/.test(l)):action==='numbered'?lines.every(l=>!l.trim()||/^\d+[.)]\s/.test(l)):false;
      lines=lines.map((line,i)=>{
        if(action==='style')return line.replace(/^#{1,6}\s+/,'').replace(/^/,style.value==='0'?'':'#'.repeat(Number(style.value))+' ');
        if(action==='clear')return strip(line).replace(/(\*\*|__|~~|==)(.+?)\1/g,'$2').replace(/([*`_])([^\n]+?)\1/g,'$2').replace(/!?\[([^\]]*)\]\([^)]+\)/g,'$1');
        return (already?'':action==='quote'?'> ':action==='bullets'?'- ':(i+1)+'. ')+strip(line);
      });
      const text=lines.join('\n');edit={start,end,text,selectStart:start,selectEnd:start+text.length};
    }
    if(!edit)return;
    const scroll=editor.scrollTop;
    editor.focus({preventScroll:true});editor.setSelectionRange(edit.start,edit.end);
    if(!document.execCommand('insertText',false,edit.text))editor.setRangeText(edit.text,edit.start,edit.end,'end');
    editor.setSelectionRange(edit.selectStart,edit.selectEnd);editor.scrollTop=scroll;
    editor.dispatchEvent(new Event('input',{bubbles:true}));
  }
  toolbar.addEventListener('mousedown',event=>{if(event.target.closest('[data-format]'))event.preventDefault();});
  toolbar.addEventListener('click',event=>{const button=event.target.closest('[data-format]');if(button)apply(button.dataset.format);});
  style.addEventListener('change',()=>apply('style'));
  window.NotebookShortcuts?.install(editor,()=>true,()=>{});
  function updateEditorCaretDirection() {
    const position = editor.selectionDirection === 'backward' ? editor.selectionStart : editor.selectionEnd;
    const start = position ? editor.value.lastIndexOf('\n', position - 1) + 1 : 0;
    const nextBreak = editor.value.indexOf('\n', position);
    const probe = document.createElement('bdi');
    probe.dir = 'auto'; probe.hidden = true;
    probe.textContent = editor.value.slice(start, nextBreak < 0 ? editor.value.length : nextBreak);
    document.body.appendChild(probe);
    editor.dir = getComputedStyle(probe).direction;
    probe.remove();
  }
  editor.addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) updateEditorCaretDirection();
  });
})();
