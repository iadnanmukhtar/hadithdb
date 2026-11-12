'use strict';
// Never substitute render/deploy time for an unknown content revision.
function latest(values) {
  const times = values.flat(Infinity).filter(value => value !== null && value !== undefined && value !== '')
    .map(value => new Date(value).getTime()).filter(time => Number.isFinite(time) && time > 0 && time <= Date.now());
  return times.length ? new Date(Math.max(...times)).toISOString() : undefined;
}
function readers(items) {
  return latest((items || []).map(item => item.lastfixed));
}
function community(feed) {
  return latest((feed?.items || []).filter(item => !item.status || item.status === 'published')
    .flatMap(item => [item.publicUpdatedAt, item.activityAt, item.publishedAt, item.createdAt]));
}
function label(value) {
  return new Date(value).toLocaleString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' UTC';
}
module.exports = { latest, readers, community, label };
