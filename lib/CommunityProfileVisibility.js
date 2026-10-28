'use strict';
const error = require('http-errors');
async function migrate(sql) {
  try { await sql("ALTER TABLE community_authors ADD COLUMN profile_visibility VARCHAR(7) NOT NULL DEFAULT 'public'"); }
  catch (err) { if (err.code !== 'ER_DUP_FIELDNAME') throw err; }
}
function check(author, user) {
  if (!user?.uid) throw error(401, 'Please sign in to view profiles.');
  if (!author || (author.profile_visibility === 'private' && author.uid !== user.uid)) throw error(404, 'This profile is unavailable.');
}
function value(input, current = 'public') {
  const visibility = input === undefined ? current : input;
  if (!['public', 'private'].includes(visibility)) throw error(400, 'Choose Public or Private for your profile.');
  return visibility;
}
module.exports = {migrate,check,value};
