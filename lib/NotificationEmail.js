'use strict';
const publicName = require('./CommunityName');
const escape = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function excerpt(value) {
  const text = String(value || '').replace(/\s+/gu, ' ').trim();
  return text.length > 220 ? text.slice(0, 217).trimEnd() + '…' : text;
}
function link(value) {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch (_) { return ''; }
}
function render({ kind, actor, source, preview, unsubscribe, noun = 'reflection' }) {
  const name = publicName(actor?.name, actor?.custom_name);
  const title = String(source.subject || '').replace(/[\r\n]/g, ' ');
  const messages = {
    like: [`New like: ${title}`, `${name} liked`],
    unlike: [`Like removed: ${title}`, `${name} removed a like from`],
    reflection: [`New ${noun}: ${title}`, `${name} shared a ${noun} on`],
    reply: [`New reply: ${title}`, `${name} replied in your conversation on`],
    up: [`New reaction: ${title}`, `${name} liked a ${noun} on`],
    down: [`New reaction: ${title}`, `${name} disliked a ${noun} on`],
    article: [`${name}: ${title}`, `${name} published`]
  };
  if (!messages[kind]) throw new Error('Unknown notification kind');
  const [subject, introduction] = messages[kind];
  const url = link(source.url), unsubscribeUrl = link(unsubscribe);
  const label = kind === 'article' ? 'Read article' : ['reflection','reply','up','down'].includes(kind) ? 'View conversation' : 'View on Hadith Unlocked';
  const shortPreview = excerpt(preview);
  const brand = global.settings?.site?.name || 'Hadith Unlocked';
  const text = `${introduction} ${title}.\n\n${shortPreview ? shortPreview + '\n\n' : ''}${url ? label + ': ' + url + '\n\n' : ''}${brand}${unsubscribeUrl ? '\nUnsubscribe: ' + unsubscribeUrl : ''}`;
  const p = 'margin:0 0 20px;color:#363737;font-size:16px;line-height:26px;';
  const anchor = 'color:#40180b;text-decoration:underline;';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#fff;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 20px;"><table role="presentation" width="550" cellspacing="0" cellpadding="0" style="width:100%;max-width:550px;"><tr><td style="font-family:Georgia,'Times New Roman',serif;overflow-wrap:anywhere;"><p dir="auto" style="${p}">${escape(introduction)} <strong>${escape(title)}</strong>.</p>${shortPreview ? `<p dir="auto" style="${p}">${escape(shortPreview)}</p>` : ''}${url ? `<p style="${p}"><a href="${escape(url)}" style="${anchor}">${label}</a></p>` : ''}</td></tr><tr><td style="padding:24px 0;text-align:center;font:12px/18px Arial,sans-serif;color:#777;">${escape(brand)}${unsubscribeUrl ? `<br><a href="${escape(unsubscribeUrl)}" style="color:#777;text-decoration:underline;">Unsubscribe from this author</a>` : ''}<!--notification-preferences--></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html, notificationCategory: {like:'likes', unlike:'likes', reflection:'reflections', reply:'replies', up:'reactions', down:'reactions', article:'articles'}[kind] };
}
module.exports = { render, excerpt };
