'use strict';
const crypto=require('crypto');
module.exports=function expandToc($,markdown){
 const markers=$('p').filter((_,el)=>$(el).children().length===0 && $(el).text().trim()==='@[toc]');
 if(!markers.length)return;
 const prefix='article-'+crypto.createHash('sha256').update(markdown).digest('hex').slice(0,10)+'-';
 const headings=$('h1,h2,h3,h4,h5,h6').toArray();
 headings.forEach((el,i)=>{if(!$(el).attr('id'))$(el).attr('id',prefix+(i+1));});
 markers.each((_,marker)=>{
  const nav=$('<nav class="community-toc" aria-label="Table of contents"></nav>');
  nav.append($('<strong></strong>').text('Contents'));const root=$('<ul></ul>');nav.append(root);
  const stack=[{level:0,list:root,last:null}];
  for(const el of headings){const level=Number(el.tagName.slice(1));
   while(stack.length>1 && level<stack.at(-1).level)stack.pop();
   let current=stack.at(-1);
   if(level>current.level && current.last){const list=$('<ul></ul>');current.last.append(list);current={level,list,last:null};stack.push(current);}
   else if(!current.last)current.level=level;
   const li=$('<li></li>');li.append($('<a></a>').attr('href','#'+$(el).attr('id')).text($(el).text()));current.list.append(li);current.last=li;
  }
  if(headings.length)$(marker).replaceWith(nav);else $(marker).remove();
 });
};
