(() => {
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

  dialog.querySelector('[data-sunnah-modal-slot]').append(card);
  const excerpts = [...card.querySelectorAll('[data-sunnah-text]')];
  const originals = new Map();
  let current;
  let opener;
  const dayLength = 86400000;
  const utcDay = () => Math.floor(Date.now() / dayLength);
  let loadingDay;
  let timer;

  function scheduleRefresh(delay = dayLength - Date.now() % dayLength) {
    clearTimeout(timer);
    if (dialog.open) timer = setTimeout(refreshOpenDialog, delay);
  }

  function refreshOpenDialog() {
    if (!dialog.open) return;
    if (current?.day !== utcDay()) load();
    else scheduleRefresh();
  }

  function layout() {
    for (const trigger of triggers) trigger.hidden = !current;
    fitExcerpts();
  }

  function fitExcerpts() {
    if (!dialog.open || !card.clientWidth) return;
    for (const excerpt of excerpts) {
      const source = originals.get(excerpt);
      if (!source) continue;
      excerpt.replaceChildren(source.cloneNode(true));
      const row = excerpt.parentElement;
      const lines = parseFloat(getComputedStyle(excerpt.querySelector('p') || excerpt).lineHeight);
      const fits = () => row.offsetHeight <= lines * 3 + 1;
      if (fits()) continue;

      // Keep the reading paragraph and inline reference together when truncating.
      const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
      const ends = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const word of node.textContent.matchAll(/\S+/gu))
          ends.push([node, word.index + word[0].length]);
      }
      const range = document.createRange();
      range.setStart(source, 0);
      function renderPrefix(count) {
        if (!count) { excerpt.textContent = '…'; return; }
        range.setEnd(...ends[count - 1]);
        const fragment = range.cloneContents();
        const tail = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
        let last;
        while (tail.nextNode()) last = tail.currentNode;
        last.appendData('…');
        excerpt.replaceChildren(fragment);
      }
      let low = 0, high = ends.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        renderPrefix(mid);
        if (fits()) low = mid;
        else high = mid - 1;
      }
      renderPrefix(low);
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
    fitExcerpts();
    animateDialog(true);
    refreshOpenDialog();
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
    const day = utcDay();
    if (loadingDay === day) return;
    loadingDay = day;
    another = another && current?.day === day;
    const params = new URLSearchParams(read('sessionStorage', key) || '');
    if (current) {
      params.set('id', current.id);
      params.set('day', current.day);
    }
    if (another) params.set('another', '1');
    try {
      const response = await fetch('/reminders/sunnah?' + params, { cache: 'no-store' });
      if (loadingDay !== day || day !== utcDay()) return;
      if (!response.ok) throw new Error();
      if (response.status === 204) {
        current = null;
        if (dialog.open) dialog.close();
      } else {
        const next = await response.json();
        if (loadingDay !== day || day !== utcDay()) return;
        const ref = card.querySelector('[data-sunnah-ref]');
        ref.textContent = 'Mujtaba ' + next.num;
        ref.href = '/mujtaba:' + encodeURIComponent(next.num);
        for (const excerpt of excerpts) {
          const paragraph = document.createElement('p');
          paragraph.textContent = excerpt.dataset.sunnahText === 'ar' ? next.arabic : next.english;
          const source = document.createDocumentFragment();
          source.append(paragraph);
          originals.set(excerpt, source);
          excerpt.replaceChildren(source.cloneNode(true));
          excerpt.href = ref.href;
        }
        action('another').hidden = !next.more;
        current = next;
        write('sessionStorage', key, new URLSearchParams({ day: next.day, id: next.id }).toString());
        card.querySelector('[role=status]').textContent = another ? ref.textContent : '';
      }
      layout();
    } catch {
      if (loadingDay !== day || day !== utcDay()) return;
      card.querySelector('[role=status]').textContent = 'Unable to load the reminder. Please try again.';
    } finally {
      if (loadingDay === day) {
        loadingDay = undefined;
        if (day !== utcDay() && (dialog.open || !current)) return load();
        scheduleRefresh(current?.day === utcDay() ? undefined : 30000);
      }
    }
  }

  for (const trigger of triggers) trigger.addEventListener('click', openReminder);
  dialog.querySelector('[data-sunnah-close]').addEventListener('click', minimizeDialog);
  dialog.addEventListener('cancel', event => { event.preventDefault(); minimizeDialog(); });
  dialog.addEventListener('close', () => {
    clearTimeout(timer);
    (opener?.offsetWidth ? opener : triggers.find(el => el.offsetWidth))?.focus();
  });
  action('another').addEventListener('click', () => load(true));
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      if (dialog.open) refreshOpenDialog();
      else load();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshOpenDialog();
  });
  window.addEventListener('resize', fitExcerpts);
  document.fonts?.ready.then(fitExcerpts);
  // A session cookie shares dismissal across tabs and survives same-session reloads.
  function firstVisit() {
    if (!current || document.cookie.split('; ').includes('sunnah_session_seen=1') || read('sessionStorage', key + '-seen')) return;
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
  });
})();
