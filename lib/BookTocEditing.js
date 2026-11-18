'use strict';
const { promisify } = require('util');
const crypto = require('crypto');
const createError = require('http-errors');
const fields = 'id,ordinal,tocId,h1,h2,h3,num,num0,numInChapter';
function id(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw createError(400, 'Invalid ID');
  return Number(value);
}
function contains(parent, child) {
  return Number(parent.h1) === Number(child.h1) && (parent.level < 2 || Number(parent.h2) === Number(child.h2)) && (parent.level < 3 || Number(parent.h3) === Number(child.h3));
}
function siblings(a, b) {
  return a.level === b.level && (a.level === 1 || Number(a.h1) === Number(b.h1)) && (a.level < 3 || Number(a.h2) === Number(b.h2));
}
function revision(state) { return crypto.createHash('sha256').update(JSON.stringify([state.headings,state.items])).digest('hex'); }
async function read(query, bookId, lock = false) {
  const [book] = await query('SELECT id,alias,type,virtual FROM books WHERE id=?' + (lock ? ' FOR UPDATE' : ''), [id(bookId)]);
  if (!book) throw createError(404, 'Book not found');
  if (book.alias === 'quran' || !['hadith','sirah'].includes(book.type)) throw createError(400, 'Use the Quran or commentary heading editor for this book');
  const headings = await query('SELECT id,ordinal,level,h1,h2,h3,title,title_en,lastmod,count,start,end,start0,end0 FROM toc WHERE bookId=? ORDER BY ordinal,id' + (lock ? ' FOR UPDATE' : ''), [book.id]);
  const table = Number(book.virtual) === 1 ? 'hadiths_virtual' : 'hadiths';
  const items = await query(`SELECT ${fields}${table === 'hadiths_virtual' ? ',hadithId,ref_num' : ''} FROM ${table} WHERE bookId=? ORDER BY ordinal,id${lock ? ' FOR UPDATE' : ''}`, [book.id]);
  const state = { book, headings, items };
  state.revision = revision(state);
  return state;
}
async function list(bookId) {
  // A single connection/transaction supplies a coherent revision token.
  const c = await promisify(global.dbPool.getConnection).call(global.dbPool);
  try {
    await promisify(c.beginTransaction).call(c);
    const state = await read(promisify(c.query).bind(c), bookId);
    await promisify(c.commit).call(c);
    return state;
  } catch (e) { await promisify(c.rollback).call(c); throw e; }
  finally { c.release(); }
}
function plan(state, command) {
  const headings = state.headings.map(h => ({ ...h })), items = state.items.map(i => ({ ...i }));
  const virtual = Number(state.book.virtual) === 1;
  const find = (rows, value) => { const row = rows.find(r => Number(r.id) === id(value)); if (!row) throw createError(404, 'Item or heading does not belong to this book'); return row; };
  let deleted = null, added = null;
  if (command.action === 'add') {
    const level = Number(command.level);
    if (![1,2,3].includes(level)) throw createError(400, 'Choose H1, H2 or H3');
    const parent = level > 1 ? find(headings, command.parentId) : null;
    if (parent && parent.level !== level - 1) throw createError(400, 'Choose a parent one level above the new heading');
    const title = String(command.title || '').trim(), title_en = String(command.title_en || '').trim();
    if ((!title && !title_en) || title.length > 4000 || title_en.length > 4000) throw createError(400, 'Enter an Arabic or English heading title (up to 4000 characters)');
    added = { id: -1, level, h1: parent ? parent.h1 : null, h2: level === 3 ? parent.h2 : null, h3: null, title, title_en };
    added['h' + level] = Math.floor(Math.max(0,...headings.filter(h => siblings(h,added)).map(h => Number(h['h'+level])))) + 1;
    let position = headings.length;
    if (parent) position = Math.max(...headings.map((h,i) => contains(parent,h) ? i : -1)) + 1;
    headings.splice(position,0,added);
  } else if (command.action === 'delete') {
    deleted = find(headings,command.id);
    if (headings.some(h => h.id !== deleted.id && h.level > deleted.level && contains(deleted,h)) || items.some(i => Number(i.tocId) === deleted.id || contains(deleted,i)))
      throw createError(409, 'Move the items and delete the child headings first');
    headings.splice(headings.indexOf(deleted),1);
  } else if (command.action === 'assign') {
    const item = find(items,command.id), heading = find(headings,command.headingId);
    Object.assign(item,{tocId:heading.id,h1:heading.h1,h2:heading.h2,h3:heading.h3});
    if (!virtual) {
      items.splice(items.indexOf(item),1);
      let position = items.reduce((last,row,i) => contains(heading,row) ? i + 1 : last, -1);
      if (position < 0) {
        const following = new Set(headings.slice(headings.indexOf(heading)+1).map(h=>h.id));
        position = items.findIndex(row=>following.has(row.tocId));
        if (position < 0) position = items.length;
      }
      items.splice(position,0,item);
    }
  } else if (command.action === 'moveItem' || command.action === 'moveHeading') {
    if (virtual) throw createError(400, 'Virtual books keep their reference-number order');
    if (!['up','down'].includes(command.direction)) throw createError(400, 'Invalid direction');
    const delta = command.direction === 'up' ? -1 : 1;
    if (command.action === 'moveItem') {
      const item = find(items,command.id), position = items.indexOf(item), neighbor = items[position+delta];
      if (!neighbor || neighbor.tocId !== item.tocId) throw createError(409, 'End of this heading; use Move to heading to change its heading');
      [items[position],items[position+delta]] = [neighbor,item];
    } else {
      const heading = find(headings,command.id), peers = headings.filter(h=>siblings(h,heading));
      const neighbor = peers[peers.indexOf(heading)+delta];
      if (!neighbor) throw createError(409, 'End of this group of headings');
      const first = delta < 0 ? neighbor : heading, second = delta < 0 ? heading : neighbor;
      const block1 = headings.filter(h=>contains(first,h) && h.level >= first.level), block2 = headings.filter(h=>contains(second,h) && h.level >= second.level);
      const start = headings.indexOf(block1[0]);
      headings.splice(start,block1.length+block2.length,...block2,...block1);
      const group1 = items.filter(i=>contains(first,i)), group2 = items.filter(i=>contains(second,i));
      const positions = items.map((i,n)=>contains(first,i)||contains(second,i) ? n : -1).filter(n=>n>=0);
      const ordered = [...group2,...group1];
      positions.forEach((p,i)=>{items[p]=ordered[i];});
    }
  } else throw createError(400, 'Unknown TOC action');
  // Reuse existing ordinal slots so a small edit does not rewrite the whole book.
  if (command.action === 'moveHeading') headings.forEach((h,i)=>{h.ordinal=Number(state.headings[i].ordinal); if(i && h.ordinal<=headings[i-1].ordinal) h.ordinal=headings[i-1].ordinal+1;});
  if (added) {
    const position=headings.indexOf(added);
    added.ordinal=position ? Number(headings[position-1].ordinal)+1 : Number(state.headings[0]?.ordinal || 0);
    for(let i=position+1;i<headings.length;i++) headings[i].ordinal=Math.max(Number(headings[i].ordinal),Number(headings[i-1].ordinal)+1);
  }
  if (!virtual && ['assign','moveItem','moveHeading'].includes(command.action)) {
    const changedChapters = new Set();
    items.forEach((item,i)=>{
      item.ordinal=Number(state.items[i].ordinal);
      if(i && item.ordinal<=items[i-1].ordinal) item.ordinal=items[i-1].ordinal+1;
      if(item.id!==state.items[i].id) { changedChapters.add(String(item.h1)); changedChapters.add(String(state.items[i].h1)); }
    });
    if(command.action==='assign') {
      changedChapters.add(String(state.items.find(i=>Number(i.id)===Number(command.id)).h1));
      changedChapters.add(String(items.find(i=>Number(i.id)===Number(command.id)).h1));
    }
    const chapters=new Map();
    items.forEach(item=>{const key=String(item.h1); const n=(chapters.get(key)||0)+1; chapters.set(key,n); if(changedChapters.has(key)) item.numInChapter=n;});
  }
  return { headings,items,deleted,added };
}
async function mutate(bookId, command, userId) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) throw createError(400, 'Invalid TOC command');
  const c = await promisify(global.dbPool.getConnection).call(global.dbPool), query = promisify(c.query).bind(c);
  try {
    await promisify(c.beginTransaction).call(c);
    const state = await read(query, bookId, true);
    if (command.revision !== state.revision) throw createError(409, 'The TOC changed. Reload the page before trying again.');
    const change = plan(state,command), virtual = Number(state.book.virtual) === 1, table = virtual ? 'hadiths_virtual' : 'hadiths';
    if (change.deleted) {
      const attached = await query('SELECT id FROM hdith_toc_sharh WHERE toc_id=? LIMIT 1', [change.deleted.id]);
      if (attached.length) throw createError(409, 'This heading has commentary attached; move or remove its commentary before deleting it');
      await query('DELETE FROM toc WHERE id=? AND bookId=?', [change.deleted.id,state.book.id]);
    }
    if (change.added) {
      const h=change.added;
      const result=await query('INSERT INTO toc (bookId,ordinal,level,h1,h2,h3,title,title_en,lastmod_user,lastfixed) VALUES (?,?,?,?,?,?,?,?,?,NOW())',[state.book.id,h.ordinal,h.level,h.h1,h.h2,h.h3,h.title,h.title_en,userId]);
      h.id=result.insertId;
    }
    const oldItems=new Map(state.items.map(i=>[i.id,i]));
    const updated=change.items.filter(i=>['ordinal','tocId','h1','h2','h3','numInChapter'].some(k=>i[k]!==oldItems.get(i.id)[k]));
    // Virtual-row triggers recalculate memberships; preserve the source's exact metadata.
    const sourceIds=[...new Set(updated.map(i=>virtual?i.hadithId:i.id).filter(Boolean))].sort((a,b)=>a-b);
    const originals=virtual && sourceIds.length ? await query('SELECT id,books FROM hadiths WHERE id IN (?) ORDER BY id FOR UPDATE',[sourceIds]) : [];
    if (virtual) {
      for (const item of updated) {
        if (!item.hadithId) throw createError(409, 'This virtual entry has no original item; repair its source before moving it');
        if (!item.ref_num) continue;
        const [source] = await query("SELECT h.id FROM hadiths h JOIN books b ON b.id=h.bookId WHERE CONCAT(b.alias,':',h.num)=?", [state.items.find(i=>i.id===item.id).ref_num]);
        if (!source || Number(source.id)!==Number(item.hadithId)) throw createError(409, 'This virtual reference needs repair before moving it');
      }
    }
    for (const item of updated) await query(`UPDATE ${table} SET ordinal=?,tocId=?,h1=?,h2=?,h3=?,numInChapter=?,lastmod_user=?,lastfixed=NOW() WHERE id=? AND bookId=?`,[item.ordinal,item.tocId,item.h1,item.h2,item.h3,item.numInChapter,userId,item.id,state.book.id]);
    for (const original of originals) await query('UPDATE hadiths SET books=? WHERE id=? AND NOT (books <=> ?)',[original.books,original.id,original.books]);
    for (const h of change.headings) {
      const members=change.items.filter(i=>contains(h,i));
      if (virtual) members.sort((a,b)=>Number(a.num0)-Number(b.num0) || a.ordinal-b.ordinal || a.id-b.id);
      const first=members[0],last=members[members.length-1];
      const old=state.headings.find(row=>row.id===h.id);
      const values=[h.ordinal,members.length,first?.num||null,last?.num||null,first?.num0??null,last?.num0??null];
      if (old && ['ordinal','count','start','end','start0','end0'].every((key,index)=>old[key]===values[index])) continue;
      await query('UPDATE toc SET ordinal=?,count=?,start=?,end=?,start0=?,end0=?,lastmod_user=?,lastfixed=NOW() WHERE id=? AND bookId=?',[h.ordinal,members.length,first?.num||null,last?.num||null,first?.num0??null,last?.num0??null,userId,h.id,state.book.id]);
    }
    await promisify(c.commit).call(c);
    return { book:state.book, deletedId:change.deleted?.id, hadithIds:sourceIds };
  } catch (e) { await promisify(c.rollback).call(c); throw e; }
  finally { c.release(); }
}
module.exports={list,mutate,plan,contains,revision};
