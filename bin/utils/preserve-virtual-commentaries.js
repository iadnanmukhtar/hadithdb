#!/usr/bin/env node
'use strict';
// DDL is not transactional. Removing the legacy delete trigger is safe because
// the existing FK removes only ownership links when a virtual entry is deleted.
require('dotenv').config();
const fs=require('fs'),assert=require('assert/strict');
const {preserveCommentaryOnDelete,legacyDeleteStatement}=require('../../lib/VirtualHadithSharh');
const db=require('mysql').createConnection(require('../initializeHadithAttributions').connectionSettings());
const query=require('util').promisify(db.query).bind(db);
(async()=>{try {
 const triggers=await query("SHOW TRIGGERS WHERE `Table`='hadiths_virtual'");
 const [schema]=await query('SHOW CREATE TABLE hdith_virtual_sharh_links');
 assert.match(schema['Create Table'],/FOREIGN KEY \(`virtual_id`\) REFERENCES `hadiths_virtual` \(`id`\) ON DELETE CASCADE/);
 const old=triggers.find(t=>t.Trigger==='virtual_sharh_before_delete');
 const pending=old?.Statement.replace(/\s+/g,' ').trim()===legacyDeleteStatement.replace(/\s+/g,' ').trim();
 const apply=process.argv.includes('--apply');
 if(apply){
  if(pending){fs.mkdirSync('temp/virtual-sharh',{recursive:true});fs.writeFileSync(`temp/virtual-sharh/delete-trigger-${Date.now()}.json`,JSON.stringify({triggers,schema},null,2),{mode:0o600});}
  await preserveCommentaryOnDelete(query,triggers);
 }
 console.log(JSON.stringify({apply,pending,commentaryPreserving:apply||!pending}));
}finally{db.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
