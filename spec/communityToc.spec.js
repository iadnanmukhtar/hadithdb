const Community=require('../lib/Community');
const {load}=require('cheerio');
test('article TOC links resolve to unique heading IDs including Arabic and duplicates',()=>{
 const $=load(Community.content('@[toc]\n\n# One\n\n## العربية\n\n## العربية\n\n# Two').html);
 const links=$('.community-toc a').toArray();expect(links).toHaveLength(4);
 const ids=links.map(a=>$(a).attr('href').slice(1));expect(new Set(ids).size).toBe(4);
 for(const id of ids)expect($('#'+id)).toHaveLength(1);expect($('.community-toc').text()).toContain('العربية');
});
test('literal code markers are preserved and empty TOCs are omitted',()=>{
 expect(Community.content('`@[toc]`').html).toContain('@[toc]');
 expect(Community.content('@[toc]\n\nNo headings').html).not.toContain('community-toc');
});
