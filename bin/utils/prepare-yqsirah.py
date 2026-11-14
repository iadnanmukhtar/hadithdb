#!/usr/bin/env python3
"""Extract the supplied transcript with Poppler; retain source page/video provenance."""
import argparse, difflib, hashlib, json, pathlib, re, subprocess, tempfile, xml.etree.ElementTree as ET

def clean(s):
    def rtl(m):
        run=m[1]
        # Poppler puts visual punctuation before an RTL run. Restore its logical edge.
        edge=re.match(r'^([^\w\u0600-\u06ff\ufb50-\ufdff\ufe70-\ufeff]*)(.*)$',run,re.S)
        if edge:
            prefix,body=edge.groups()
            run=body+prefix.strip()[::-1]
        return run
    s=re.sub(r'\u202b(.*?)\u202c',rtl,s,flags=re.S)
    s=re.sub('[\u202a-\u202e\u200e\u200f]','',s)
    s=re.sub(r'([\u0600-\u06ff\ufb50-\ufdff\ufe70-\ufeff)])(?=[A-Za-z])',r'\1 ',s)
    return re.sub(r'\s+', ' ',s).strip()
def norm(s):
    return re.sub('[^a-z0-9]', '', clean(s).lower().replace('&','and').replace('pbuh',''))
def extract(pdf):
    with tempfile.TemporaryDirectory() as tmp:
        txt=pathlib.Path(tmp)/'source.txt'; xml=pathlib.Path(tmp)/'source.xml'
        subprocess.run(['pdftotext','-layout',str(pdf),str(txt)],check=True)
        with xml.open('w') as f:subprocess.run(['pdftohtml','-xml','-i','-stdout',str(pdf)],stdout=f,check=True)
        pages=txt.read_text().split('\f'); root=ET.parse(xml).getroot()
    fonts={}; note_ids={}; videos={}
    for page in root.findall('page'):
        pn=int(page.get('number'))
        for f in page.findall('fontspec'):fonts[f.get('id')]=f.attrib
        if pn<44:continue
        ns=[]; title=[]
        for t in page.findall('text'):
            s=''.join(t.itertext()).strip(); size=int(fonts[t.get('font')]['size'])
            if s.isdigit() and size<=12 and int(t.get('left'))<=110:ns.append(int(s))
            if size>=25:title.append(s)
        note_ids[pn]=sorted(ns)
        heading=clean(' '.join(title));m=re.match(r'^(\d{3})\.\s+(.*)',heading)
        if m:videos[pn]={'video':int(m[1]),'title':m[2]}
    assert [v['video'] for v in videos.values()]==list(range(1,102)),videos
    toc=[];pending=[];video=0
    for p in pages[2:43]:
        for line in p.splitlines():
            s=clean(line)
            if not s or s.isdigit() or s=='Contents':continue
            m=re.match(r'^(\d{3})\.\s+(.*)',s)
            if m:video=int(m[1]);pending=[];continue
            m=re.match(r'^(.*?)\s+(\d{2,4})$',s)
            if m:
                title=clean(re.sub(r'[.…]{2,}.*$','',m[1]))
                toc.append({'video':video,'page':int(m[2]),'title':clean(' '.join(pending+[title]))});pending=[]
            else:pending.append(s)
    blocks=[];notes=[];video=0
    for pn in range(44,1166):
        lines=pages[pn-1].splitlines()
        while lines and not lines[-1].strip():lines.pop()
        assert lines.pop().strip()==str(pn),pn
        ids=note_ids[pn]; starts=[]
        for i,l in enumerate(lines):
            m=re.match(r'^\s*(\d+)\s*(.*)$',l)
            if m and int(m[1]) in ids and (not m[2] or re.match(r'^\d+\s{10,}',l)):starts.append((i,int(m[1]),m[2]))
        assert sorted(n for _,n,_ in starts)==ids,(pn,ids,starts)
        for j,(i,n,extra) in enumerate(starts):
            end=starts[j+1][0] if j+1<len(starts) else len(lines)
            notes.append({'page':pn,'number':n,'key':f'p{pn}n{n}','text':clean(' '.join([extra]+lines[i+1:end]))})
        if starts:lines=lines[:starts[0][0]]
        chunks=[clean(c) for c in re.split(r'\n\s*\n','\n'.join(lines)) if clean(c)]
        if pn in videos:
            video=videos[pn]['video']; header=chunks.pop(0)
            assert header.startswith(f'{video:03}.'),(pn,header)
        for chunk in chunks:
            if re.fullmatch(r'[_—\-\s]+',chunk):continue
            blocks.append({'page':pn,'video':video,'text':chunk,'layout':chunk})
    # Match the printed contents to actual headings. Pending parent labels may precede a child.
    unmatched=[];used=set()
    for entry in toc:
        if entry['page']>1165:continue
        candidates=[(i,b) for i,b in enumerate(blocks) if b['page']==entry['page'] and i not in used]
        aliases={273: 'The Difference Between Sama (Heaven) and Jannah (Paradise)',479:'Prisoner of War: Suhayl ibn Amr',557:'"It Became the Better of My Two Eyes": Qatada ibn al-Nu\'man al-Awsi RA',592:"2. Ghawrath ibn al-Harith's Attempt to Assassinate the Prophet ﷺ",1017:'It Is Possible for Another Masjid to Also Become a Type of Masjid Dirar, But...',1087:'The Delegation of Abd al-Rahman ibn Abi Aqil: "Ya Rasulullah, Why Don\'t You Ask Your Lord to Give You a Kingdom Like That of Sulayman?"'}
        n=norm(entry['title'])
        if entry['page'] in aliases and any(norm(b['layout'])==norm(aliases[entry['page']]) for _,b in candidates):
            if entry['title'] in [t['title'] for t in toc if t['page']==entry['page']] and not any(norm(b['layout'])==n for _,b in candidates):
                # Only apply an alias if it resembles the requested TOC title.
                alias=norm(aliases[entry['page']])
                if difflib.SequenceMatcher(None,n,alias).ratio()>.65:n=alias
        if entry['page']==667 and entry['title']=='Recap':
            blocks[candidates[0][0]]['synthetic_heading']='Recap';continue
        exact=[(i,b) for i,b in candidates if norm(b['layout'])==n]
        suffix=[(i,b) for i,b in candidates if len(norm(b['layout']))>8 and (n.endswith(norm(b['layout'])) or norm(b['layout']).endswith(n) or norm(b['layout']).startswith(n)) and len(b['layout'])<240]
        matches=exact or sorted(suffix,key=lambda pair:len(pair[1]['layout']))[:1]
        if len(matches)==1:
            i,b=matches[0];b['heading']=b['layout'];used.add(i)
        else:unmatched.append(entry)
    refs=[]
    for b in blocks:
        def ref(m):
            number=int(m[1]); candidates=[n for n in notes if n['number']==number and abs(n['page']-b['page'])<=1]
            same=[n for n in candidates if n['page']==b['page']]
            candidates=same or candidates
            if len(candidates)!=1:
                refs.append({'page':b['page'],'number':number,'matches':len(candidates)});return m[0]
            note=candidates[0];note['uses']=note.get('uses',0)+1
            return '[^'+note['key']+']'
        b['text']=re.sub(r'\[\s*(\d+)\s*\]',ref,b['text'])
    return {'source_sha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'source_pages':1181,'videos':videos,'toc':toc,'blocks':blocks,'notes':notes,'unmatched_headings':unmatched,'unmatched_references':refs}
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('pdf',type=pathlib.Path);parser.add_argument('--output',default='var/imports/yqsirah/extracted.json');args=parser.parse_args()
    result=extract(args.pdf);pathlib.Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:len(result[k]) for k in ['videos','blocks','notes','unmatched_headings','unmatched_references']}))
    print('Unused notes:',[n['key'] for n in result['notes'] if not n.get('uses')])
