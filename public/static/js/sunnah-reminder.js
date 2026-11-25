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

  let minimized = read('localStorage', key) === 'minimized';
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
    opener = trigger;
    dialog.showModal();
    if (current.day !== Math.floor(Date.now() / 86400000)) load();
  });
  dialog.querySelector('[data-sunnah-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (minimized) (opener?.offsetWidth ? opener : triggers.find(el => el.offsetWidth))?.focus();
  });
  action('another').addEventListener('click', () => load(true));
  action('minimize').addEventListener('click', () => {
    minimized = true;
    write('localStorage', key, 'minimized');
    layout();
    triggers.find(el => el.offsetWidth)?.focus();
  });
  action('restore').addEventListener('click', () => {
    minimized = false;
    write('localStorage', key, 'inline');
    dialog.close();
    layout();
    if (home) home.focus();
    else location.assign('/#sunnah-reminder');
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      minimized = read('localStorage', key) === 'minimized';
      current = null;
      dialog.close();
      layout();
      load();
    }
  });
  load().then(() => {
    if (home && !home.hidden && location.hash === '#sunnah-reminder') home.focus();
  });
})();
