'use strict';
const Access = require('../lib/AdminAccess');
const GoogleAuth = require('../lib/GoogleAuth');
const LocalAuth = require('../lib/LocalAuth');
const UserSettings = require('../lib/UserSettings');
const adminRouter = require('../routes/admin');
const fs = require('fs');
const path = require('path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
let res, next;
beforeEach(() => {
  res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn(), cookie: jest.fn(), json: jest.fn() };
  next = jest.fn();
  jest.spyOn(GoogleAuth, 'verifyRequest').mockResolvedValue(null);
  jest.spyOn(UserSettings, 'isAdminUser').mockResolvedValue(false);
});
afterEach(() => jest.restoreAllMocks());

test('all admin responses forbid indexing and caching before checking access', () => {
  Access.privateResponse({}, res, next);
  expect(res.setHeader).toHaveBeenCalledWith('X-Robots-Tag', 'noindex, nofollow');
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  expect(adminRouter.stack[0].handle).toBe(Access.privateResponse);
  expect(adminRouter.stack[1].handle).toBe(Access.authorize);
  expect(read('public/robots.txt')).toContain('Disallow: /admin');
});

test('edit-mode and unsigned admin cookies cannot grant access', async () => {
  await Access.authorize({ headers: {}, cookies: { editMode: '1', admin: '1' } }, res, next);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(next).not.toHaveBeenCalled();
});

test('rejects non-admins and revoked admins even with a signed admin flag', async () => {
  GoogleAuth.verifyRequest.mockResolvedValue({ uid: 'former-admin', admin: true });
  await Access.authorize({ headers: { authorization: 'Bearer test' } }, res, next);
  expect(UserSettings.isAdminUser).toHaveBeenCalledWith('former-admin');
  expect(res.status).toHaveBeenCalledWith(403);
  expect(next).not.toHaveBeenCalled();
});

test('rejects an expired or forged session', async () => {
  jest.spyOn(LocalAuth, 'verifyToken').mockImplementation(() => { throw new Error('bad token'); });
  await Access.authorize({ headers: {}, cookies: { [Access.COOKIE]: 'forged' } }, res, next);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(next).not.toHaveBeenCalled();
});

test.each(['bearer', 'cookie'])('accepts a current admin through a verified %s', async method => {
  const user = { uid: 'admin', admin: true };
  GoogleAuth.verifyRequest.mockResolvedValue(user);
  jest.spyOn(LocalAuth, 'verifyToken').mockReturnValue(user);
  UserSettings.isAdminUser.mockResolvedValue(true);
  const req = { headers: method === 'bearer' ? { authorization: 'Bearer test' } : {}, cookies: { [Access.COOKIE]: 'signed' } };
  await Access.authorize(req, res, next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(req).toMatchObject({ user, admin: true, editMode: true });
});

test('issues a scoped, HTTP-only secure session after authorization', () => {
  jest.spyOn(LocalAuth, 'signUser').mockReturnValue('signed');
  Access.createSession({ secure: true, user: { uid: 'admin' } }, res);
  expect(res.cookie).toHaveBeenCalledWith(Access.COOKIE, 'signed', expect.objectContaining({ path: '/admin', secure: true, httpOnly: true, sameSite: 'strict' }));
});

test('management controls exist only on the protected admin view', () => {
  const detail = read('views/sub-views/hadith_metadata.ejs');
  const admin = read('views/admin.ejs');
  expect(detail).not.toContain('data-hadith-pair-manager');
  for (const type of require('../lib/HadithBilingualPairs').TYPES)
    expect(admin).toContain(`data-hadith-pair-manager-open="${type}"`);
  expect(admin).toContain('noindex: true, nofollow: true');
  expect(read('app.js')).toContain("app.use('/admin', require('./routes/admin'))");
});
