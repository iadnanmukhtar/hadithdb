(() => {
  'use strict';
  const modal = document.getElementById('notebook-modal');
  if (!modal) return;
  const storageKey = 'notebook-sidebar-layout';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch (_) {}
  const panels = ['notebook-navigator', 'notebook-outline'].map(id => {
    const panel = document.getElementById(id);
    const toggle = panel.querySelector('[data-notebook-sidebar]');
    const handle = panel.querySelector('[data-notebook-resize]');
    const content = panel.querySelector('.notebook-sidebar-content');
    const label = id === 'notebook-navigator' ? 'recent notes' : 'heading outline';
    return { id, panel, toggle, handle, content, label, width: Number(saved[id]?.width) || null, collapsed: saved[id]?.collapsed === true };
  });
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(panels.map(p => [p.id, { width: p.width, collapsed: p.collapsed }])))); } catch (_) {}
  }
  function paint(p) {
    p.panel.classList.toggle('notebook-sidebar-collapsed', p.collapsed);
    p.content.hidden = p.collapsed;
    p.toggle.setAttribute('aria-expanded', String(!p.collapsed));
    p.toggle.title = `${p.collapsed ? 'Expand' : 'Collapse'} ${p.label}`;
    p.toggle.setAttribute('aria-label', p.toggle.title);
    const left = p.id === 'notebook-navigator';
    p.toggle.firstElementChild.className = `bi bi-chevron-${left !== p.collapsed ? 'left' : 'right'}`;
    if (p.width) p.panel.style.setProperty('--sidebar-width', `${p.width}px`);
  }
  function maximum(p) {
    const body = modal.querySelector('.modal-body').getBoundingClientRect().width || window.innerWidth;
    const other = panels.find(entry => entry !== p);
    const otherWidth = other.panel.hidden ? 0 : other.panel.getBoundingClientRect().width;
    return Math.max(140, Math.min(420, body - otherWidth - 400));
  }
  function resize(p, width) {
    p.width = Math.round(Math.max(140, Math.min(maximum(p), width)));
    paint(p);
    p.handle.setAttribute('aria-valuenow', String(p.width));
    p.handle.setAttribute('aria-valuemax', String(Math.round(maximum(p))));
  }
  for (const p of panels) {
    paint(p);
    p.toggle.addEventListener('click', () => {
      p.collapsed = !p.collapsed; paint(p); persist();
      window.dispatchEvent(new Event('resize'));
    });
    p.handle.addEventListener('keydown', event => {
      const direction = p.id === 'notebook-navigator' ? 1 : -1;
      let width = p.panel.getBoundingClientRect().width;
      if (event.key === 'ArrowRight') width += 20 * direction;
      else if (event.key === 'ArrowLeft') width -= 20 * direction;
      else if (event.key === 'Home') width = 140;
      else if (event.key === 'End') width = maximum(p);
      else return;
      event.preventDefault(); resize(p, width); persist();
    });
    p.handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || window.innerWidth < 768) return;
      event.preventDefault();
      const start = event.clientX, width = p.panel.getBoundingClientRect().width;
      p.handle.setPointerCapture(event.pointerId);
      modal.classList.add('notebook-sidebar-dragging');
      const move = moveEvent => resize(p, width + (moveEvent.clientX - start) * (p.id === 'notebook-navigator' ? 1 : -1));
      const stop = () => {
        p.handle.removeEventListener('pointermove', move);
        p.handle.removeEventListener('pointerup', stop);
        p.handle.removeEventListener('pointercancel', stop);
        p.handle.removeEventListener('lostpointercapture', stop);
        modal.classList.remove('notebook-sidebar-dragging'); persist();
      };
      p.handle.addEventListener('pointermove', move);
      p.handle.addEventListener('pointerup', stop);
      p.handle.addEventListener('pointercancel', stop);
      p.handle.addEventListener('lostpointercapture', stop);
    });
  }
  function fit() {
    if (window.innerWidth < 768 || !modal.classList.contains('show')) return;
    for (const p of panels) if (!p.panel.hidden && !p.collapsed) resize(p, p.width || p.panel.getBoundingClientRect().width);
  }
  modal.addEventListener('shown.bs.modal', fit);
  window.addEventListener('resize', fit);
  for (const p of panels) new MutationObserver(fit).observe(p.panel, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(fit).observe(modal.querySelector('.modal-dialog'), { attributes: true, attributeFilter: ['class'] });
})();
