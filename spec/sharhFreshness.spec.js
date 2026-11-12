'use strict';
const Sharh = require('../lib/Sharh');
const Sitemap = require('../lib/FreshnessSitemap');
const stamp = '2025-02-02T11:30:00.000Z';
afterEach(() => jest.restoreAllMocks());
test('sharh revisions map hadith and heading explanations to canonical URLs', async () => {
  const saved = global.query;
  global.query = jest.fn().mockResolvedValue([
    {alias:'fath-al-bari',kind:'hadith',reference:'bukhari:1',modified:stamp},
    {alias:'fath-al-bari',kind:'heading',reference:'42',modified:stamp}
  ]);
  try {
    expect(await Sharh.recentUpdatedPassages()).toEqual([
      {path:'/sharh/fath-al-bari/bukhari:1',modified:stamp},
      {path:'/sharh/fath-al-bari/heading/42',modified:stamp}
    ]);
    expect(global.query.mock.calls[0][0]).toContain('MAX(hs.content_updated_at)');
  } finally { global.query = saved; }
});
test('Hadith updates sitemap includes both sharh page kinds', async () => {
  const saved = global.query;
  global.query = jest.fn().mockResolvedValue([]);
  jest.spyOn(Sharh,'recentUpdatedPassages').mockResolvedValue([
    {path:'/sharh/fath-al-bari/bukhari:1',modified:stamp},
    {path:'/sharh/fath-al-bari/heading/42',modified:stamp}
  ]);
  jest.spyOn(require('../lib/CommunitySitemap'),'entries').mockResolvedValue([]);
  jest.spyOn(require('../lib/Community'),'feed').mockResolvedValue({items:[]});
  try {
    const xml = Sitemap.xml(await Sitemap.entries({quranOnly:false,base:'https://hadith.example'}));
    expect(xml).toContain('/sharh/fath-al-bari/bukhari:1</loc><lastmod>'+stamp);
    expect(xml).toContain('/sharh/fath-al-bari/heading/42</loc><lastmod>'+stamp);
  } finally {global.query=saved;}
});
const integration = process.env.HADITHDB_MYSQL_INTEGRATION === '1' ? test : test.skip;
integration('migration preserves unknown history and tracks future SQL inserts and edits', async () => {
  const mysql=require('mysql'), {promisify}=require('util');
  const connection=mysql.createConnection({...require('../bin/initializeHadithAttributions').connectionSettings(),timezone:'Z'});
  const q=promisify(connection.query).bind(connection);
  const table='sharh_freshness_test_'+process.pid+'_'+Date.now();
  try {
    await q(`CREATE TABLE ${table} (id INT PRIMARY KEY, text TEXT)`);
    await q(`INSERT INTO ${table} VALUES (1,'Historical')`);
    await require('../lib/SharhFreshness').migrate(q,table);
    await require('../lib/SharhFreshness').migrate(q,table);
    expect((await q(`SELECT * FROM ${table} WHERE id=1`))[0].content_updated_at).toBeNull();
    await q(`INSERT INTO ${table} (id,text) VALUES (2,'New')`);
    expect((await q(`SELECT * FROM ${table} WHERE id=2`))[0].content_updated_at).toBeInstanceOf(Date);
    await q(`UPDATE ${table} SET content_updated_at='2025-01-01 00:00:00.000' WHERE id=2`);
    await q(`UPDATE ${table} SET text='New' WHERE id=2`);
    expect((await q(`SELECT * FROM ${table} WHERE id=2`))[0].content_updated_at.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    await q(`UPDATE ${table} SET text='Changed' WHERE id=2`);
    expect((await q(`SELECT * FROM ${table} WHERE id=2`))[0].content_updated_at.getTime()).toBeGreaterThan(Date.parse(stamp));
  } finally { await q(`DROP TABLE IF EXISTS ${table}`); connection.destroy(); }
},30000);
test.each(['hadith','heading'])('%s template uses the latest rendered entry revision for both date signals', kind => {
  const ejs=require('ejs'), fs=require('fs'), path=require('path');
  const filename=path.join(__dirname,'../views/sharh_passage.ejs');
  const Utils=require('../lib/Utils');
  let head, visible;
  ejs.render(fs.readFileSync(filename,'utf8'),{
    global:{settings:{site:{}}},req:{},book:{alias:'test',shortName_en:'Test'},
    entry:{id:1,text_en:'First',content_updated_at:'2025-01-01T00:00:00Z'},
    entries:[{id:1,text_en:'First',content_updated_at:'2025-01-01T00:00:00Z'},{id:2,text_en:'Second',content_updated_at:stamp}],
    owner:null,kind,canonical:'/sharh/test/heading/1',utils:Utils,
    Tafsir:{renderCommentaryText:text=>text},
    include:(name,data)=>{
      if(name==='sub-views/head.ejs')head=data.page.dateModified;
      if(name==='sub-views/page_updated.ejs')visible=data.page.dateModified;
      return '';
    }
  },{filename});
  expect(head).toBe(stamp);expect(visible).toBe(stamp);
});
