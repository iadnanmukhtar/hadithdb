'use strict';
const Taxonomy = require('../lib/CommunityTaxonomy');
const Community = require('../lib/Community');
test('accepts supported categories and explicit clearing but rejects invalid input', () => {
 for (const category of Taxonomy.categories) expect(Taxonomy.category(category)).toBe(category);
 expect(Taxonomy.category('')).toBe(''); expect(Taxonomy.category(undefined)).toBeUndefined();
 for (const value of [null, {}, 'Unknown', '<script>']) expect(()=>Taxonomy.category(value)).toThrow();
});
test('public category and tags use published snapshots while editor uses drafts', () => {
 const row={id:1,kind:'article',category:'Fiqh',public_category:'Hadith',tags:'draft',public_tags:'published',markdown:'draft',public_markdown:'published',handle:'author'};
 expect(Community.postView(row)).toMatchObject({category:'Hadith',tags:'published'});
 expect(Community.postView(row,true)).toMatchObject({category:'Fiqh',tags:'draft'});
});
test('migration is repeatable and does not suppress other database errors', async () => {
 const sql=jest.fn().mockRejectedValue({code:'ER_DUP_FIELDNAME'});
 await expect(Taxonomy.migrate(sql)).resolves.toBeUndefined(); expect(sql).toHaveBeenCalledTimes(3);
 await expect(Taxonomy.migrate(jest.fn().mockRejectedValue(new Error('Offline')))).rejects.toThrow('Offline');
});
