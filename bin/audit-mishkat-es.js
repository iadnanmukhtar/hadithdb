#!/usr/bin/env node
'use strict';
// Read-only evidence audit. This script has no database or network access.
const fs=require('fs'),assert=require('assert/strict');const broad=JSON.parse(fs.readFileSync('temp/mishkat-es-plan.json'));const baseline=JSON.parse(fs.readFileSync('temp/mishkat-es-baseline.json'));const Match=require('./utils/mishkat-match-evidence');
const approved=[],review=[];
for(const h of broad.resolved){const c=baseline.candidates.find(c=>c.id===h.targetId),e=Match.evidence(h,c);assert(e.coverage===1);let reason;
 if(h.number===5597&&h.ref==='tirmidhi:2432'&&e.narrator)reason='User-supplied example individually verified: same narrator, plural versus singular, source adds day of resurrection';
 else if(h.scope.mode==='cited-books'&&e.score===1&&e.words>=12)reason='All extracted segments occur exactly in the explicitly cited book; at least twelve words';
 else if(h.scope.mode==='cited-books'&&e.narrator&&e.score>=.9&&e.words>=8)reason='Explicit cited book, verified narrator, complete segment coverage and at least 0.90 wording score';
 if(reason){h.audit={approved:true,reason,score:e.score,words:e.words,narratorVerified:e.narrator};approved.push(h);}else{h.reason='Needs individual review of short, fuzzy, or fallback evidence';review.push(h);}}
const plan={...broad,resolved:approved,pending:[...broad.pending,...review],stats:{examined:broad.stats.examined,resolved:approved.length,pending:broad.pending.length+review.length,fromMisc:approved.filter(h=>h.from.startsWith('misc:')).length,fromSuyuti:approved.filter(h=>h.from.startsWith('suyuti:')).length}};
fs.writeFileSync('temp/mishkat-es-safe-plan.json',JSON.stringify(plan,null,2));fs.writeFileSync('temp/mishkat-es-safe-pending-review.json',JSON.stringify({stats:plan.stats,entries:plan.pending},null,2));console.log(plan.stats);console.log(approved.find(h=>h.number===5597).audit);
