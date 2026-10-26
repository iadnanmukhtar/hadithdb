/* Compact shared presentation for all book catalogs. Reader URLs and filter data stay on the original cards. */
(function () {
  'use strict';
  var page = document.querySelector('.book-catalog-page');
  if (!page || page.querySelector('._e') || typeof HTMLDialogElement === 'undefined') return;

  var arabicLabels = {
    sahihayn: 'الصحيحان', kutubarbaah: 'السنن الأربعة', sixbooks: 'الكتب الستة', ninebooks: 'الكتب التسعة',
    sihah: 'الصحاح', sunan: 'السنن', masanid: 'المسانيد', musannaf: 'المصنفات', maajim: 'المعاجم',
    'tafsir-major': 'أمهات التفاسير', 'tafsir-collected-opinions': 'جمع الأقوال', 'tafsir-selected': 'تفاسير منتقاة',
    'tafsir-general': 'تفاسير عامة', 'tafsir-encyclopedic': 'موسوعات', 'tafsir-other': 'تفاسير أخرى',
    'tafsir-language-rhetoric': 'لغة وبلاغة', 'tafsir-contemporary': 'تفاسير معاصرة',
    'tafsir-mukhtasarat': 'تفاسير مختصرة', 'tafsir-narrations': 'التفسير بالمأثور',
    'hadith-adab': 'الأدب والأخلاق', 'hadith-zuhd': 'الزهد والرقائق', 'hadith-shamail': 'الشمائل',
    'hadith-arbain': 'الأربعينات', 'hadith-encyclopedic': 'موسوعات الحديث'
  };
  var groups = new Map();
  page.querySelectorAll('[data-book-catalog-group-filter], [data-tafsir-group-filter]').forEach(function (button) {
    var id = button.dataset.bookCatalogGroupFilter || button.dataset.tafsirGroupFilter;
    if (!id) return;
    var label = button.textContent.trim();
    groups.set(id, { en: label, ar: button.dataset.catalogLabelAr || arabicLabels[id] || '' });
    if (groups.get(id).ar) {
      var ar = document.createElement('span');
      ar.lang = 'ar'; ar.dir = 'rtl'; ar.textContent = groups.get(id).ar;
      button.append(document.createTextNode(' · '), ar);
    }
  });

  var dialog = document.createElement('dialog');
  dialog.className = 'book-catalog-dialog';
  dialog.setAttribute('aria-labelledby', 'book-catalog-dialog-title');
  dialog.innerHTML = '<div class="book-catalog-dialog-header"><h2 id="book-catalog-dialog-title">Book details · <span lang="ar" dir="rtl">تفاصيل الكتاب</span></h2><button type="button" class="btn-close" aria-label="Close book details"></button></div><div class="book-catalog-dialog-body"></div>';
  document.body.append(dialog);
  var body = dialog.querySelector('.book-catalog-dialog-body');
  var current = null;
  var opener = null;
  dialog.querySelector('button').addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('click', function (event) {
    var rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  dialog.addEventListener('close', function () {
    if (current) { current.card.append(current.details); current.details.hidden = true; }
    current = null;
    document.body.classList.remove('book-catalog-dialog-open');
    if (opener) opener.focus({ preventScroll: true });
  });

  page.querySelectorAll('.tafsir-book-list').forEach(function (list) {
    var cards = Array.from(list.querySelectorAll('.tafsir-book-row'));
    var hasCategories = cards.some(function (card) {
      return (card.dataset.bookCatalogGroups || card.dataset.tafsirBookGroups || '').split(/\s+/).some(function (id) { return groups.has(id); });
    });
    var sections = new Map();
    cards.forEach(function (card) {
      var details = card.querySelector('.tafsir-book-row-main');
      if (!details) return;
      var summary = document.createElement('div');
      summary.className = 'book-catalog-summary';
      ['.tafsir-book-title-pair', '.tafsir-book-meta'].forEach(function (selector) {
        var source = details.querySelector(selector);
        if (!source) return;
        var copy = source.cloneNode(true);
        copy.querySelectorAll('[id]').forEach(function (node) { node.removeAttribute('id'); });
        // Keep author information compact; other metadata remains in the dialog.
        if (selector === '.tafsir-book-meta') Array.from(copy.children).slice(2).forEach(function (node) { node.remove(); });
        summary.append(copy);
      });
      var button = document.createElement('button');
      button.type = 'button'; button.className = 'book-catalog-details-button';
      button.innerHTML = 'Details <span aria-hidden="true">·</span> <span lang="ar" dir="rtl">التفاصيل</span>';
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-label', 'Book details: ' + (summary.querySelector('a') || summary).textContent.trim());
      button.addEventListener('click', function () {
        current = { card: card, details: details }; opener = button;
        details.hidden = false;
        details.querySelectorAll('.toc-book-description-summary').forEach(function (node) { node.hidden = true; });
        details.querySelectorAll('.toc-book-description-full').forEach(function (node) { node.classList.remove('d-none'); });
        body.replaceChildren(details);
        document.body.classList.add('book-catalog-dialog-open');
        dialog.showModal(); body.scrollTop = 0;
      });
      summary.append(button); card.prepend(summary); details.hidden = true;
      var ids = (card.dataset.bookCatalogGroups || card.dataset.tafsirBookGroups || '').split(/\s+/);
      var id = ids.find(function (candidate) { return groups.has(candidate); }) || '';
      if (!sections.has(id)) {
        var section = document.createElement('section');
        section.className = 'book-catalog-category';
        if (hasCategories) {
          var labels = groups.get(id) || { en: 'Other books', ar: 'كتب أخرى' };
          var heading = document.createElement('h2');
          heading.className = 'book-catalog-category-title';
          var ar = document.createElement('span'); ar.lang = 'ar'; ar.dir = 'rtl'; ar.textContent = labels.ar;
          heading.append(document.createTextNode(labels.en), ar); section.append(heading);
        }
        var grid = document.createElement('div'); grid.className = 'book-catalog-grid'; section.append(grid);
        sections.set(id, section);
      }
      sections.get(id).querySelector('.book-catalog-grid').append(card);
    });
    // Follow the configured category order while retaining book order within each group.
    Array.from(groups.keys()).concat(['']).forEach(function (id) { if (sections.has(id)) list.append(sections.get(id)); });
    var update = function () {
      sections.forEach(function (section) {
        section.hidden = !Array.from(section.querySelectorAll('.tafsir-book-row')).some(function (card) { return !card.classList.contains('d-none'); });
      });
    };
    new MutationObserver(update).observe(list, { subtree: true, attributes: true, attributeFilter: ['class'] });
    update();
  });
  page.classList.add('book-catalog-compact');
})();
