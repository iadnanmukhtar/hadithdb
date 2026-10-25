'use strict';
const Settings = require('../lib/UserSettings');
const router = require('../routes/notebook');
const floating = { source: { source_key: 'item:42', source_title: 'bukhari:1', source_url: '/bukhari:1', markdown: 'Private draft' }, minimized: true };
afterEach(() => { jest.restoreAllMocks(); delete global.query; });

test('account persistence validates the reference and strips draft contents and supplied ownership', async () => {
  global.query = jest.fn(async () => ({}));
  const result = await Settings.saveNotebookFloating({uid:'alice'}, {...floating, uid:'bob'});
  expect(result).toEqual({...floating, source:{...floating.source, markdown:''}});
  const sql = global.query.mock.calls[0][0];
  expect(sql).toContain("VALUES ('alice', NULL");
  expect(sql).toContain("JSON_SET(COALESCE(settings_json, JSON_OBJECT()), '$.notebookFloating'");
  expect(sql).not.toContain('Private draft');
  expect(sql).not.toContain('bob');
  await expect(Settings.saveNotebookFloating({uid:'alice'}, {...floating, source:{...floating.source,source_key:'invalid'}})).rejects.toMatchObject({status:400});
  await expect(Settings.saveNotebookFloating({uid:'alice'}, {...floating, source:{...floating.source,source_url:'https://example.org/'}})).rejects.toMatchObject({status:400});
  expect(global.query).toHaveBeenCalledTimes(1);
});

test('unpinning stores an explicit null so older host sessions cannot resurrect the note', async () => {
  global.query = jest.fn(async () => ({}));
  expect(await Settings.saveNotebookFloating({uid:'alice'}, null)).toBeNull();
  expect(global.query.mock.calls[0][0]).toContain("CAST('null' AS JSON)");
});

test('floating API reads and writes only the authenticated account', async () => {
  const get = router.stack.find(layer=>layer.route?.path==='/floating' && layer.route.methods.get).route.stack[0].handle;
  const put = router.stack.find(layer=>layer.route?.path==='/floating' && layer.route.methods.put).route.stack[0].handle;
  jest.spyOn(Settings,'getSettings').mockResolvedValue({notebookFloating:floating});
  jest.spyOn(Settings,'saveNotebookFloating').mockResolvedValue(floating);
  const res = {json:jest.fn()}, next = jest.fn(), user = {uid:'alice'};
  await get({user,query:{uid:'bob'}},res,next);
  expect(Settings.getSettings).toHaveBeenCalledWith('alice');
  expect(res.json).toHaveBeenLastCalledWith({uid:'alice',floating});
  await put({user,body:{uid:'bob',floating}},res,next);
  expect(Settings.saveNotebookFloating).toHaveBeenCalledWith(user,floating);
  expect(next).not.toHaveBeenCalled();
});
