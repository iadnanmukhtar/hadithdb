# Sharing, image cards and printing

Readers can share a canonical link, prepare a bilingual image or text excerpt, and print a selected reading range.

## Using the feature

| Function | What the reader sees and does | How it works |
| --- | --- | --- |
| Prepare a card | Share opens a preview with controls for editing its text and independently sizing the Arabic and translation. A Translations menu appears when enabled. | The modal builds a separate share representation from the selected item. The client fits the card, updates edited preview text and invalidates an old image render when settings change. |
| Choose an output | Copy text, Copy image, Share image and Post image to Community are distinct actions. Share controls are labeled even when displayed as icons. | The client produces plain text or renders the card for an image-capable destination. The Community handoff prepares the source URL, title and bilingual excerpt for its composer. For an ayah it resolves the selected translation before composing. The canonical URL identifies the underlying source. |
| Print the current reading | Print current page selects the passage corresponding to the active URL, including a Mushaf page reached through scrolling. | Before print, the client identifies the matching appended page or section. Selecting an ayah can update history within a passage, so it also checks verse references. Temporary print attributes are cleared afterward. |
| Print a range | Print book opens a dialog for Sections in this chapter or Chapters, with Start, End, Print range, Print current page and Cancel. | The client derives bounds from the current book, validates the inclusive range and builds the selected print output. Notebook printing uses its own note renderer. |

## Following a request

For a bilingual image, open Share on the specific report and check the preview after changing either language size. For a handout covering several sections, use the book range dialog. Scrolling extra sections into the browser is unnecessary because the range controls determine which sections to print.

## Implementation and related reading

- Card toolbar, content, language and size controls. [views/sub-views/hadith_modal.ejs](../../../views/sub-views/hadith_modal.ejs)
- Share preview, image generation, print selection and range dialog. [public/static/js/script.js](../../../public/static/js/script.js)
- Community post sharing. [public/static/js/community-post-share.js](../../../public/static/js/community-post-share.js)
- Source reference and fallback title rules. [lib/ContentIdentity.js](../../../lib/ContentIdentity.js)
- Share modal contracts. [spec/shareModals.spec.js](../../../spec/shareModals.spec.js)

Related guides · [Community writing, articles and blog](../publishing/README.md) · [Notebook, editing, sharing and export](../notebook/README.md)

[All features](../README.md)
