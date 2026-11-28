# Administration and inline editing

Administrators maintain shared source identities in manager dialogs and edit individual fields where readers encounter them.

## Using the feature

| Function | What the reader sees and does | How it works |
| --- | --- | --- |
| Manage shared names | Administration opens searchable dialogs for narrator, attribution, chain classification, grader and legacy grade pairs. Selection reveals merge options. A target identifies the surviving pair. | Pairs are shared metadata. A merge updates references to the chosen target, which can affect multiple records. Filtering Arabic or English narrows the available choices before selection. |
| Maintain aliases and graders | Separate managers expose book aliases and legacy graders. Manage Sharḥ books opens the corresponding catalog. | The admin router authorizes access and loads the relevant datasets. Public alias resolution and grader display depend on shared metadata, so these edits have a wider scope than a single narration. |
| Edit text in place | Editable English and Arabic fields retain their script direction and reading position. Save actions, pending state and failure feedback stay near the field. | The update router validates the target and property. Immediate choice changes and explicit text or commentary saves use different interactions. Rejected saves must leave the draft recoverable. |
| Edit the contents | Add heading, remove and move controls sit beside the affected rows. Assignment moves items within the hierarchy. | BookTocEditing reads a coherent revision, validates add/delete/assign/move commands and applies changes transactionally. Physical and virtual collections have distinct ordering constraints. |
| Edit Quran structure | Passage and subpassage controls can change ranges, promote, demote or merge headings. | The handler validates ayah bounds, relinks affected records, updates heading numbers and invalidates affected surah or printed-page caches. A changed title can require refreshing search results as well as the page. |
| Manage report evidence | The report editor exposes metadata such as grader, grade, narrator, attribution, related records and explanations where supported. | Admin-only autocomplete resolves actual records. The update route coordinates source updates, virtual snapshot refresh and indexing. Virtual membership remains distinct from the original hadith and its attached Sharḥ. |
| Download a book | Historical contents specimens may show JSON or EPUB actions. Their availability is determined by the active export routes. | Book download handlers currently authorize the request and/or return a temporary-unavailable response (503). Reader JSON editions for browser use have a separate delivery path. |

## Following a request

To change a chapter’s placement, use its TOC row controls. To correct the bilingual spelling of a narrator used throughout the collection, use the shared pair manager. Choosing the correct editor matters because the first operation changes one hierarchy and the second can change many references.

## Implementation and related reading

- Administration and manager dialogs. [views/admin.ejs](../../../views/admin.ejs)
- Access gate, lists and export status. [routes/admin.js](../../../routes/admin.js)
- Inline contents controls. [views/sub-views/book_toc_editor.ejs](../../../views/sub-views/book_toc_editor.ejs)
- Revision checks and structural updates. [lib/BookTocEditing.js](../../../lib/BookTocEditing.js)
- Editable properties and downstream refresh. [routes/update.js](../../../routes/update.js)
- Source and virtual deletion behavior. [lib/HadithDeletion.js](../../../lib/HadithDeletion.js)
- Fixture coverage of edit, failure, merge and retry states. [spec/browser/admin-edit-regression.cjs](../../../spec/browser/admin-edit-regression.cjs)

[All features](../README.md)
