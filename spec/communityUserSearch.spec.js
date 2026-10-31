'use strict';
const fs = require('fs');
const { JSDOM } = require('jsdom');
const Community = require('../lib/Community');
const Avatar = require('../lib/UserAvatar');
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };

test('people search bounds input and results, escapes wildcard characters, and exposes only public presentation', async () => {
  const previous = global.dbPool;
  const rows = Array.from({length:21}, (_, i) => ({handle:'writer' + i, name:'Writer', uid:'secret', email:'secret@example.test'}));
  global.dbPool = {query:jest.fn((statement, values, callback) => callback(null, statement.startsWith('SELECT handle,display_name') ? rows : []))};
  const decorate = jest.spyOn(Avatar, 'decorateAuthors').mockResolvedValue();
  try {
    expect(await Community.searchAuthors(' @ ')).toEqual({authors:[],hasMore:false});
    expect(global.dbPool.query).not.toHaveBeenCalled();
    await expect(Community.searchAuthors({})).rejects.toMatchObject({status:400});
    await expect(Community.searchAuthors('a'.repeat(121))).rejects.toMatchObject({status:400});
    const result = await Community.searchAuthors('@a_%!');
    expect(result.authors).toHaveLength(20); expect(result.hasMore).toBe(true);
    expect(result.authors[0]).toEqual({handle:'writer0',name:'Writer'});
    const [sql, params] = global.dbPool.query.mock.calls.find(([sql]) => sql.startsWith('SELECT handle,display_name'));
    expect(params).toEqual(['%a!_!%!!%', '%a!_!%!!%', 'a_%!']);
    expect(sql).toContain("profile_visibility='public'");
    expect(sql).toContain("uid NOT LIKE 'legacy-reflection:%'");
    expect(sql).toContain('REGEXP_SUBSTR');
    expect(sql).toContain('LIMIT 21');
  } finally { global.dbPool = previous; decorate.mockRestore(); }
});

async function setup() {
  const rail = fs.readFileSync('views/sub-views/community_rail.ejs', 'utf8');
  const dom = new JSDOM('<main id="community" class="community" data-view="test"><p id="community-status"></p>' + rail + '</main>', {url:'https://example.test/community',runScripts:'outside-only'});
  const w = dom.window;
  w.quranApiPath = p => '/api' + p; w.hadithAuth = {getToken:async () => null};
  const dialog = w.document.querySelector('dialog');
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new w.Event('close')); };
  w.fetch = jest.fn(async () => ({ok:true,json:async () => ({authors:[],hasMore:false})}));
  w.eval(fs.readFileSync('public/static/js/community.js','utf8')); await settle();
  w.document.getElementById('community-user-search-open').click();
  const input = w.document.querySelector('input');
  const submit = value => { input.value = value; w.document.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true})); };
  return {w, dialog, input, submit};
}

test('search focuses input, ignores stale responses, renders safe profile links, and clears on close', async () => {
  const {w, dialog, input, submit} = await setup();
  try {
    expect(dialog.open).toBe(true); expect(w.document.activeElement).toBe(input);
    let finish;
    w.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    submit('old'); await settle();
    w.fetch.mockResolvedValue({ok:true,json:async () => ({authors:[{handle:'writer',name:'<b>Writer</b>'}],hasMore:false})});
    submit('@writer'); await settle();
    finish({ok:true,json:async () => ({authors:[{handle:'old',name:'Old'}]})}); await settle();
    const results = w.document.getElementById('community-user-search-results');
    expect(results.querySelector('a').getAttribute('href')).toBe('/community/@writer');
    expect(results.textContent).toBe('<b>Writer</b>@writer'); expect(results.querySelector('b')).toBeNull();
    input.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
    expect(dialog.open).toBe(false); expect(input.value).toBe(''); expect(results.childElementCount).toBe(0);
  } finally { w.close(); }
});

test('search handles empty results and offers retry after an error', async () => {
  const {w, submit} = await setup();
  try {
    submit('missing'); await settle();
    expect(w.document.getElementById('community-user-search-status').textContent).toContain('No people found');
    w.fetch.mockRejectedValueOnce(new Error('offline')); submit('writer'); await settle();
    const retry = w.document.querySelector('#community-user-search-results button'); expect(retry.textContent).toBe('Try again');
    retry.click(); await settle();
    expect(w.document.getElementById('community-user-search-status').textContent).toContain('No people found');
  } finally { w.close(); }
});
