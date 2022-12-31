-- delete duplicate ahadith
delete hadiths
   from hadiths
  inner join (
     select max(id) as lastId, bookId, num, grade, text
       from hadiths
      group by bookId, num, grade, text
     having count(*) > 1
     ) dup 
	on dup.bookId=hadiths.bookId and dup.num=hadiths.num and dup.grade=hadiths.grade and dup.body=hadiths.text
  where hadiths.id < dup.lastId;
commit;

-- extract footnote from body
update hadiths ht, (
	select 
		h0.id, regexp_substr(h0.body, 'قَالَ أَبُو عِيسَى .+$') as new_footnote 
	from 
		hadiths h0
	where 
		h0.bookId=5 and h0.body regexp 'قَالَ أَبُو عِيسَى'
) as hs
set
	ht.footnote = hs.new_footnote
where 
	ht.id = hs.id;

-- remove footnote from body
update hadiths ht, (
	select 
		h0.id, body, regexp_replace(body, 'قَالَ أَبُو عِيسَى .+$', '') as new_body 
	from 
		hadiths h0
	where h0.bookId=5 and h0.body regexp 'قَالَ أَبُو عِيسَى'
) as hs
set
	ht.body = hs.new_body
where
	ht.id = hs.id;

-- shamela table of contents
select distinct
    t.lvl, b1.nass, b2.bhno as _bhno
from b1699 b1, b1699 b2, t1699 t
where 
    b1.bhno is null
and b1.rowid = (b2.rowid-1)
and b1.page = b2.page
and b1.id = t.id
order by b1.page;

-- update sections for hadith based on toc
set sql_safe_updates = 0;
update hadiths h, (
	select bookId, h1, h2, start0, end0 from toc 
	where bookid=8
    ) as toc
set
	h.h1=toc.h1,
    h.h2=toc.h2,
	h.h3=toc.h3
where
	h.bookId = toc.bookId
and h.num0 between toc.start0 and toc.end0;

-- copy translations from similar ahadith
set sql_safe_updates=0;
UPDATE hadiths h1, (
	SELECT hadithId1, b2.shortName_en, h2.num, h2.body_en
    FROM hadiths h2, books b2, hadith_sim_candidates c 
	WHERE 
			h2.id = c.hadithId2
		AND h2.bookId = b2.id
        AND h2.body != ''
		AND h2.body_en != ''
		AND c.rating >= 0.75
	ORDER BY h2.bookId
    ) as m
SET
	h1.temp_trans = 1,
	h1.body_en = CONCAT(m.body_en, ' (Using translation from ', m.shortName_en, ' ', m.num, ') ')
WHERE
	h1.id = m.hadithId1
AND (h1.body_en is null OR h1.body_en = '')
AND h1.temp_trans = 0
-- AND h1.id = 135341
;