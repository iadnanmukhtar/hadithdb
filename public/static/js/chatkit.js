(function () {
  'use strict';
  const launcher = document.getElementById('library-chat-launcher');
  const panel = document.getElementById('library-chat-panel');
  if (!launcher || !panel) return;
  const inviteKey = 'hadithdb:chatInviteShown';
  const searchChatButtons = document.querySelectorAll('[data-library-chat-open]');

  function rememberInvitation() {
    try { window.sessionStorage.setItem(inviteKey, '1'); } catch (_) {}
  }

  function inviteOnce() {
    if (document.hidden || launcher.hidden) return;
    try {
      if (window.sessionStorage.getItem(inviteKey) === '1') return;
      // If storage is unavailable, skip rather than repeating on every page.
      window.sessionStorage.setItem(inviteKey, '1');
    } catch (_) { return; }
    if (!panel.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    launcher.classList.add('library-chat-invite');
    launcher.addEventListener('animationend', () => launcher.classList.remove('library-chat-invite'), { once: true });
  }

  function close() {
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus();
  }

  function open() {
    if (launcher.hidden) return;
    rememberInvitation();
    launcher.classList.remove('library-chat-invite');
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    document.getElementById('library-chat-close').focus();
  }

  launcher.addEventListener('click', () => {
    if (!panel.hidden) return close();
    open();
  });
  searchChatButtons.forEach(button => {
    button.addEventListener('click', () => {
      const dialog = button.closest('dialog');
      if (dialog && dialog.open) {
        // Wait for search's normal close/focus restoration before focusing chat.
        dialog.addEventListener('close', () => queueMicrotask(open), { once: true });
        dialog.close();
      } else {
        open();
      }
    });
  });
  document.getElementById('library-chat-close').addEventListener('click', close);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) close(); });
  document.getElementById('library-copy-mcp').addEventListener('click', async () => {
    const address = document.getElementById('library-mcp-url');
    const feedback = document.getElementById('library-chat-status');
    try {
      await navigator.clipboard.writeText(address.value);
      feedback.textContent = 'Library address copied.';
    } catch (_) {
      address.focus();
      address.select();
      feedback.textContent = 'Select and copy the library address above.';
    }
  });
  fetch('/api/chatkit/config', { credentials: 'same-origin', cache: 'no-store' })
    .then(response => response.ok ? response.json() : Promise.reject())
    .then(config => {
      if (config.handoffEnabled !== true) return;
      launcher.hidden = false;
      searchChatButtons.forEach(button => { button.hidden = false; });
      window.setTimeout(inviteOnce, 1600);
      document.addEventListener('visibilitychange', inviteOnce);
    }).catch(() => {});
})();
