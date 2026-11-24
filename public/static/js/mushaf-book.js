(() => {
  const dialog = document.getElementById('mushaf-book');
  if (!dialog) return;
  const spread = dialog.querySelector('.mushaf-book-spread');
  const status = dialog.querySelector('[data-book-status]');
  const total = Number(dialog.dataset.totalPages);
  let first = 1;
  let entryPage;
  let readingPage;

  const toolbar = dialog.querySelector('.mushaf-book-controls');

  function fitBookSpread() {
    const sheets = spread.querySelectorAll('.quran-mushaf-sheet');
    if (!dialog.open || !sheets.length) return;
    const style = getComputedStyle(dialog);
    const width = dialog.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    spread.style.width = width + 'px';
    const height = Math.max(...Array.from(sheets, sheet => sheet.offsetHeight));
    const available = dialog.clientHeight - toolbar.offsetHeight - parseFloat(style.paddingBottom)
      - 2 * parseFloat(getComputedStyle(spread).marginTop);
    if (height && available > 0) spread.style.zoom = Math.min(1, available / height);
  }
  const sizeObserver = new ResizeObserver(fitBookSpread);
  sizeObserver.observe(dialog);
  sizeObserver.observe(toolbar);

  const slider = dialog.querySelector('.mushaf-page-slider input');
  const tip = dialog.querySelector('.mushaf-slider-tip');
  const divisions = JSON.parse(slider.dataset.juzStarts);

  function previewPage(page) {
    const division = divisions.findLast(([start]) => start <= page);
    const label = division ? `Page ${page} · Juz ${division[1]}` : `Page ${page}`;
    slider.setAttribute('aria-valuetext', label);
    tip.textContent = label;
    tip.style.setProperty('--thumb-position', (total - page) / (total - 1) * 100 + '%');
  }
  function setReadingPage(page) {
    readingPage = page;
    slider.value = page;
    previewPage(page);
  }
  slider.addEventListener('input', () => previewPage(slider.valueAsNumber));
  for (const eventName of ['pointerup', 'pointercancel']) {
    slider.addEventListener(eventName, () => dialog.focus({preventScroll: true}));
  }
  slider.addEventListener('change', () => {
    const page = slider.valueAsNumber;
    pending?.abort();
    pending = null;
    show(page % 2 ? page : page - 1, false, page);
  });

  function stackedLeaves() {
    return spread.children.length === 2 && spread.children[1].offsetTop > spread.children[0].offsetTop;
  }

  function trackLeaf(event) {
    const leaf = event.target.closest('[data-book-page]');
    if (leaf && !event.target.closest('[data-quran-passage-audio]')) setReadingPage(Number(leaf.dataset.bookPage));
  }
  spread.addEventListener('click', trackLeaf, true);
  spread.addEventListener('focusin', trackLeaf);
  dialog.addEventListener('scroll', () => {
    if (!stackedLeaves()) return;
    const second = spread.children[1];
    setReadingPage(second.getBoundingClientRect().top < dialog.clientHeight / 2 ? first + 1 : first);
  });
  let pending;
  let fullscreenOwned = false;

  const rail = document.getElementById('quran-navigation-rail');
  const railHome = document.createComment('Quran navigation');
  if (rail) rail.before(railHome);
  let marqueeHome;

  async function leaf(number, signal) {
    const selector = `[data-quran-mushaf-reader] [data-quran-mushaf-page="${number}"] > .quran-mushaf-sheet`;
    let sheet = document.querySelector(selector);
    if (!sheet) {
      const response = await fetch(quranApiPath('/quran/page/' + number), {signal});
      if (!response.ok) throw new Error();
      sheet = new DOMParser().parseFromString(await response.text(), 'text/html').querySelector(selector);
    }
    if (!sheet) throw new Error();
    const page = document.createElement('section');
    page.className = 'mushaf-book-leaf';
    page.setAttribute('aria-label', 'Mushaf page ' + number);
    const paper = sheet.cloneNode(false);
    page.dataset.bookPage = number;
    const header = sheet.querySelector('.quran-mushaf-page-heading').cloneNode(true);
    header.querySelector('[data-open-mushaf-book]')?.remove();
    const bookmark = header.querySelector('[data-quran-mushaf-bookmark-page]');
    if (bookmark) delete bookmark.dataset.quranMushafBookmarkInit;
    const audio = header.querySelector('[data-quran-passage-audio]');
    if (audio) {
      delete audio.dataset.quranPassageAudioBound;
      audio.dataset.quranAudioScope = 'book-page-' + number;
      const translation = audio.querySelector('[data-quran-audio-translation-select]');
      if (translation) delete translation.dataset.quranDynamicTranslationMenuBound;
      header.querySelectorAll('.show').forEach(el => el.classList.remove('show'));
    }
    paper.append(header);
    for (const line of sheet.querySelectorAll(':scope > .quran-mushaf-line')) paper.append(line.cloneNode(true));
    paper.querySelectorAll('.quran-mushaf-ayah-actions-toggle,.quran-mushaf-ayah-highlight-bg').forEach(el => el.remove());
    for (const marker of paper.querySelectorAll('a[data-quran-ayah-actions]')) {
      const text = document.createElement('span');
      text.className = marker.className;
      text.dataset.quranRef = marker.dataset.quranRef;
      text.textContent = marker.textContent;
      marker.replaceWith(text);
    }

    paper.append(sheet.querySelector('.quran-mushaf-page-number').cloneNode(true));
    page.append(paper);
    const links = sheet.querySelectorAll('.quran-mushaf-page-passage a');
    if (links.length) {
      const notes = document.createElement('nav');
      const rows = Array.from(paper.querySelectorAll(':scope > .quran-mushaf-line'));
      const firstAyah = rows.findIndex(row => row.classList.contains('quran-mushaf-line-ayah'));
      notes.style.setProperty('--book-opening-rows', Math.max(0, firstAyah));
      notes.dir = 'ltr';
      notes.setAttribute('aria-label', 'Sections on page ' + number);
      const seen = new Set();
      for (const link of links) {
        const key = link.getAttribute('href') + ' ' + link.textContent.trim();
        if (!seen.has(key)) notes.append(link.cloneNode(true));
        seen.add(key);
      }
      page.append(notes);
    }
    return page;
  }

  function bindSpreadAudio(leaves) {
    const controls = leaves.map(page => page.querySelector('[data-quran-passage-audio]')).filter(Boolean);
    const shared = controls.at(-1);
    if (!shared) return;
    const ranges = [];
    for (const range of controls.flatMap(quranPassageAudioControlRanges)) {
      const previous = ranges.at(-1);
      if (previous && previous.surah === range.surah && range.from <= previous.to + 1) {
        previous.to = Math.max(previous.to, range.to);
      } else {
        ranges.push(range);
      }
    }
    shared.dataset.quranAudioRanges = JSON.stringify(ranges);
    shared.dataset.quranAudioRepeatRanges = JSON.stringify(controls.flatMap(quranPassageAudioRepeatRanges));
    Object.assign(shared.dataset, ranges[0]);
    const play = shared.querySelector('[data-quran-passage-audio-play]');
    play.title = 'Play spread';
    play.setAttribute('aria-label', play.title);
    shared.querySelector('[role="group"]').setAttribute('aria-label', 'Spread audio');
    for (const control of controls.slice(0, -1)) control.remove();
  }

  // Cache unbound templates. Each visit gets fresh controls and selection state.
  const pages = new Map();

  function cachedPage(number) {
    let entry = pages.get(number);
    if (!entry) {
      const controller = new AbortController();
      entry = {controller, template: leaf(number, controller.signal)};
      pages.set(number, entry);
      entry.template.catch(() => {
        if (pages.get(number) === entry) pages.delete(number);
      });
    }
    return entry.template;
  }

  function retainPages(start, end) {
    for (const [number, entry] of pages) {
      if (number < start || number > end) {
        entry.controller.abort();
        pages.delete(number);
      }
    }
  }

  function prepareNeighbors(opening) {
    for (const offset of [2, 3, -2, -1]) {
      const number = opening + offset;
      if (number >= 1 && number <= total) cachedPage(number);
    }
  }

  async function show(number, continueAudio = false, targetPage = number) {
    if (pending || number < 1 || number > total) return;
    const request = new AbortController();
    pending = request;
    retainPages(number - 2, number + 3);
    if (!spread.childElementCount) status.textContent = 'Loading…';
    try {
      const numbers = number < total ? [number, number + 1] : [number];
      const templates = await Promise.all(numbers.map(cachedPage));
      if (request.signal.aborted) return;
      const leaves = templates.map(template => template.cloneNode(true));
      dialog.querySelector('.quran-corpus-tooltip')?.setAttribute('hidden', '');
      if (!continueAudio && quranAudioTranslationMarqueeState.selectionVerseKey) hideQuranAudioTranslationMarquee();
      if (!continueAudio && spread.contains(quranPassageAudioState.control)) stopQuranPassageAudio();
      const direction = spread.childElementCount ? Math.sign(number - first) : 0;
      const lineCount = Math.max(...leaves.map(leaf => leaf.querySelectorAll('.quran-mushaf-line').length));
      spread.style.setProperty('--mushaf-book-lines', String(lineCount));
      if (spread.contains(document.activeElement)) dialog.focus({preventScroll: true});
      spread.replaceChildren(...leaves);
      bindSpreadAudio(leaves);
      fitBookSpread();
      if (direction && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const turningPage = leaves[direction > 0 ? 0 : leaves.length - 1];
        turningPage.animate([
          {transform: `perspective(75rem) rotateY(${direction > 0 ? -72 : 72}deg)`, filter: 'brightness(.88)'},
          {transform: 'perspective(75rem) rotateY(0deg)', filter: 'brightness(1)'}
        ], {duration: 360, easing: 'cubic-bezier(.2,.72,.25,1)'});
      }
      initQuranMushafAyahSelection(spread);
      initQuranPassageAudioControls(spread);
      window.refreshHadithActions?.();
      first = number;
      setReadingPage(targetPage);
      dialog.querySelector('[data-turn="-2"]').disabled = first === 1;
      dialog.querySelector('[data-turn="2"]').disabled = first + 2 > total;
      status.textContent = 'Pages ' + numbers.join('–');
      if (targetPage !== first && stackedLeaves()) {
        spread.lastElementChild.scrollIntoView({block: 'start', behavior: 'instant'});
      } else {
        dialog.scrollTop = 0;
      }
      prepareNeighbors(number);
      fitQuranMushafLines(spread);
      const rendered = spread.firstElementChild;
      initQuranScriptPreference(spread).finally(() => {
        if (rendered === spread.firstElementChild) scheduleQuranMushafLineFit(spread);
      }).catch(() => {});
      return !request.signal.aborted;
    } catch (error) {
      if (!request.signal.aborted) {
        status.textContent = 'Couldn’t load the spread. ';
        const retry = document.createElement('button');
        retry.className = 'ux-text-action';
        retry.textContent = 'Retry';
        retry.onclick = () => show(number, continueAudio, targetPage);
        status.append(retry);
      }
    } finally {
      if (pending === request) pending = null;
    }
  }

  dialog.addEventListener('mushaf-playing-page', async event => {
    const {page, ref} = event.detail;
    const opening = page % 2 ? page : page - 1;
    if (opening !== first) await show(opening, true, page);
    if (spread.querySelector(`[data-book-page="${page}"]`)) setReadingPage(Number(page));
    spread.querySelectorAll('[data-quran-ref]').forEach(el => {
      el.classList.toggle('quran-audio-active-ayah', el.dataset.quranRef === ref);
    });
  });
  dialog.addEventListener('mushaf-page-ended', async event => {
    const control = event.target;
    const number = Number(control.closest('[data-book-page]').dataset.bookPage);
    const requestId = quranPassageAudioState.requestId;
    const reciter = selectedQuranPassageReciterId(control);
    if (number === total) { stopQuranPassageAudio(); return; }
    if (number === first + 1 && !await show(number + 1, true)) {
      if (requestId === quranPassageAudioState.requestId) stopQuranPassageAudio();
      return;
    }
    if (!dialog.open || requestId !== quranPassageAudioState.requestId) return;
    const next = spread.querySelector('[data-quran-passage-audio]');
    if (next) {
      next.dataset.quranAudioReciterOverride = reciter;
      startQuranPassageAudio(next);
    }
  });

  dialog.addEventListener('mushaf-search-match', async event => {
    const page = Number(event.detail.mushaf_page);
    const ref = event.detail.ref.replace(/^quran:/, '').split('-')[0];
    pending?.abort();
    pending = null;
    if (!await show(page % 2 ? page : page - 1, false, page)) return;
    const leaf = spread.querySelector(`[data-book-page="${page}"]`);
    const word = leaf.querySelector(`.quran-corpus-word[data-quran-ref="${ref}"]`);
    if (word) {
      word.focus({preventScroll: true});
      word.click();
    }
  });

  rail?.addEventListener('click', async event => {
    const link = event.target.closest('a.quran-navigation-item');
    if (!dialog.open || !link || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    const jump = new URL(link.href);
    let page = Number(jump.searchParams.get('page'));
    if (!page) {
      try {
        const result = await fetch(jump);
        page = Number(new URL(result.url).pathname.match(/\/page\/(\d+)/)?.[1]);
      } catch {}
    }
    if (!dialog.open) return;
    if (!page) return;
    bootstrap.Offcanvas.getInstance(rail)?.hide();
    show(page % 2 ? page : page - 1, false, page);
  });

  const phoneViewport = matchMedia('(max-width: 600px), (orientation: landscape) and (max-height: 600px) and (pointer: coarse)');
  phoneViewport.addEventListener('change', () => {
    if (phoneViewport.matches && dialog.open) dialog.close();
  });
  document.addEventListener('click', event => {
    const opener = event.target.closest('[data-open-mushaf-book]');
    if (!opener || phoneViewport.matches || dialog.open) return;
    entryPage = Number(opener.dataset.openMushafBook);
    setReadingPage(entryPage);
    first = entryPage;
    if (first % 2 === 0) first--;
    dialog.showModal();
    if (rail) dialog.append(rail);
    const marquee = ensureQuranAudioTranslationMarquee();
    if (marquee) {
      marqueeHome = document.createComment('Quran translation');
      marquee.before(marqueeHome);
      dialog.append(marquee);
    }
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().then(() => {
        fullscreenOwned = true;
        if (!dialog.open) document.exitFullscreen().catch(() => {});
      }).catch(() => {});
    }
    show(first, false, entryPage);
  });
  dialog.addEventListener('click', event => {
    const turn = event.target.closest('[data-turn]');
    if (turn) show(first + Number(turn.dataset.turn));
    if (event.target.closest('.mushaf-book-controls .btn-close')) dialog.close();
  });
  let drag;
  let suppressClick = false;
  spread.addEventListener('pointerdown', event => {
    drag = null;
    suppressClick = false;
    if (!event.isPrimary || event.button !== 0 || event.target.closest('button,select,.dropdown')) return;
    // Capture on the original word or link so a tap still activates it.
    event.target.setPointerCapture(event.pointerId);
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY};
  });
  spread.addEventListener('dragstart', event => {
    if (drag) event.preventDefault();
  });
  spread.addEventListener('pointercancel', () => { drag = null; });
  spread.addEventListener('pointerup', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag = null;
    if (Math.abs(dx) < 36 || Math.abs(dx) < 1.25 * Math.abs(dy)) return;
    suppressClick = true;
    show(first + (dx > 0 ? 2 : -2));
  });
  spread.addEventListener('click', event => {
    if (suppressClick && event.detail) {
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  // Trackpads and touch-sensitive mice deliver horizontal gestures as wheel events.
  let wheelDistance = 0, lastWheel = 0, wheelTurned = false;
  spread.addEventListener('wheel', event => {
    if (event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.25) return;
    event.preventDefault();
    if (event.timeStamp - lastWheel > 180) {
      wheelDistance = 0;
      wheelTurned = false;
    }
    lastWheel = event.timeStamp;
    if (wheelTurned) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? spread.clientWidth : 1;
    wheelDistance += event.deltaX * unit;
    if (Math.abs(wheelDistance) < 45) return;
    wheelTurned = true;
    show(first + (wheelDistance < 0 ? 2 : -2));
  }, {passive: false});
  dialog.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('#quran-navigation-rail,.dropdown.show,.dropdown:has(.show)')) return;
    const verticalTurn = dialog.scrollHeight <= dialog.clientHeight + 1 && !event.target.closest('nav,button,input,select')
      && (event.key === 'ArrowDown' || event.key === 'ArrowUp');
    if (verticalTurn || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      show(first + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? 2 : -2));
    }
  });
  document.addEventListener('fullscreenchange', () => {
    if (fullscreenOwned && !document.fullscreenElement) {
      fullscreenOwned = false;
      if (dialog.open) dialog.close();
    }
  });
  dialog.addEventListener('close', () => {
    if (quranPassageAudioState.control?.closest('[data-book-page]')) stopQuranPassageAudio();
    if (rail) {
      bootstrap.Offcanvas.getInstance(rail)?.hide();
      railHome.after(rail);
    }
    hideQuranSelectionTranslationMarquee();
    const marquee = dialog.querySelector('[data-quran-audio-translation-marquee]');
    if (marquee && marqueeHome) marqueeHome.replaceWith(marquee);
    pending?.abort();
    retainPages(1, 0);
    pending = null;
    spread.replaceChildren();
    dialog.querySelector('.quran-corpus-tooltip')?.setAttribute('hidden', '');
    if (fullscreenOwned && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (readingPage !== entryPage) {
      location.replace(quranUrl('/quran/page/' + readingPage));
    }
  });
})();
