'use strict';
// Standalone one-line or multiline %% comments keep private drafting text out of public renderers.
module.exports = function install(md) {
  md.block.ruler.before('fence','notebook_hidden',(state,start,end,silent)=>{
    const line=n=>state.src.slice(state.bMarks[n]+state.tShift[n],state.eMarks[n]);
    if(state.sCount[start]-state.blkIndent>=4)return false;
    const single=/^%%(.*?)%%[ \t]*$/.exec(line(start));
    if(single){
      if(silent)return true;
      const token=state.push('notebook_hidden','div',0);token.content=single[1].trim();
      token.block=true;token.map=[start,start+1];state.line=start+1;return true;
    }
    if(line(start).trim()!=='%%')return false;
    if(silent)return true;
    let close=start+1;while(close<end && line(close).trim()!=='%%')close++;
    const token=state.push('notebook_hidden','div',0);
    token.content=state.getLines(start+1,close,state.blkIndent,false).replace(/\n$/,'');
    token.block=true;token.map=[start,Math.min(close+1,end)];state.line=token.map[1];return true;
  },{alt:['paragraph','reference','blockquote','list']});
  md.renderer.rules.notebook_hidden=(tokens,index,options,env)=>env?.includeHidden
    ? `<div class="notebook-hidden-text" data-note-hidden="true" aria-label="Hidden from sharing and printing">${md.utils.escapeHtml(tokens[index].content)}</div>\n` : '';
};
