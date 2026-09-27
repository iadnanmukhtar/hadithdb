'use strict';
const fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(require.resolve('../public/static/js/script.js'),'utf8');
const start=source.indexOf('function normalizeReaderInfiniteUrl(url)');
const end=source.indexOf('\nfunction ',start+1);
const context={URL,window:{location:{origin:'https://hadithunlocked.com'}}};
vm.createContext(context);vm.runInContext(source.slice(start,end),context);
test('public, API and flushed URLs identify the same reader page',()=>{
 const normalize=context.normalizeReaderInfiniteUrl;
 for(const url of ['/shuab/0/1','/shuab/0/1?flush=1','/api/shuab/0/1?flush=1#H617604'])expect(normalize(url)).toBe('/shuab/0/1');
 expect(normalize('/shuab/0/1?page=2&flush=1')).toBe('/shuab/0/1?page=2');
});
test('rejects a response whose canonical page is already in the reader before appending content',()=>{
 const appendStart=source.indexOf('var appendReaderPage = function');
 const appendEnd=source.indexOf('var loadNext = function',appendStart);
 const scope={...context,mode:'hadith-section',loadedUrls:new Set(['/shuab/0/1']),exhausted:false,nextUrl:'/shuab/alias',
  registerHadithHeadingOutlines:jest.fn(),main:{removeAttr:jest.fn()},$:jest.fn(),
  DOMParser:class {parseFromString(){return {querySelectorAll:()=>[{getAttribute:name=>({'data-reader-infinite':'hadith-section','data-reader-current-url':'/api/shuab/0/1?flush=1'})[name]}]};}}
 };
 vm.createContext(scope);vm.runInContext(source.slice(appendStart,appendEnd),scope);
 expect(scope.appendReaderPage('<html/>','/shuab/alias')).toBeNull();
 expect(scope.$).not.toHaveBeenCalled();expect(scope.exhausted).toBe(true);expect(scope.nextUrl).toBe('');
});
