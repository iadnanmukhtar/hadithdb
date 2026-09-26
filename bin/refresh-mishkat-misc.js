#!/usr/bin/env node
'use strict';
require('dotenv').config();process.env.BULK_INDEX_GZIP ||= '1';require('../lib/Globals');
const fs=require('fs'),Index=require('../lib/Index'),Utils=require('../lib/Utils');
(async()=>{const a=JSON.parse(fs.readFileSync('temp/mishkat-misc-applied.json'));const metadata=(await global.query(`SELECT description FROM books WHERE id=${Number(a.bookId)}`))[0];
const description=metadata.description.replace('This is a partial import of verified source aliases from the supplied Arabic EPUB, edited by Muhammad Nasir al-Din al-Albani, third edition (1985). Unresolved entries are retained separately for review; original numbering is preserved.', 'All 6,294 numbered entries from the supplied Arabic EPUB, edited by Muhammad Nasir al-Din al-Albani, third edition (1985), are represented. Of these, 4,452 have source-collection matches; 1,842 are preserved verbatim in Miscellaneous with Mishkat provenance and stated-source footnotes. Original numbering is preserved.');
if(description!==metadata.description)await global.query(require('mysql').format('UPDATE books SET description=? WHERE id=?',[description,a.bookId]));
const ids=a.inserted.map(r=>Number(r.id));if(ids.length!==1842||ids.some(x=>!Number.isInteger(x)))throw Error('Invalid imported ids');
// misc remains hidden in book listings; these explicitly imported records must resolve via Mishkat aliases.
await global.query(`CALL refresh_v_hadiths_virtual_snapshot(${Number(a.bookId)})`);
const rows=await global.query(`SELECT * FROM v_hadiths WHERE book_id=${Number(a.miscBookId)} AND id IN (${ids.join(',')}) ORDER BY ordinal`);if(rows.length!==ids.length)throw Error('Incomplete physical readback');await Index.updateBulk('hadiths',rows,true);await Index.refresh('hadiths');await Utils.flushBookDiskCache('misc',{strict:true});await Utils.flushBookDiskCache('mishkat',{strict:true});await Utils.flushCacheContaining('_books');await require('../lib/RuntimeRefresh').publish();console.log({indexedNewMiscRecords:rows.length});process.exit(0);})().catch(e=>{console.error(e.stack);process.exit(1);});
