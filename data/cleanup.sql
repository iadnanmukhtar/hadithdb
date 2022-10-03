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