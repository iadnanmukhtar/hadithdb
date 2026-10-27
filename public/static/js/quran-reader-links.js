(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuranReaderLinks = factory();
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function reference(value) {
    var match = String(value || '').replace(/^quran:/, '').match(/^(\d{1,3}):(\d{1,3})(?:-\d+(?::\d+)?)?$/);
    if (!match || Number(match[1]) < 1 || Number(match[1]) > 114 || Number(match[2]) < 0 || Number(match[2]) > 286 || Number(match[2]) === 0 && Number(match[1]) !== 1) return '';
    return Number(match[1]) + ':' + Number(match[2]);
  }
  function book(value) { return /^[A-Za-z0-9_-]+$/.test(String(value || '')) ? String(value) : ''; }
  function paths(options) {
    options = options || {};
    var ref = reference(options.ref), page = Number(options.page);
    var studyBook = book(options.studyBook), tafsirBook = book(options.tafsirBook) || 'mokhtasar';
    var script = ['uthmani', 'indo-pak', 'warsh'].includes(options.script) ? options.script : '';
    var studyBase = '/quran' + (studyBook ? '/' + encodeURIComponent(studyBook) : '');
    var tafsirBase = '/quran/tafsir/' + encodeURIComponent(tafsirBook);
    function mushaf(mode) {
      if (!ref) return '/quran/page' + (mode === 'memorize' ? '?memorize' : '');
      var mapped = Number.isInteger(page) && page >= 1 && page <= 604;
      var target = mapped ? '/quran/page/' + page + '?ayah=' + ref : '/quran/navigate?ref=' + ref + '&mode=' + mode;
      if (mapped && mode === 'memorize') target += '&memorize';
      if (script) target += '&script=' + script;
      return target;
    }
    var passage = ref ? studyBook ? studyBase + '/quran:' + ref : '/quran:' + ref : studyBase + '/1';
    return {
      passage: passage + (options.ayat ? '?ayat' : ''),
      tafsir: ref ? tafsirBase + '/quran:' + ref : tafsirBase,
      translations: ref ? '/quran/translations/quran:' + ref : '/quran/translations',
      mushaf: mushaf('mushaf'), memorize: mushaf('memorize'), review: '/quran/review'
    };
  }
  return { reference: reference, paths: paths };
}));
