'use strict';
// Arabic typography follows the text, not Markdown strikethrough markers.
module.exports = function blogArabic(md) {
  const arabic=/[\p{Script_Extensions=Arabic}\u200c\u200d]+(?:[ \t]+[\p{Script_Extensions=Arabic}\u200c\u200d]+)*/gu;
  md.renderer.rules.text=(tokens,index)=>md.utils.escapeHtml(tokens[index].content).replace(arabic,'<span class="blog-arabic" lang="ar">$&</span>');
  md.core.ruler.push('blog_direction',state=>{
    const stack=[];
    for(const token of state.tokens){
      if(token.nesting===1)stack.push(token);
      if(token.type==='inline'){
        const text=(token.children||[]).filter(t=>t.type==='text'||t.type==='code_inline').map(t=>t.content).join('');
        const first=text.match(/\p{L}/u)?.[0];
        if(first){const direction=/\p{Script_Extensions=Arabic}/u.test(first)?'rtl':'ltr';
          const block=[...stack].reverse().find(t=>['paragraph_open','heading_open'].includes(t.type));
          if(block)block.attrSet('dir',direction);
          const li=[...stack].reverse().find(t=>t.type==='list_item_open');if(li && !li.attrGet('dir'))li.attrSet('dir',direction);
        }
      }
      if(token.nesting===-1)stack.pop();
    }
  });
};
