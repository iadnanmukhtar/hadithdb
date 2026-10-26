/* global quranApiPath */
(() => {
  'use strict';
  const badges = [...document.querySelectorAll('[data-community-alert-badge]')];
  if (!badges.length) return;
  const panel = document.getElementById('community-alerts');
  const list = panel?.querySelector('[data-community-alert-list]');
  const more = panel?.querySelector('[data-community-alert-more]');
  const status = panel?.querySelector('[data-community-alert-status]');
  let generation = 0, controller = null, loading = false, shown = 20, items = [], timer;
  const labels = new Map(badges.map(badge => [badge, badge.closest('a').textContent.trim()]));
  function badgeCount(value) {
    const count = Math.max(0, Number(value) || 0);
    for (const badge of badges) {
      badge.hidden = count === 0;
      badge.textContent = count > 99 ? '99+' : String(count || '');
      const label = count + (count === 1 ? ' unread alert' : ' unread alerts');
      badge.title = label; badge.setAttribute('aria-label', label);
      badge.closest('a').setAttribute('aria-label', labels.get(badge) + (count ? ', ' + label : ''));
    }
  }
  function render() {
    if (!list) return;
    list.replaceChildren(); panel.hidden = !items.length;
    const verbs = { post: 'published', reply: 'replied on', reflection: 'reflected on', like: 'liked', dislike: 'reacted to', repost: 'reposted' };
    for (const item of items.slice(0, shown)) {
      const link = document.createElement('a'); link.className = 'community-alert-row';
      // Alert destinations must stay on this site's public content routes.
      if (!/^\/(?!\/)/.test(item.url || '')) continue;
      link.href = item.url;
      const label = document.createElement('span'); label.dir = 'auto';
      label.textContent = `${item.author.name} ${verbs[item.kind] || 'updated'} ${item.title}.`;
      link.append(label);
      const date = new Date(item.createdAt);
      if (Number.isFinite(date.getTime())) { const time = document.createElement('time'); time.dateTime = date.toISOString(); time.textContent = date.toLocaleString(); link.append(time); }
      list.append(link);
    }
    more.hidden = shown >= items.length;
  }
  async function refresh() {
    if (loading || document.visibilityState === 'hidden') return;
    const own = generation;
    loading = true;
    const request = new AbortController(); controller = request;
    try {
      const token = await window.hadithAuth?.getToken();
      if (own !== generation) return;
      if (!token) { badgeCount(0); items = []; render(); return; }
      const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
      const response = await fetch(quranApiPath('/community/alerts'), { credentials: 'same-origin', cache: 'no-store', headers, signal: request.signal });
      if (!response.ok) throw new Error('Unable to load alerts.');
      const data = await response.json();
      if (own !== generation) return;
      badgeCount(data.count);
      if (list) {
        if (data.items.length) {
          const unique = new Map(data.items.map(item => [item.id, item]));
          for (const item of items) if (!unique.has(item.id)) unique.set(item.id, item);
          items = [...unique.values()].slice(0, 101); render();
        }
        status.textContent = data.hasMore ? 'Showing the most recent alerts.' : '';
        // Only acknowledge a successfully displayed batch in the visible Following page.
        if (data.count && document.visibilityState !== 'hidden') {
          const read = await fetch(quranApiPath('/community/alerts/read'), { method: 'PUT', credentials: 'same-origin', cache: 'no-store', headers,
            body: JSON.stringify({ through: data.through }), signal: request.signal });
          if (!read.ok) throw new Error('Could not mark these alerts as read.');
          if (own === generation) badgeCount(0);
        }
      }
    } catch (err) {
      if (own === generation && err.name !== 'AbortError' && status) { panel.hidden = false; status.textContent = err.message; }
    } finally {
      if (own === generation) { loading = false; controller = null; }
    }
  }
  more?.addEventListener('click', () => { shown += 20; render(); });
  document.addEventListener('hadithAuthChanged', () => {
    generation++; controller?.abort(); loading = false; items = []; shown = 20; badgeCount(0); render();
    if (status) status.textContent = '';
    refresh();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') refresh(); });
  window.addEventListener('focus', refresh);
  window.addEventListener('pagehide', () => { clearInterval(timer); controller?.abort(); });
  timer = window.setInterval(refresh, 60000);
  refresh();
})();
