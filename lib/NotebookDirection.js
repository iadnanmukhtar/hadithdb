'use strict';
const {load}=require('cheerio');
const direction=text=>/\p{Script_Extensions=Arabic}/u.test(text.match(/\p{L}/u)?.[0] || '')?'rtl':'ltr';
// Preserve inline formatting when a language change follows a Markdown/HTML break.
module.exports=function normalizeDirections(html){
 const $=load(html,null,false);
 $('blockquote').each((_,el)=>{
  const quote=$(el);
  if(!quote.children('p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,pre,table,div').length)quote.wrapInner('<p></p>');
 });
 function split(nodes){
  const result=[[]];
  for(const node of nodes){
   if(node.name==='br'){result.push([]);continue;}
   if(node.type==='tag' && $(node).find('br').length){
    const parts=split($(node).contents().toArray());
    parts.forEach((part,index)=>{if(index)result.push([]);const copy=$(node).clone().empty();if(index)copy.removeAttr('id');copy.append(part);result.at(-1).push(copy[0]);});
   }else result.at(-1).push($(node).clone()[0]);
  }
  return result;
 }
 $('p,h1,h2,h3,h4,h5,h6,li,td,th,dt,dd').each((_,el)=>{
  const block=$(el);
  // Lists and other block containers retain their children and nesting.
  if(block.find('p,ul,ol,blockquote,pre,table').length)return;
  if(!block.find('br').length){block.attr('dir',direction(block.text()));return;}
  const lines=split(block.contents().toArray()),groups=[];
  for(const line of lines){
   const text=line.map(n=>$(n).text()).join('');
   const dir=/\p{L}/u.test(text)?direction(text):(groups.at(-1)?.dir || 'ltr');
   if(groups.at(-1)?.dir===dir)groups.at(-1).nodes.push($('<br>')[0],...line);
   else groups.push({dir,nodes:line});
  }
  if(groups.length===1){block.attr('dir',groups[0].dir);return;}
  if(!groups.length)return;
  if(el.name==='p' && block.parent().is('blockquote')){
   block.replaceWith(groups.map((group,index)=>{const p=block.clone().empty().attr('dir',group.dir);if(index)p.removeAttr('id');return p.append(group.nodes)[0];}));
  }else{
   block.attr('dir',groups[0].dir).empty();
   for(const group of groups)block.append($('<span class="notebook-text-line"></span>').attr('dir',group.dir).append(group.nodes));
  }
 });
 // Callouts are one panel; their child blocks already have independent directions.
 // Ordinary quotes keep a separate edge for each consecutive language run.
 $($('blockquote').toArray().reverse()).each((_,el)=>{
  const quote=$(el),groups=[];
  if(quote.hasClass('markdown-callout')){quote.attr('dir',direction(quote.find('.markdown-callout-title').first().text() || quote.text()));return;}
  for(const node of quote.contents().toArray()){
   if(node.type==='text' && !node.data.trim())continue;
   const dir=direction($(node).text());
   if(groups.at(-1)?.dir===dir)groups.at(-1).nodes.push(node);
   else groups.push({dir,nodes:[node]});
  }
  if(!groups.length)return;
  quote.replaceWith(groups.map((group,index)=>{const copy=quote.clone().empty().attr('dir',group.dir);if(index)copy.removeAttr('id');return copy.append(group.nodes)[0];}));
 });
 return $.html();
};
