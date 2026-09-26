#!/usr/bin/env node
'use strict';
// Dry-run first. Only generated candidates are replaced; confirmed/source links stay intact.
const fs = require('fs');
const path = require('path');
const util = require('util');
const mysql = require('mysql');
const M = require('../../lib/MatnSimilarity');

async function main() {
    const args = process.argv.slice(2);
    const value = flag => { const i = args.indexOf(flag); return i < 0 ? null : args[i + 1]; };
    for (let i = 0; i < args.length; i++) {
        if (['--book', '--exclude', '--output'].includes(args[i])) {
            if (!args[++i] || args[i].startsWith('--')) throw new Error('Missing argument value');
        } else if (args[i] !== '--apply') throw new Error('Unknown argument: ' + args[i]);
    }
    const alias = value('--book');
    if (!alias) throw new Error('Usage: node bin/utils/refresh-matn-similarity.js --book adab --exclude suyuti [--apply] [--output temp/run-name]');
    const excluded = (value('--exclude') || '').split(',').filter(Boolean);
    if (excluded.includes(alias)) throw new Error('Source book cannot be excluded');
    const output = path.resolve(value('--output') || `temp/matn-${alias}-${Date.now()}`);
    fs.mkdirSync(output, { recursive: true });
    const db = mysql.createConnection(require(path.join(require('os').homedir(), '.hadithdb/settings.json')).mysql.connection);
    const q = util.promisify(db.query).bind(db);
    const key = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
    try {
        const books = await q("SELECT id,alias FROM books WHERE type='hadith'");
        for (const name of [alias, ...excluded]) if (!books.some(b => b.alias === name)) throw new Error('Unknown hadith book: ' + name);
        const sourceBook = books.find(b => b.alias === alias);
        const eligible = books.filter(b => !excluded.includes(b.alias));
        const bookIds = eligible.map(b => b.id);
        const rows = await q('SELECT h.id,h.bookId,h.num,h.body FROM hadiths h WHERE h.bookId IN (?) AND h.body IS NOT NULL AND h.body != ?', [bookIds, '']);
        const sources = rows.filter(h => h.bookId === sourceBook.id);
        if (!sources.length) throw new Error('No source matn found');
        const allSourceIds = (await q('SELECT id FROM hadiths WHERE bookId=?', [sourceBook.id])).map(h => h.id);
        const sourceSQL = '(' + allSourceIds.map(Number).join(',') + ')';
        const eligibleSQL = '(' + bookIds.map(Number).join(',') + ')';
        const scope = `((c.hadithId1 IN ${sourceSQL} AND h2.bookId IN ${eligibleSQL}) OR (c.hadithId2 IN ${sourceSQL} AND h1.bookId IN ${eligibleSQL}))`;
        const joins = 'JOIN hadiths h1 ON h1.id=c.hadithId1 JOIN hadiths h2 ON h2.id=c.hadithId2';
        const directScope = `hadithId1 IN ${sourceSQL} OR hadithId2 IN ${sourceSQL}`;
        const confirmed = await q(`SELECT * FROM hadiths_sim WHERE ${directScope}`);
        const suppressed = await q(`SELECT * FROM hadiths_sim_suppressed WHERE ${directScope}`);
        const blocked = new Set([...confirmed, ...suppressed].filter(r => r.hadithId2).map(r => key(r.hadithId1, r.hadithId2)));
        const before = await q(`SELECT c.* FROM hadiths_sim_candidates c ${joins} WHERE ${scope}`);
        console.log(`Loaded ${sources.length} source matn; ${rows.length} searchable records across ${eligible.length} books; ${before.length} existing scoped candidates.`);
        const profiles = rows.map(M.profile);
        const positions = new Map(rows.map((r, i) => [r.id, i]));
        const index = M.createIndex(profiles);
        const matches = new Map();
        let skippedShort = 0, comparisons = 0;
        for (let n = 0; n < sources.length; n++) {
            const source = sources[n], p = profiles[positions.get(source.id)];
            if (p.tokens.length < 4) { skippedShort++; continue; }
            for (const i of M.candidates(p, index)) {
                const target = rows[i], k = key(source.id, target.id);
                if (source.id === target.id || blocked.has(k) || matches.has(k)) continue;
                comparisons++;
                const rating = M.compare(p, profiles[i]);
                if (rating) matches.set(k, { hadithId1: Math.min(source.id, target.id), hadithId2: Math.max(source.id, target.id), rating: Number(rating.toFixed(3)) });
            }
            if ((n + 1) % 100 === 0) console.log(`Processed ${n + 1}/${sources.length}: ${matches.size} candidate pairs`);
        }
        const planned = [...matches.values()].sort((a,b) => a.hadithId1-b.hadithId1 || a.hadithId2-b.hadithId2);
        const byId = new Map(rows.map(r=>[r.id,r]));
        const aliases = new Map(books.map(b=>[b.id,b.alias]));
        const refs = id => { const r=byId.get(id); return `${aliases.get(r.bookId)}:${r.num}`; };
        const summary = { book: alias, excluded, sources: sources.length, searchableRecords: rows.length, books: eligible.map(b=>b.alias), skippedShort, comparisons, previousCandidates: before.length, candidatePairs: planned.length, confirmedPairsPreserved: confirmed.length, applied: false };
        fs.writeFileSync(path.join(output, 'backup.json'), JSON.stringify({ candidates: before, confirmed, suppressed }, null, 2));
        fs.writeFileSync(path.join(output, 'plan.json'), JSON.stringify(planned.map(r=>({...r, ref1:refs(r.hadithId1), ref2:refs(r.hadithId2)})), null, 2));
        fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary,null,2));
        if (args.includes('--apply')) {
            await q('START TRANSACTION');
            try {
                const current = await q(`SELECT c.* FROM hadiths_sim_candidates c ${joins} WHERE ${scope} FOR UPDATE`);
                const signature = list => JSON.stringify([...list].sort((a,b)=>a.id-b.id));
                if (signature(current)!==signature(before)) throw new Error('Candidates changed during calculation; rerun');
                if (signature(await q(`SELECT * FROM hadiths_sim WHERE ${directScope} FOR UPDATE`)) !== signature(confirmed) || signature(await q(`SELECT * FROM hadiths_sim_suppressed WHERE ${directScope} FOR UPDATE`)) !== signature(suppressed)) throw new Error('Confirmed or suppressed links changed; rerun');
                await q(`DELETE c FROM hadiths_sim_candidates c ${joins} WHERE ${scope}`);
                for (let i=0;i<planned.length;i+=500) await q('INSERT INTO hadiths_sim_candidates (hadithId1,hadithId2,rating) VALUES ?', [planned.slice(i,i+500).map(r=>[r.hadithId1,r.hadithId2,r.rating])]);
                const actual = await q(`SELECT c.hadithId1,c.hadithId2,c.rating FROM hadiths_sim_candidates c ${joins} WHERE ${scope} ORDER BY c.hadithId1,c.hadithId2`);
                if (JSON.stringify(actual)!==JSON.stringify(planned)) throw new Error('Readback differs from plan');
                await q('COMMIT');
                summary.applied = true;
                summary.verifiedPairs = actual.length;
            } catch (err) { await q('ROLLBACK'); throw err; }
            fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2));
        }
        console.log(JSON.stringify(summary,null,2));
        console.log('Artifacts: '+output);
    } finally { db.end(); }
}
main().catch(err=>{console.error(err);process.exitCode=1;});
