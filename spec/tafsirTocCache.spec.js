'use strict';

const ejs = require('ejs');
const Tafsir = require('../lib/Tafsir');
const Utils = require('../lib/Utils');
const CommentaryHeadings = require('../lib/CommentaryHeadings');
const QuranTocSubdivisions = require('../lib/QuranTocSubdivisions');
const { Library } = require('../lib/Model');

function tafsirTocHandler() {
  const router = require('../routes/tafsir');
  return router.stack.find(layer => layer.route && layer.route.path === '/:tafsir').route.stack[0].handle;
}

function response() {
  return {
    app: { locals: {} },
    locals: {},
    setHeader: jest.fn(),
    render: jest.fn()
  };
}

describe('tafsir TOC disk cache', () => {
  const tafsir = { id: 42, alias: 'mokhtasar', slug: 'mokhtasar', source: 'local', type: 'tafsir' };
  const quranBook = { id: 1, alias: 'quran', hidden: 0 };

  beforeEach(() => {
    global.books = [quranBook];
    global.surahs = [];
    jest.spyOn(Tafsir, 'resolveTafsir').mockResolvedValue(tafsir);
    jest.spyOn(Utils, 'shouldFlushCache').mockReturnValue(false);
    jest.spyOn(Utils, 'cacheReqToFilename').mockReturnValue('_quran_tafsir_mokhtasar');
    jest.spyOn(Utils, 'cacheFileFromFilename').mockImplementation(filename => `/cache/${filename}.html`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('serves a warm TOC before loading commentary coverage', async () => {
    jest.spyOn(Utils, 'cachedTextPathForRead').mockReturnValue('/cache/_quran_tafsir_mokhtasar.html.gz');
    jest.spyOn(Utils, 'sendCachedHtml').mockReturnValue(true);
    jest.spyOn(Tafsir, 'sitemapPassages');
    const res = response();
    const req = {
      params: { tafsir: 'mokhtasar' },
      query: {},
      originalUrl: '/quran/tafsir/mokhtasar',
      admin: false,
      editMode: false
    };

    await tafsirTocHandler()(req, res, jest.fn());

    expect(Utils.sendCachedHtml).toHaveBeenCalledWith(
      res,
      req,
      '/cache/_quran_tafsir_mokhtasar.html',
      'text/html; charset=UTF-8'
    );
    expect(Tafsir.sitemapPassages).not.toHaveBeenCalled();
    expect(res.render).not.toHaveBeenCalled();
  });

  test('writes a cache miss and keeps alternate TOC views in separate files', async () => {
    jest.spyOn(Utils, 'cachedTextPathForRead').mockReturnValue(null);
    jest.spyOn(Utils, 'diskCacheEnabled').mockReturnValue(true);
    jest.spyOn(Utils, 'writeCachedHtml').mockImplementation(() => {});
    jest.spyOn(Utils, 'indexCachedItem').mockResolvedValue(undefined);
    jest.spyOn(Utils, 'sendCachedHtml').mockReturnValue(true);
    jest.spyOn(ejs, 'renderFile').mockResolvedValue('<html>cached tafsir toc</html>');
    jest.spyOn(Library, 'instance', 'get').mockReturnValue({
      findBook: jest.fn().mockReturnValue({ getChapters: jest.fn().mockResolvedValue([]) })
    });
    jest.spyOn(Tafsir, 'visibleTafsirs').mockResolvedValue([tafsir]);
    jest.spyOn(Tafsir, 'sitemapPassages').mockResolvedValue([{ surah: 1, ayah: 1, endAyah: 7 }]);
    jest.spyOn(QuranTocSubdivisions, 'juzRows').mockResolvedValue([]);
    jest.spyOn(QuranTocSubdivisions, 'manzilRows').mockResolvedValue([]);
    jest.spyOn(QuranTocSubdivisions, 'quranSectionRangesBySurah').mockResolvedValue({});
    jest.spyOn(CommentaryHeadings, 'introductionArticles').mockResolvedValue([]);
    const res = response();
    const req = {
      params: { tafsir: 'mokhtasar' },
      query: { toc: 'surahs' },
      originalUrl: '/quran/tafsir/mokhtasar?toc=surahs',
      admin: false,
      editMode: false
    };

    await tafsirTocHandler()(req, res, jest.fn());

    expect(Utils.writeCachedHtml).toHaveBeenCalledWith(
      '/cache/_quran_tafsir_mokhtasar__toc-surahs.html',
      '<html>cached tafsir toc</html>'
    );
    expect(Utils.indexCachedItem).toHaveBeenCalledWith(
      expect.arrayContaining(['quran', 'book:quran', 'quran:navigation-tocs', 'tafsir:mokhtasar:toc']),
      '/cache/_quran_tafsir_mokhtasar__toc-surahs.html'
    );
    expect(res.render).not.toHaveBeenCalled();
  });
});
