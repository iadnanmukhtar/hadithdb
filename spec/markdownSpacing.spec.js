'use strict';
const md=require('../lib/ContentMarkdown').create();
test.each(['Text','# Heading','- List item','---','```\ncode\n```'])('two blank lines after %s add one spacer',block=>{
 expect(md.render(block+'\n\nNext')).not.toContain('markdown-spacer');
 expect(md.render(block+'\n\n\nNext').match(/data-markdown-spacer/g)).toHaveLength(1);
 expect(md.render(block+'\n\n\n\n\nNext').match(/data-markdown-spacer/g)).toHaveLength(1);
});
test('blank lines inside code and at document edges do not add spacers',()=>{
 expect(md.render('\n\n\n```\na\n\n\nb\n```\n\n\n')).not.toContain('markdown-spacer');
});
test('private spacers stay private',()=>{
 const text='%%\nFirst\n\n\nSecond\n%%';
 expect(md.render(text)).not.toContain('markdown-spacer');
 expect(md.render(text,{includeHidden:true})).toContain('markdown-spacer');
});
