(function () {
  'use strict';
  const launcher = document.getElementById('library-chat-launcher');
  const panel = document.getElementById('library-chat-panel');
  const status = document.getElementById('library-chat-status');
  const chat = document.getElementById('library-chat');
  if (!launcher || !panel || !chat) return;
  let settings;
  let loading;
  let initialized = false;
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

  function showStatus(message) {
    status.textContent = message;
    status.hidden = false;
  }

  function close() {
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus();
  }

  async function load() {
    if (initialized) return;
    if (!settings.configured) {
      showStatus('Library chat is being set up. Please check back soon.');
      return;
    }
    if (loading) return loading;
    loading = (async () => {
      showStatus('Loading chat…');
      if (!customElements.get('openai-chatkit')) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          const timer = setTimeout(() => reject(new Error('Chat loading timed out')), 20000);
          script.src = 'https://cdn.platform.openai.com/deployments/chatkit/chatkit.js';
          script.async = true;
          script.onload = () => { clearTimeout(timer); resolve(); };
          script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Chat could not load')); };
          document.head.appendChild(script);
        });
      }
      await Promise.race([
        customElements.whenDefined('openai-chatkit'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Chat loading timed out')), 15000))
      ]);
      chat.addEventListener('chatkit.error', () => showStatus('Chat could not connect. Please close it and try again shortly.'));
      chat.addEventListener('chatkit.ready', () => { status.hidden = true; });
      chat.addEventListener('chatkit.response.start', () => { status.hidden = true; });
      chat.setOptions({
        api: {
          url: '/api/chatkit', domainKey: settings.domainKey,
          fetch: async (url, options) => {
            const response = await fetch(url, { ...options, credentials: 'same-origin' });
            if (!response.ok) {
              const message = response.status === 429 ? 'Too many messages. Please wait a minute.'
                : response.status === 409 ? 'A reply is already in progress. Please wait.'
                  : 'Chat is temporarily unavailable. Please try again shortly.';
              showStatus(message);
            }
            return response;
          }
        },
        theme: { colorScheme: 'light', radius: 'round', color: { accent: { primary: '#2c9be5', level: 2 } } },
        header: { title: { text: 'Your conversations' } },
        history: { enabled: true },
        composer: { placeholder: 'Ask about a passage, reference, or topic…', attachments: { enabled: false } },
        startScreen: {
          greeting: 'What would you like to explore?',
          prompts: [
            { label: 'Hadith on intentions', prompt: 'Find the hadith about intentions and show its source.', icon: 'search' },
            { label: 'Explore an ayah', prompt: 'Show Quran 2:255 with its translation and a tafsir source.', icon: 'book-open' },
            { label: 'Compare tafsir', prompt: 'Compare two available tafsirs of Quran 94:5–6, with source links.', icon: 'book-open' }
          ]
        },
        threadItemActions: { feedback: false, retry: true },
        disclaimer: { text: 'AI can make mistakes. Check linked sources. Chats are sent to OpenAI and saved for this browser.' }
      });
      initialized = true;
      chat.hidden = false;
    })();
    try { await loading; } catch (_) {
      showStatus('Chat could not load. Close this panel and reopen it to try again.');
    } finally { loading = null; }
  }

  function open() {
    if (!settings || launcher.hidden) return;
    rememberInvitation();
    launcher.classList.remove('library-chat-invite');
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    document.getElementById('library-chat-close').focus();
    load();
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
  fetch('/api/chatkit/config', { credentials: 'same-origin' })
    .then(response => response.ok ? response.json() : Promise.reject())
    .then(config => {
      settings = config;
      // Keep the setup preview available locally; only advertise working configuration publicly.
      launcher.hidden = !config.enabled || (!config.configured && !['localhost', '127.0.0.1'].includes(location.hostname));
      searchChatButtons.forEach(button => { button.hidden = launcher.hidden; });
      if (!launcher.hidden) {
        window.setTimeout(inviteOnce, 1600);
        document.addEventListener('visibilitychange', inviteOnce);
      }
    }).catch(() => {});
})();
