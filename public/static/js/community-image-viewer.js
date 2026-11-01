(function () {
  'use strict';
  const page = document.querySelector('#community:is([data-view="post"], [data-view="blog-article"], [data-view="mine"], [data-view="author"])');
  if (!page) return;
  let dialog, preview, opener;
  function fitImage() {
    if (!dialog?.open || !preview.naturalWidth) return;
    const stage = dialog.querySelector('.community-image-viewer-stage');
    const bounds = stage.getBoundingClientRect();
    const scale = Math.min(
      Math.max(1, window.innerHeight * 0.3 / preview.naturalHeight),
      bounds.width / preview.naturalWidth,
      bounds.height / preview.naturalHeight
    );
    preview.style.width = `${preview.naturalWidth * scale}px`;
    preview.style.height = `${preview.naturalHeight * scale}px`;
  }
  function open(image, trigger) {
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'community-image-viewer';
      dialog.setAttribute('aria-label', 'Image viewer');
      dialog.innerHTML = '<button type="button" class="community-image-viewer-close" data-image-close aria-label="Close image viewer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><div class="community-image-viewer-stage"><img alt=""></div>';
      document.body.append(dialog);
      preview = dialog.querySelector('img');
      dialog.querySelector('[data-image-close]').addEventListener('click', () => dialog.close());
      preview.addEventListener('load', fitImage);
      new ResizeObserver(fitImage).observe(dialog.querySelector('.community-image-viewer-stage'));
      dialog.addEventListener('click', event => {
        if (event.target === dialog || event.target.classList.contains('community-image-viewer-stage')) dialog.close();
      });
      dialog.addEventListener('close', () => {
        if (!dialog.open) { preview.removeAttribute('src'); opener?.focus(); }
      });
    }
    opener = trigger;
    preview.src = image.dataset.fullSrc || image.currentSrc || image.src;
    preview.alt = image.alt || trigger.getAttribute('aria-label') || 'Image';
    preview.referrerPolicy = 'no-referrer';
    dialog.showModal();
    fitImage();
  }
  const imageTargets = '.community-author-rail .community-avatar, #community-author-avatar, #community-wall-avatar, .blog-cover-hero .community-avatar';
  const targets = ['post', 'blog-article'].includes(page.dataset.view) ? imageTargets + ', .community-editor-cover' : imageTargets;
  page.querySelectorAll(targets).forEach(container => {
    function viewImage() {
      const img = container.querySelector('img');
      if (img) open(img, container);
    }
    container.removeAttribute('aria-hidden');
    container.setAttribute('role', 'button');
    container.setAttribute('tabindex', '0');
    container.setAttribute('aria-haspopup', 'dialog');
    container.setAttribute('aria-label', container.classList.contains('community-editor-cover') ? 'View cover image' : 'View profile image');
    container.classList.add('community-image-trigger');
    container.addEventListener('click', viewImage);
    container.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); viewImage(); }
    });
  });
  page.querySelectorAll('.blog-cover-hero').forEach(cover => {
    const img = cover.querySelector('.community-cover-image');
    if (!img) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'community-cover-image-trigger';
    button.setAttribute('aria-label', 'View cover image');
    button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', () => open(img, button));
    cover.append(button);
  });
})();
