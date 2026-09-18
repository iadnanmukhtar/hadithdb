(() => {
  'use strict';
  const selector = '.hadith-bookmark-btn, .heading-bookmark-btn, .tafsir-bookmark-btn, .quran-mushaf-bookmark-btn, .hadith-like-btn, .personal-note-btn, .reflection-count-link, .reflection-disclosure-summary, .comment-vote, .comment-reply, .comment-edit, .comment-delete, .comment-submit-btn';
  let signedIn = false, revision = 0;
  function apply(root = document) {
    const controls = [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
    for (const control of controls) {
      if (signedIn) control.removeAttribute('aria-disabled');
      else control.setAttribute('aria-disabled', 'true');
    }
  }
  async function sync() {
    const ownRevision = ++revision;
    let token = null;
    try { token = await window.hadithAuth?.getToken(); } catch (_) { /* Signed out. */ }
    if (ownRevision !== revision) return;
    signedIn = !!token;
    document.documentElement.dataset.accountSignedIn = String(signedIn);
    apply();
  }
  document.addEventListener('click', event => {
    if (signedIn || !event.target.closest(selector)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (window.hadithAuth?.requireToken) window.hadithAuth.requireToken('Please sign in to use this feature.');
  }, true);
  document.addEventListener('hadithAuthChanged', sync);
  window.addEventListener('focus', sync);
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) apply(node);
  }).observe(document.body, { childList: true, subtree: true });
  sync();
})();
