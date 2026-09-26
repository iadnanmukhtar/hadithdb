'use strict';

// Deliberately independent of chains, headings, grades and shared `part` values.
function normalize(text) {
    return String(text || '').replace(/<[^>]*>/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/صلى الله عليه وسلم|عليه الصلاة والسلام|عز وجل|رضي الله عنهما|رضي الله عنه|رضي الله عنها/g, ' ')
        .normalize('NFKD').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
        .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي')
        .replace(/[^\u0621-\u063a\u0641-\u064a\s]/g, ' ')
        .replace(/صلي الله عليه وسلم|عليه الصلاة والسلام|عز وجل|رضي الله عنهما|رضي الله عنه|رضي الله عنها/g, ' ')
        .replace(/\s+/g, ' ').trim();
}
const STOP = new Set('قال فقال قلت قالت يقول ان انه انما من في علي الي عن ثم لا ما يا هو هي هذا هذه ذلك كان رسول الله النبي'.split(' '));
function profile(row) {
    const text = normalize(row.body);
    const tokens = text.split(' ').filter(t => t && !STOP.has(t));
    const grams = new Set(tokens.slice(1).map((t, i) => tokens[i] + ' ' + t));
    return { text, tokens, grams };
}
function compare(a, b) {
    if (a.tokens.length > b.tokens.length || (a.tokens.length === b.tokens.length && a.text > b.text)) [a, b] = [b, a];
    if (a.tokens.length < 4) return 0; // Formulae and transmission-only fragments are not evidence.
    if (a.text === b.text) return 1;
    if (a.tokens.length >= 6 && (' ' + b.text + ' ').includes(' ' + a.text + ' ')) return 0.98;
    const counts = new Map();
    for (const t of b.tokens) counts.set(t, (counts.get(t) || 0) + 1);
    let overlap = 0;
    for (const t of a.tokens) if (counts.get(t)) { overlap++; counts.set(t, counts.get(t) - 1); }
    const coverage = overlap / a.tokens.length;
    // In a brief saying, one substituted subject can change the whole report.
    if (a.tokens.length <= 6 && coverage < 1) return 0;
    let sharedGrams = 0;
    for (const g of a.grams) if (b.grams.has(g)) sharedGrams++;
    const ordered = sharedGrams / Math.max(1, a.grams.size);
    // Require ordered wording as well as vocabulary; character similarity alone cannot qualify.
    if (coverage < 0.7 || ordered < 0.4 || sharedGrams < 2) return 0;
    const dice = 2 * overlap / (a.tokens.length + b.tokens.length);
    const score = 0.45 * coverage + 0.35 * ordered + 0.20 * dice;
    return score >= 0.72 ? score : 0;
}
function createIndex(profiles) {
    const index = new Map();
    profiles.forEach((p, i) => {
        if (p.tokens.length < 4) return;
        for (const g of p.grams) {
            if (!index.has(g)) index.set(g, []);
            index.get(g).push(i);
        }
    });
    return index;
}
function candidates(p, index) {
    const ids = new Set();
    for (const g of p.grams) for (const i of index.get(g) || []) ids.add(i);
    return ids;
}
module.exports = { normalize, profile, compare, createIndex, candidates };
