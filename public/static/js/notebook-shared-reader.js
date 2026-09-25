(() => {
  'use strict';
  const article = document.querySelector('article.notebook-markdown');
  const outline = document.querySelector('.shared-note-outline');
  const zoom = document.getElementById('shared-note-zoom');
  const output = document.getElementById('shared-note-zoom-value');
  if (!article || !zoom) return;
  const links = Array.from(outline?.querySelectorAll('a[href^="#"]') || []);
  const headings = links.map(link => document.getElementById(link.hash.slice(1)));
  const mobile = window.matchMedia('(max-width: 767.98px)');
  let frame = null, active = -1;
  function update() {
    frame = null;
    if (!headings.length) return;
    const top = mobile.matches ? outline.getBoundingClientRect().height + 24 : 24;
    let next = 0;
    headings.forEach((heading, index) => { if (heading.getBoundingClientRect().top <= top) next = index; });
    if (window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) next = headings.length - 1;
    if (next === active) return;
    active = next;
    links.forEach((link, index) => {
      if (index === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    // Reveal the active outline entry without scrolling the document itself.
    const selected = links[active].getBoundingClientRect(), bounds = outline.getBoundingClientRect();
    const labelHeight = outline.querySelector('h2').getBoundingClientRect().height;
    if (selected.top < bounds.top + labelHeight) outline.scrollTop += selected.top - bounds.top - labelHeight;
    else if (selected.bottom > bounds.bottom) outline.scrollTop += selected.bottom - bounds.bottom;
  }
  function schedule() { if (frame === null) frame = requestAnimationFrame(update); }
  zoom.addEventListener('input', () => {
    article.style.setProperty('--shared-note-scale', Number(zoom.value) / 100);
    output.value = `${zoom.value}%`;
    schedule();
  });
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('hashchange', schedule);
  window.addEventListener('load', schedule);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(schedule).observe(article);
  document.fonts?.ready.then(schedule);
  schedule();
})();
