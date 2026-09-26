'use strict';
const {prepare}=require('../bin/import-mishkat-misc');
test('preserves every pending report verbatim and gives it a unique misc reference and provenance footnote',()=>{
 const p=require('../temp/mishkat-import-review.json'),pending=p.entries.filter(h=>!h.links.length),rows=prepare(p);expect(rows).toHaveLength(pending.length);expect(new Set(rows.map(r=>r.num)).size).toBe(rows.length);
 for(const [i,row]of rows.entries()){expect(row.text).toBe(pending[i].text);expect(row.num).toBe(`mishkat-${pending[i].number}`);expect(row.footnote).toContain(`مشكاة المصابيح، رقم ${row.number}`);expect(row.footnote).toContain('موضعه في النسخة المستوردة');if(pending[i].footnote)expect(row.footnote).toContain(pending[i].footnote);}
});
test('keeps citation-only and standalone editorial records instead of inventing missing matn',()=>{
 const p=require('../temp/mishkat-import-review.json'),source=p.entries.filter(h=>[31,5032].includes(h.number)).map(h=>({...h,links:[]})),rows=prepare({entries:source});expect(rows.map(h=>h.text)).toEqual(source.map(h=>h.text));expect(rows[0].footnote).toContain('رَوَاهُ التِّرْمِذِيُّ');
});
