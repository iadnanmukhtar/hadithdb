# Formatted writing and bilingual typography

Hadith, Sharḥ, tafsir, Community and Notebook render authored text across reading pages, previews, dialogs and exports.

## Using the feature

| Function | What the reader sees and does | How it works |
| --- | --- | --- |
| Read mixed scripts | Arabic spans use the Arabic face. English paragraphs, headings and metadata keep their own type hierarchy. Direction is assigned at block level so an Arabic paragraph can begin at the right edge within mixed content. | ContentMarkdown parses Markdown with raw HTML disabled. It detects Arabic text, sets block direction and handles references according to the selected rendering options. |
| Read footnotes | Inline markers lead to note text. Study collects the English footnotes after the translation passage. Multiple rendered entries on one screen need distinct targets. | Footnote prefixes prevent a dialog and its parent page from generating the same anchor. Arabic-numbered markers can preserve their label. The Study client renumbers passage notes in reading order. |
| Recognize author formatting | Headings, quotes, lists, tables, emphasis and supported callouts retain structure in previews and published text. | Markdown callouts transform blockquote tokens before inline parsing. In source contexts the renderer distinguishes asterisk emphasis for prophetic speech from ordinary italics. Rendering options vary by surface. |
| Share a private draft safely | A shared note shows the readable body and a clickable heading outline. Internal wiki labels can appear as plain text. Hidden draft blocks stay out of the public rendering. | The token reader renders current Markdown with hidden text excluded, removes private expansion controls, and builds unique heading targets. The owner’s underlying Markdown remains available for private editing. |

## Following a request

Consider a note containing a heading, an Arabic quotation and a footnote. The public reader needs a navigable heading, correct script direction and a working note target independently of the editor. NotebookShare builds those public structures after rendering and rechecks that the token still grants access.

## Implementation and related reading

- Shared rendering and script rules. [lib/ContentMarkdown.js](../../../lib/ContentMarkdown.js)
- Callout parsing. [lib/MarkdownCallouts.js](../../../lib/MarkdownCallouts.js)
- Hidden Markdown blocks. [lib/MarkdownHidden.js](../../../lib/MarkdownHidden.js)
- Public note outline and visibility. [lib/NotebookShare.js](../../../lib/NotebookShare.js)
- Supported formatting extensions. [lib/NotebookFormatting.js](../../../lib/NotebookFormatting.js)
- Typography and block layout. [public/static/css/markdown-content.css](../../../public/static/css/markdown-content.css)

[All features](../README.md)
