(() => {
  const home = document.getElementById('sunnah-reminder');
  const dialog = document.getElementById('sunnah-dialog');
  const triggers = [...document.querySelectorAll('[data-sunnah-open]')];
  const card = document.getElementById('sunnah-card-template').content.firstElementChild.cloneNode(true);
  const action = name => card.querySelector('[data-sunnah-action="' + name + '"]');
  const key = 'sunnah-reminder';
  function read(store, name) {
    try { return window[store].getItem(name); } catch { return null; }
  }
  function write(store, name, value) {
    try { window[store].setItem(name, value); } catch { /* Private browsing. */ }
  }

  let minimized = !home || read('sessionStorage', key + '-layout') !== 'inline';
  let current;
  let opener;
  let loading = false;

  function layout() {
    for (const trigger of triggers) trigger.hidden = !(current && minimized);
    if (home) home.hidden = !current || minimized;
    action('minimize').hidden = minimized;
    action('restore').hidden = !minimized;
    const slot = minimized ? dialog.querySelector('[data-sunnah-modal-slot]') : home?.querySelector('[data-sunnah-slot]');
    if (slot && card.parentNode !== slot) slot.append(card);
    updateDetails();
  }

  function updateDetails() {
    for (const body of card.querySelectorAll('[data-sunnah-text]')) {
      if (!body.clientHeight) continue;
      const link = body.parentElement.querySelector('[data-sunnah-detail]');
      link.hidden = body.scrollHeight <= body.clientHeight + 1;
    }
  }

  function visibleTrigger() {
    return triggers.find(trigger => trigger.getClientRects().length);
  }

  function animateDialog(opening) {
    const trigger = visibleTrigger();
    if (!trigger || !dialog.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
    const source = dialog.getBoundingClientRect();
    const target = trigger.getBoundingClientRect();
    const dx = target.x + target.width / 2 - source.x - source.width / 2;
    const dy = target.y + target.height / 2 - source.y - source.height / 2;
    const small = { transform: `translate(${dx}px, ${dy}px) scale(.08)`, opacity: .12 };
    const full = { transform: 'none', opacity: 1 };
    return dialog.animate(opening ? [small, full] : [full, small], { duration: 240, easing: 'ease-in-out' }).finished.catch(() => {});
  }

  function openReminder() {
    if (!current || dialog.open) return;
    opener = visibleTrigger();
    dialog.showModal();
    updateDetails();
    animateDialog(true);
  }

  let closing = false;
  async function minimizeDialog() {
    if (closing || !dialog.open) return;
    closing = true;
    await animateDialog(false);
    dialog.close();
    closing = false;
  }

  async function load(another = false) {
    if (loading || (!home && !minimized)) return;
    loading = true;
    const params = new URLSearchParams(read('sessionStorage', key) || '');
    if (current) {
      params.set('id', current.id);
      params.set('day', current.day);
    }
    if (another) params.set('another', '1');
    try {
      const response = await fetch('/reminders/sunnah?' + params, { cache: 'no-store' });
      if (!response.ok) throw new Error();
      if (response.status === 204) {
        current = null;
        dialog.close();
      } else {
        const next = await response.json();
        card.querySelector('[data-sunnah-text="ar"]').innerHTML = next.arabic;
        card.querySelector('[data-sunnah-text="en"]').innerHTML = next.english;
        const ref = card.querySelector('[data-sunnah-ref]');
        ref.textContent = 'Mujtaba ' + next.num;
        ref.href = '/mujtaba:' + encodeURIComponent(next.num);
        for (const link of card.querySelectorAll('[data-sunnah-detail]')) link.href = ref.href;
        action('another').hidden = !next.more;
        current = next;
        write('sessionStorage', key, new URLSearchParams({ day: next.day, id: next.id }).toString());
        if (another) card.querySelector('[role=status]').textContent = ref.textContent;
      }
      layout();
    } catch {
      card.querySelector('[role=status]').textContent = 'Unable to load the reminder. Please try again.';
    } finally {
      loading = false;
    }
  }

  for (const trigger of triggers) trigger.addEventListener('click', () => {
    openReminder();
    if (current.day !== Math.floor(Date.now() / 86400000)) load();
  });
  dialog.querySelector('[data-sunnah-close]').addEventListener('click', minimizeDialog);
  dialog.addEventListener('cancel', event => { event.preventDefault(); minimizeDialog(); });
  dialog.addEventListener('close', () => {
    if (minimized) (opener?.offsetWidth ? opener : triggers.find(el => el.offsetWidth))?.focus();
  });
  action('another').addEventListener('click', () => load(true));
  action('minimize').addEventListener('click', () => {
    minimized = true;
    write('sessionStorage', key + '-layout', 'minimized');
    layout();
    triggers.find(el => el.offsetWidth)?.focus();
  });
  action('restore').addEventListener('click', () => {
    minimized = false;
    write('sessionStorage', key + '-layout', 'inline');
    dialog.close();
    layout();
    if (home) home.focus();
    else location.assign('/#sunnah-reminder');
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      minimized = !home || read('sessionStorage', key + '-layout') !== 'inline';
      current = null;
      dialog.close();
      layout();
      load();
    }
  });
  for (const body of card.querySelectorAll('[data-sunnah-text]')) {
    body.addEventListener('click', event => {
      const link = body.parentElement.querySelector('[data-sunnah-detail]');
      if (!link.hidden && !event.target.closest('a, button') && !window.getSelection()?.toString()) location.assign(link.href);
    });
  }
  if (window.ResizeObserver) new ResizeObserver(updateDetails).observe(card);
  document.fonts?.ready.then(updateDetails);
  // A session cookie shares dismissal across tabs and survives same-session reloads.
  function firstVisit() {
    if (!current || document.cookie.split('; ').includes('sunnah_session_seen=1') || read('sessionStorage', key + '-seen')) return;
    minimized = true;
    layout();
    openReminder();
    if (dialog.open) {
      document.cookie = 'sunnah_session_seen=1; Path=/; SameSite=Lax';
      write('sessionStorage', key + '-seen', '1');
    }
  }
  load().then(async () => {
    if (navigator.locks) await navigator.locks.request('sunnah-first-visit', firstVisit);
    else firstVisit();
    if (home && !home.hidden && location.hash === '#sunnah-reminder') home.focus();
  });
})();
