(() => {
  'use strict';
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-community-share-url]');
    if (!trigger) return;
    const url = new URL(trigger.dataset.communityShareUrl, location.origin);
    if (url.origin !== location.origin || !/^\/(community|blog)\//.test(url.pathname)) return;
    const title = trigger.dataset.communityShareTitle || 'Community post';
    let pane = document.getElementById('community-social-share');
    if (!pane) {
      pane = document.createElement('dialog');
      pane.id = 'community-social-share';
      pane.className = 'content-share-pane';
      pane.setAttribute('aria-labelledby', 'community-social-share-heading');
      pane.innerHTML = '<header><h2 id="community-social-share-heading">Share</h2><button type="button" class="content-share-close" aria-label="Close"><i class="bi bi-x-lg" aria-hidden="true"></i></button></header><p class="content-share-source" dir="auto"></p><div class="content-share-options"></div><p class="content-share-status" role="status" aria-live="polite"></p>';
      document.body.append(pane);
      pane.querySelector('.content-share-close').addEventListener('click', () => pane.close());
      pane.addEventListener('click', e => {
        const rect = pane.getBoundingClientRect();
        if (e.target === pane && (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)) pane.close();
      });
    }
    pane.querySelector('.content-share-source').textContent = title;
    const status = pane.querySelector('.content-share-status');
    status.textContent = '';
    const options = pane.querySelector('.content-share-options');
    options.replaceChildren();
    const choices = [
      ...window.contentSocialShareOptions(title, url.href),
      ['Copy link', 'link-45deg', async () => {
        try {
          await navigator.clipboard.writeText(url.href);
          status.textContent = 'Link copied';
        } catch (_) {
          status.textContent = 'Copy this link: ';
          const input = document.createElement('input');
          input.className = 'form-control'; input.readOnly = true; input.value = url.href;
          input.setAttribute('aria-label', 'Link to share'); status.append(input); input.focus(); input.select();
        }
      }]
    ];
    if (navigator.share) choices.push(['More…', 'three-dots', () => navigator.share({ title, url: url.href })]);
    options.style.setProperty('--share-option-count', choices.length);
    for (const [label, glyph, action] of choices) {
      const control = document.createElement(typeof action === 'string' ? 'a' : 'button');
      if (typeof action === 'string') { control.href = action; control.target = '_blank'; control.rel = 'noopener noreferrer'; }
      else {
        control.type = 'button';
        control.addEventListener('click', async () => {
          try { await action(); } catch (error) { if (error.name !== 'AbortError') status.textContent = 'Unable to share. Please try copying the link.'; }
        });
      }
      const icon = document.createElement('i'); icon.className = 'bi bi-' + glyph; icon.setAttribute('aria-hidden', 'true');
      if (glyph === 'threads' || glyph === 'twitter-x') { icon.className = 'community-social-letter'; icon.textContent = glyph === 'threads' ? '@' : '𝕏'; icon.style.fontStyle = 'normal'; }
      const text = document.createElement('span'); text.textContent = label;
      control.append(icon, text); options.append(control);
    }
    pane.showModal();
  });
})();
