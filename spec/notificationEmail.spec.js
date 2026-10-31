'use strict';
const {render} = require('../lib/NotificationEmail');
const source={subject:'Kindness <script>alert(1)</script>',url:'https://example.com/bukhari:1#comments'};
test.each(['like','unlike','reflection','reply','up','down','article'])('%s is concise, escaped and contains no account or device metadata',kind=>{
  const message=render({kind,actor:{name:'Amina Smith',email:'private@example.com',provider:'google.com'},source,preview:'word '.repeat(200),ip:'192.0.2.1',ua:'Secret browser'});
  expect(message.html).not.toContain('<script>');
  expect(message.html).toContain('&lt;script&gt;');
  expect(message.text).toContain(source.url);
  expect(message.text.length).toBeLessThan(500);
  expect(message.html + message.text).not.toMatch(/private@example|google.com|192\.0\.2|Secret browser|Smith|Conversation history/);
});
test('article includes unsubscribe in both alternatives',()=>{
  const mail=render({kind:'article',source,unsubscribe:'https://example.com/unsubscribe/token'});
  expect(mail.html).toContain('href="https://example.com/unsubscribe/token"');
  expect(mail.text).toContain('Unsubscribe: https://example.com/unsubscribe/token');
});
test('unsafe links cannot become executable email markup',()=>{
  const mail=render({kind:'like',source:{subject:'Title',url:'javascript:alert(1)'},unsubscribe:'javascript:alert(2)'});
  expect(mail.html).not.toContain('javascript:');
});
