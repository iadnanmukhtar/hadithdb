/* global jQuery */
(function () {
  'use strict';
  window.BookAliasManager = {
    init: function (options) {
      var $ = jQuery;
      var $modal = $('[data-book-aliases]');
      if (!$modal.length || $modal.data('bound')) return;
      $modal.data('bound', true);
      var $type = $modal.find('[data-book-alias-type]');
      var $search = $modal.find('[data-book-alias-search]');
      var $select = $modal.find('[data-book-alias-select]');
      var $form = $modal.find('[data-book-alias-form]');
      var $alias = $form.find('[name=alias]');
      var $save = $modal.find('[data-book-alias-save]');
      var $status = $modal.find('[data-book-alias-status]');
      var rows = [], busy = false;
      var normalize = function (value) { return String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/[أإآٱ]/g, 'ا').toLowerCase(); };
      var selected = function () { return rows.find(function (book) { return String(book.id) === $select.val(); }); };
      var status = function (text, error) { $status.text(text).toggleClass('text-danger', !!error); };
      var controls = function () {
        var book = selected();
        $type.add($search).add($select).prop('disabled', busy);
        $alias.add($save).prop('disabled', busy || !book || book.type === 'quran');
        $save.text(book && book.refreshPending ? 'Retry refresh' : 'Save alias');
      };
      var choose = function () {
        var book = selected();
        $alias.val(book ? book.alias : '');
        status(!book ? 'No matching books.' : book.type === 'quran' ? 'The Quran alias is fixed because it owns the Quran application routes.' : book.refreshPending ? 'Alias saved; refresh is pending. Retry to finish updating search and cached pages.' : '', book && book.refreshPending);
        controls();
      };
      var render = function (preferredId) {
        var currentId = preferredId || $select.val();
        var term = normalize($search.val());
        var filtered = rows.filter(function (book) {
          return (!$type.val() || book.type === $type.val()) && [book.alias, book.shortName, book.shortName_en, book.name_en, book.title].some(function (value) { return normalize(value).includes(term); });
        });
        $select.empty();
        filtered.forEach(function (book) { $select.append($('<option>').val(book.id).text((book.shortName_en || book.name_en || book.shortName || book.title || book.alias) + ' — ' + book.alias + ' (' + book.type + ')')); });
        if (filtered.some(function (book) { return String(book.id) === String(currentId); })) $select.val(currentId);
        choose();
      };
      $modal.on('show.bs.modal', async function () {
        if (busy) return;
        busy = true; controls(); status('Loading books…');
        try {
          var response = await fetch('/admin/book-aliases', { headers: { Accept: 'application/json' } });
          if (!response.ok) throw new Error('Unable to load books. Reload /admin to renew your session.');
          rows = await response.json(); render();
        } catch (error) { status(error.message, true); }
        finally { busy = false; controls(); }
      });
      $type.on('change', function () { render(); });
      $search.on('input', function () { render(); });
      $select.on('change', choose);
      $form.on('submit', async function (event) {
        event.preventDefault();
        var book = selected();
        if (busy || !book || book.type === 'quran') return;
        busy = true; controls(); status('Saving alias and refreshing book URLs…');
        try {
          var result = await options.update({ id: book.id, prop: 'book.alias', value: String($alias.val()).trim(), arabizi: false });
          if (result.code !== 200) throw new Error(result.message || 'Unable to save alias.');
          book.alias = result.value;
          book.refreshPending = !!result.refreshPending;
          // An old-alias search must not hide the book immediately after saving.
          $search.val(''); render(String(book.id)); status(result.message, result.warning);
        } catch (error) { status(error.message, true); }
        finally { busy = false; controls(); }
      });
    }
  };
})();
