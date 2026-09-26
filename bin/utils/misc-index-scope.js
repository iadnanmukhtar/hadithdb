'use strict';
function isReferencedMisc(book,indexName){return book.alias==='misc'&&Number(book.hidden)===1&&Number(book.virtual)===0&&indexName==='hadiths';}
function miscReferenceFilter(book){return isReferencedMisc(book,'hadiths')?'AND EXISTS (SELECT 1 FROM hadiths_virtual hv JOIN books vb ON vb.id=hv.bookId WHERE hv.hadithId=v_hadiths.id AND vb.hidden=0 AND vb.`virtual`=1)':'';}
module.exports={isReferencedMisc,miscReferenceFilter};
