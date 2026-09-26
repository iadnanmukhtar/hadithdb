'use strict';
const M = require('../lib/MatnSimilarity');
const p = body => M.profile({ body });
test('normalizes vocalization, markup and salawat', () => {
    expect(M.compare(p('رِضَا الرَّبِّ فِي رِضَا الْوَالِدِ وَسَخَطُ الرَّبِّ فِي سَخَطِ الْوَالِدِ'), p('**رضا الرب في رضا الوالد وسخط الرب في سخط الوالد**'))).toBe(1);
});
test('finds a full matn embedded in a longer report', () => {
    const text = 'رضا الرب في رضا الوالد وسخط الرب في سخط الوالد';
    expect(M.compare(p(text), p('سمعت عبد الله يحدث الناس ويقول ' + text + ' وكان يحث الناس علي بر ابائهم'))).toBeGreaterThan(0.9);
});
test('rejects shared chains and headings with unrelated matn', () => {
    const common = { chain: 'حدثنا ادم حدثنا شعبة عن قتادة', part: 'بر الوالدين' };
    expect(M.compare(M.profile({ ...common, body: 'رضا الرب في رضا الوالد وسخط الرب في سخط الوالد' }), M.profile({ ...common, body: 'من غشنا فليس منا' }))).toBe(0);
});
test('rejects reordered vocabulary and short formulae', () => {
    expect(M.compare(p('الصدق يهدي البر والبر يهدي الجنة والكذب يهدي الفجور'), p('الفجور الكذب الجنة الصدق والبر البر يهدي يهدي يهدي'))).toBe(0);
    expect(M.compare(p('قال مثله'), p('قال مثله'))).toBe(0);
});
test('index includes every accepted pair and comparison is symmetric', () => {
    const ps = ['رضا الرب في رضا الوالد وسخط الرب في سخط الوالد', 'سمعت رضا الرب في رضا الوالد وسخط الرب في سخط الوالد', 'من غشنا فليس منا'].map(p);
    const index = M.createIndex(ps);
    for (const a of ps) for (let i = 0; i < ps.length; i++) {
        expect(M.compare(a, ps[i])).toBe(M.compare(ps[i], a));
        if (M.compare(a, ps[i])) expect(M.candidates(a, index).has(i)).toBe(true);
    }
});

test('rejects brief sayings that share a template but change the subject', () => {
    expect(M.compare(p('ليس شيء اكرم علي الله من الدعاء'), p('ليس شيء اكرم علي الله من المؤمن'))).toBe(0);
});
