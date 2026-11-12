'use strict';
const md=require('../lib/ContentMarkdown').create({references:true});
test('private text is visible only in private rendering, with no parsed references or markup',()=>{
 const text='Public\n\n%%\nPrivate quran:baqarah:255\n<script>private</script>\n%%\n\nAfter';
 const env={includeHidden:true},privateHtml=md.render(text,env),publicHtml=md.render(text);
 expect(privateHtml).toContain('data-note-hidden');expect(privateHtml).not.toContain('<script>');expect(env.notebookExpandableReferences.size).toBe(0);
 expect(publicHtml).not.toMatch(/Private|private|baqarah|data-note-hidden/);expect(publicHtml).toContain('After');
});
test('an unclosed private block stays private and code examples stay literal',()=>{
 expect(md.render('Visible\n\n%%\nPrivate unfinished')).not.toContain('Private');
 expect(md.render('```\n%%\nExample\n%%\n```')).toContain('Example');
});
test('one-line private comments are grey privately and absent publicly, including between prose lines',()=>{
 const text='Before\n%% Secret quran:baqarah:255 <script>hidden</script> %%\nAfter';
 const env={includeHidden:true};const html=md.render(text,env);
 expect(html).toContain('data-note-hidden');expect(html).toContain('Secret');expect(html).not.toContain('<script>');
 expect(env.notebookExpandableReferences.size).toBe(0);
 const shared=md.render(text);expect(shared).not.toMatch(/Secret|hidden|baqarah/);expect(shared).toContain('Before');expect(shared).toContain('After');
 expect(md.render('`%% Literal %%`')).toContain('Literal');
 expect(md.render('```\n%% Literal %%\n```')).toContain('Literal');
});
test('private sections retain Markdown formatting without exposing any of it publicly',()=>{
 const text='%%\n## Private heading\n\n**Bold** and *italic* with [a link](https://example.com)\n\n- First\n- Second\n\n> Quotation\n%%';
 const html=md.render(text,{includeHidden:true});
 for(const tag of ['<h2','<strong>Bold</strong>','>italic</em>','<a href="https://example.com"','<ul>','<blockquote'])expect(html).toContain(tag);
 expect(md.render(text).trim()).toBe('');
 expect(md.render('%% **Inline bold** %%',{includeHidden:true})).toContain('<strong>Inline bold</strong>');
});
