'use strict';
module.exports = function install(md) {
  md.core.ruler.after('block','markdown_spacing',state=>{
    const lines=state.src.split('\n'),output=[];
    let seenBlock=false;
    for(const token of state.tokens){
      if(token.level===0 && token.map && token.nesting!==-1){
        let blank=0;
        for(let line=token.map[0]-1;line>=0 && /^[ \t]*$/.test(lines[line]);line--)blank++;
        if(seenBlock && blank>=2){const spacer=new state.Token('markdown_spacer','div',0);spacer.block=true;output.push(spacer);}
        seenBlock=true;
      }
      output.push(token);
    }
    state.tokens=output;
  });
  md.renderer.rules.markdown_spacer=()=>'<div class="markdown-spacer" data-markdown-spacer="true" aria-hidden="true"></div>\n';
};
