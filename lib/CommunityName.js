'use strict';
// Only an explicitly chosen display name is shown in full. Legacy names remain
// first-name-only until compared with the verified account name.
function communityName(value, custom = false) {
  const name = String(value || '').trim();
  if (!name || /\S+@\S+/.test(name) || name === 'Community member') return 'Community member';
  return (custom === true || Number(custom) === 1 ? name : name.split(/\s+/u)[0]).slice(0, 120);
}
communityName.migrate = async function migrate(sql) {
  try { await sql('ALTER TABLE community_authors ADD COLUMN custom_name TINYINT NULL DEFAULT NULL'); }
  catch (err) { if (err.code !== 'ER_DUP_FIELDNAME') throw err; }
};
module.exports = communityName;
