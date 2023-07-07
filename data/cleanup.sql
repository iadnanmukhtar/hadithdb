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
set @b := 14;
set @s0 := ' أَخْرَجَهُ ' COLLATE utf8mb4_unicode_ci;
set @s1 := concat(@s0, '.+$') COLLATE utf8mb4_unicode_ci;

update hadiths ht, (
	select 
		h0.id, regexp_substr(h0.body, @s1) as new_footnote 
	from 
		hadiths h0
	where 
		h0.bookId=@b and h0.body regexp @s0
) as hs
set
	ht.footnote = hs.new_footnote
where 
	ht.id = hs.id;

update hadiths ht, (
	select 
		h0.id, body, regexp_replace(body, @s1, '') as new_body 
	from 
		hadiths h0
	where h0.bookId=@b and h0.body regexp @s0
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

-- order tagged ahadith by similarity
set @tagId := 179;
select distinct *
from (
	select h1.id as h1_id, h2.id as h2_id, b.alias as alias, h2.num as num, h2.chain, h2.body 
	 from hadiths h1, hadiths h2, books b, hadiths_tags t, hadiths_sim_candidates c
	where  h1.id = t.hadithId
	  and h1.id = c.hadithId1
	  and c.hadithId2 = h2.id
	  and h2.id != h1.id
	  and h2.id in (select hadithId from hadiths_tags where tagId=@tagId)
	  and h2.bookId = b.id
	  and t.tagId = 179
	  and c.rating > 0.67
	union
	select h1.id as h1_id, h1.id as h2_id, b.alias as alias, h1.num as num, h1.chain, h1.body
	 from hadiths h1, books b
	where h1.id in (select hadithId from hadiths_tags where tagId=@tagId)
	 and h1.bookId = b.id
) x
order by h1_id, h2_id, alias, num

-- move t3 to t2 for unit hadiths
update toc t2, toc t3, hadiths h
set
	h.tocId = t2.id
where 
	t2.level=2
and t3.level=3
and t2.bookId = t3.bookId
and t2.h1 = t3.h1
and t2.h2 = t3.h2
and t2.h3 is null
and h.tocId = t3.id
  and t3.bookId=13
  and t3.h1=54
  and t3.count < 3;

-- TOC hierarchy
select 
	  t1.bookId 
	, t1.level
	, t1.h1, t1.title
	, t2.level
	, t2.h2, t2.title
	, t3.level
	, t3.h3, t3.title
from 
	toc t1 
    left join toc t2 on t2.level=2 and t2.bookId = t1.bookId and t2.h1=t1.h1
	left join toc t3 on t3.level=3 and t3.bookId = t2.bookId and t3.h1=t1.h1 and t3.h2=t2.h2
where
		t1.level=1
	and t1.bookId=11
order by 
	  t1.bookId
	, t1.h1
    , t2.h2
    , t3.h3
;