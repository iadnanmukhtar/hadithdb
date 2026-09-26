'use strict';
const crypto=require('crypto');
const reviewed=require('../../docs/imports/mishkat-editorial-reviewed.json');
const decisions=new Map(reviewed.map(r=>[r.number,r]));
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function separateReviewedEditorial(h){
 const d=decisions.get(h.number);if(!d)return h;
 const hash=sha(h.text);
 if(hash===d.afterTextSha256)return h;
 if(hash!==d.beforeTextSha256)throw Error(`Mishkat ${h.number}: editorial source changed; review the boundary again`);
 return {...h,text:d.text,footnote:[h.footnote,d.note].filter(Boolean).join('\n\n'),editorialCitationKeys:d.citationKeys||[],editorial:{sourceTextSha256:hash,bodyTextSha256:d.afterTextSha256,kinds:[...new Set(d.ranges.map(r=>r.kind))]}};
}
module.exports={separateReviewedEditorial,reviewed,sha};
