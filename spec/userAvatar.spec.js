'use strict';
const Avatar=require('../lib/UserAvatar');
test('profile photos only accept bounded HTTPS URLs without credentials',()=>{
  expect(Avatar.photoUrl('https://example.test/photo.png')).toBe('https://example.test/photo.png');
  for(const value of ['javascript:alert(1)','data:image/svg+xml,<svg/>','http://example.test/a','https://user:pass@example.test/a','https://example.test/'+ 'a'.repeat(2050),null]) expect(Avatar.photoUrl(value)).toBeNull();
});
test('Gravatar normalizes email and never includes the address in its URL',()=>{
  expect(Avatar.gravatar(' Alice@Example.com ')).toBe(Avatar.gravatar('alice@example.com'));
  expect(Avatar.gravatar('alice@example.com')).not.toContain('alice');
  expect(Avatar.gravatar()).toBe('https://www.gravatar.com/avatar/?d=mp&s=96');
});
