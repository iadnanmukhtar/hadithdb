'use strict';
const Community = require('./Community');
const nodemailer = require('nodemailer');
function siteUrl() {
  const base = new URL(global.settings.site.url);
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Configure a valid site URL for community email.');
  return base.origin;
}
async function deliverBatch({ transport, limit = 25 } = {}) {
  await Community.ensure();
  const smtp = global.settings?.smtp;
  if (!transport && (!smtp?.host || !smtp?.from)) throw new Error('Configure SMTP host and from before running community mail.');
  const mailer = transport || nodemailer.createTransport({ host: smtp.host, port: Number(smtp.port || 587), secure: smtp.secure === true || smtp.secure === 'true', auth: smtp.auth });
  const base = siteUrl();
  // An expired lease is retried after a worker exits unexpectedly.
  await Community.sql("UPDATE community_email_outbox SET status='queued', locked_at=NULL WHERE status='sending' AND locked_at<DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 MINUTE)");
  const result = { sent: 0, skipped: 0, failed: 0 };
  for (let i = 0; i < Math.min(Math.max(limit, 1), 100); i++) {
    const job = await Community.transaction(async q => {
      const row = (await q("SELECT * FROM community_email_outbox WHERE status='queued' AND available_at<=CURRENT_TIMESTAMP(3) AND attempts<5 ORDER BY id LIMIT 1 FOR UPDATE"))[0];
      if (!row) return null;
      await q("UPDATE community_email_outbox SET status='sending', attempts=attempts+1, locked_at=CURRENT_TIMESTAMP(3) WHERE id=?", [row.id]);
      return row;
    });
    if (!job) break;
    try {
      // Recheck subscription, account email and publication immediately before delivery.
      const row = (await Community.sql(`SELECT p.id, p.guid, p.public_title, p.public_markdown, a.name, a.custom_name, a.handle,
        reader.email, f.unsubscribe_token FROM community_posts p JOIN community_authors a ON a.uid=p.author_uid
        JOIN community_follows f ON f.author_uid=p.author_uid AND f.follower_uid=?
        JOIN community_authors reader ON reader.uid=f.follower_uid
        WHERE p.id=? AND p.status='published' AND p.kind='article' AND p.notify_email=1 AND f.email_enabled=1 AND reader.email IS NOT NULL`, [job.follower_uid, job.post_id]))[0];
      if (!row) { await Community.sql("UPDATE community_email_outbox SET status='skipped', locked_at=NULL WHERE id=?", [job.id]); result.skipped++; continue; }
      const title = Community.displayTitle(row.public_title, Community.content(row.public_markdown).html, 'article');
      const unsubscribe = `${base}/community/unsubscribe/${row.unsubscribe_token}`;
      const url = base + require('./CommunityPostIdentity').url(row);
      const host = new URL(base).hostname;
      await mailer.sendMail({ from: smtp?.from, to: row.email,
        subject: `${require('./CommunityName')(row.name, row.custom_name)}: ${title}`.replace(/[\r\n]/g, ' '),
        messageId: `<community-${job.id}@${host}>`,
        text: `${title}\nBy ${require('./CommunityName')(row.name, row.custom_name)}\n\n${Community.content(row.public_markdown).excerpt}\n\nRead and discuss: ${url}\n\nYou subscribed to this author on HadithDB.\nUnsubscribe from this author's emails: ${unsubscribe}`,
        headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
      await Community.sql("UPDATE community_email_outbox SET status='sent', sent_at=CURRENT_TIMESTAMP(3), locked_at=NULL WHERE id=?", [job.id]); result.sent++;
    } catch (_) {
      await Community.sql("UPDATE community_email_outbox SET status=IF(attempts>=5,'failed','queued'), locked_at=NULL, available_at=DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 15 MINUTE) WHERE id=?", [job.id]); result.failed++;
    }
  }
  return result;
}
module.exports = { deliverBatch };
