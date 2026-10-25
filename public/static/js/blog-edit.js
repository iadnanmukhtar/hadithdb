(() => {
  'use strict';
  let owner = null, epoch = 0;
  function render() {
    document.querySelectorAll('[data-blog-edit]').forEach(link => {
      const hidden = !owner || link.dataset.author !== owner;
      if (link.hidden !== hidden) link.hidden = hidden;
    });
  }
  async function refresh() {
    const current = ++epoch;
    owner = null; render();
    try {
      const token = await window.hadithAuth?.getToken?.();
      if (!token || current !== epoch) return;
      const response = await fetch('/api/community/me', {headers:{Authorization:'Bearer '+token},cache:'no-store'});
      if (!response.ok) return;
      const data = await response.json();
      if (current !== epoch) return;
      owner = data.author?.handle || null; render();
    } catch (_) { /* Public reading remains available without a session. */ }
  }
  document.addEventListener('hadithAuthChanged', refresh);
  new MutationObserver(render).observe(document.querySelector('main') || document.body,{childList:true,subtree:true});
  refresh();
})();
