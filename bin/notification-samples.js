#!/usr/bin/env node
'use strict';
// Preview by default. Explicit --send delivers only to the supplied recipient.
const fs = require('fs');
const path = require('path');
const { render } = require('../lib/NotificationEmail');
const cases = [
  ['like-admin', 'like'], ['like-participant', 'like'], ['like-removed', 'unlike'],
  ['reflection', 'reflection'], ['reflection-reply', 'reply'],
  ['reflection-liked-admin', 'up'], ['reflection-liked-participant', 'up'],
  ['reflection-disliked-admin', 'down'], ['reflection-disliked-participant', 'down'],
  ['blog-comment', 'reflection', 'comment'], ['blog-reply', 'reply', 'comment'],
  ['blog-comment-liked-admin', 'up', 'comment'], ['blog-comment-liked-participant', 'up', 'comment'],
  ['blog-comment-disliked-admin', 'down', 'comment'], ['blog-comment-disliked-participant', 'down', 'comment'],
  ['new-article', 'article']
];
async function main() {
  const send = process.argv.includes('--send');
  const recipient = process.argv.find(arg => arg.startsWith('--to='))?.slice(5);
  if (send && !recipient) throw new Error('--send requires --to=email');
  const settings = JSON.parse(fs.readFileSync(path.join(require('os').homedir(), '.hadithdb/settings.json'), 'utf8'));
  global.settings = settings;
  const base = settings.site.url.replace(/\/$/, '');
  const out = path.resolve('temp/email-preview');
  fs.mkdirSync(out, {recursive:true});
  const smtp = settings.smtp;
  const transport = send ? require('nodemailer').createTransport({host:smtp.host, port:Number(smtp.port || 587), secure:smtp.secure === true || smtp.secure === 'true', auth:smtp.auth, connectionTimeout:15000, socketTimeout:30000}) : null;
  const results = [];
  for (const [id, kind, noun] of cases) {
    const message = render({kind, noun, actor:{name:'Amina'},
      source:{subject:noun === 'comment' || kind === 'article' ? 'Finding meaning in small acts of kindness' : 'Actions are judged by intentions · Bukhari 1', url:base + (noun === 'comment' || kind === 'article' ? '/community' : '/bukhari:1')},
      preview:['like','unlike'].includes(kind) ? '' : 'A small act of kindness can become something meaningful when we begin with a sincere intention.',
      // Preview anchor deliberately cannot unsubscribe any real reader.
      unsubscribe:kind === 'article' ? base + '/community#sample-unsubscribe' : undefined});
    const preferencesUrl = base + '/community/email-preferences';
    message.html = message.html.replace('<!--notification-preferences-->', `<br><a href="${preferencesUrl}" style="color:#777;text-decoration:underline;">Subscribe / unsubscribe / email preferences</a>`);
    message.text += `\n\nSubscribe / unsubscribe / email preferences: ${preferencesUrl}`;
    delete message.notificationCategory;
    message.subject = `[Sample ${results.length + 1}/${cases.length}: ${id}] ${message.subject}`;
    message.text = 'Sample notification — fictional activity for design review.\n\n' + message.text;
    message.html = message.html.replace('<body style="margin:0;background:#fff;">', '<body style="margin:0;background:#fff;"><p style="margin:16px 20px 0;text-align:center;font:12px Arial,sans-serif;color:#777;">Sample notification — fictional activity for design review.</p>');
    fs.writeFileSync(path.join(out, id + '.html'), message.html);
    fs.writeFileSync(path.join(out, id + '.txt'), message.text);
    if (transport) {
      const result = await transport.sendMail({from:smtp.from, to:recipient, ...message});
      results.push({id, accepted:result.accepted, rejected:result.rejected, messageId:result.messageId});
      fs.writeFileSync(path.join(out, 'delivery.json'), JSON.stringify(results, null, 2));
      console.log(JSON.stringify(results.at(-1)));
      if (result.rejected?.length) throw new Error('Sample recipient rejected; stopped sending');
    } else results.push({id});
  }
  console.log(`${results.length} samples ${send ? 'submitted' : 'rendered'}.`);
}
main().catch(err => {console.error(err.message);process.exitCode=1;});
