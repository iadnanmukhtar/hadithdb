# Quran edition downloads and reader updates

Public Quran readers install versioned content in the browser so repeated Study and Mushaf navigation can reuse the same book files.

## Using the feature

| Function | What the reader sees and does | How it works |
| --- | --- | --- |
| Open the first screen | Study or Mushaf can open as a shell and fill in the requested reading. The head can start loading data for the first passage immediately. | The server maps the requested page or surah to its initial public files. A Study passage can need script text, an outline, translation data and the study index. A printed page needs its page data. |
| Prepare the rest of the book | Background work makes later pages available without a visible download step on each page turn. | The publisher builds separate manifests for the Quran and each available local translation. The Quran publication includes text in three scripts, corpus, outlines and the 604 printed pages. Each manifest maps a request to a content hash. |
| Refresh an edition | An open reader can adopt a newer version of one work while continuing to serve an installed version during preparation. | The browser keeps a manifest cache and per-book file caches. It checks files against the hashes and promotes a complete edition. Matching hashes allow reuse. A failed check leaves the previous complete version available. |
| Request server rendering | The reader has a server fallback. Different requests for the same reference can take different rendering paths. | Document navigation, allowed query parameters, book source and edit mode govern shell eligibility. The origin service worker itself does not intercept requests. Feature code owns public book data. |

## Following a request

If one translation changes, the server publishes a new manifest for that work. A browser with the earlier edition downloads the changed objects, validates them, and then switches to the new manifest. This is independent of a native app release and of admin JSON or EPUB book exports.

## Implementation and related reading

- Publication, immutable objects and initial files. [lib/QuranPublication.js](../../../lib/QuranPublication.js)
- Persistent server-side reader data. [lib/ReaderDownloads.js](../../../lib/ReaderDownloads.js)
- Shell selection and fallback. [routes/search.js](../../../routes/search.js)
- Browser file storage, verification and refresh. [public/static/js/script.js](../../../public/static/js/script.js)
- Same-session update and corrupt-file fixture. [spec/browser/quran-reader-version-refresh.cjs](../../../spec/browser/quran-reader-version-refresh.cjs)
- Reader cache scenarios. [spec/browser/quran-reader-cache.cjs](../../../spec/browser/quran-reader-cache.cjs)

Related guides · [Quran Study, contents and word exploration](../quran-study/README.md) · [Mushaf pages and facing-page reading](../mushaf/README.md)

[All features](../README.md)
