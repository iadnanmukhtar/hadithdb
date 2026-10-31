'use strict';
const Preferences = require('./NotificationPreferences');
const addressparser = require('nodemailer/lib/addressparser');
function recipients(to) {
  const values = Array.isArray(to) ? to : [to];
  return [...new Set(values.flatMap(value => typeof value === 'object' && value?.address ? [value.address] : addressparser(String(value || ''), {flatten:true}).map(item => item.address)).filter(Boolean).map(email => email.trim().toLowerCase()))];
}
async function send(transport, message) {
  const {notificationCategory: category, ...mail} = message;
  if (!Object.hasOwn(Preferences.categories, category)) throw new Error('Missing email notification category');
  const results = [];
  for (const email of recipients(mail.to)) {
    const prefs = await Preferences.forEmail(email);
    if (!Number(prefs.enabled) || !Number(prefs[category])) continue;
    const base = new URL(global.settings.site.url).origin;
    const preferences = base + '/community/email-preferences';
    const unsubscribe = `${base}/community/email-unsubscribe/${prefs.unsubscribe_token}/${category}`;
    const footer = `<br><a href="${preferences}" style="color:#777;text-decoration:underline;">Subscribe / email preferences</a> · <a href="${unsubscribe}" style="color:#777;text-decoration:underline;">Unsubscribe from these emails</a>`;
    results.push(await transport.sendMail({...mail, to:email,
      html:mail.html.replace('<!--notification-preferences-->', footer),
      text:mail.text + `\n\nSubscribe / email preferences: ${preferences}\nUnsubscribe from these emails: ${unsubscribe}`,
      headers:{'List-Unsubscribe':`<${unsubscribe}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click',...mail.headers}}));
  }
  return {sent:results.length, results};
}
module.exports = {send, recipients};
