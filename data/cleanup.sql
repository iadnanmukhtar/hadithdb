# delete duplicate ahadith
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

# extract footnote from body
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

# remove footnote from body
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