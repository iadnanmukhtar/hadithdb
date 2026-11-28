# Bookmarks and saved reading positions

Bookmarks brings saved narrations, ayat, headings, commentary, content items and the Mushaf reading position into one personal list.

## Using the feature

| Function | What the reader sees and does | How it works |
| --- | --- | --- |
| Save from a reader | The bookmark control reflects the saved state of the item. The Mushaf header uses a filled bookmark for the saved page. | Narrations and headings carry numeric IDs, tafsir carries work/surah/ayah, and the Mushaf has a single page bookmark. Generic content items have their own account bookmark API. |
| Open the list | /bookmarks groups saved entries with their source labels and links. Quiet text identifies an empty collection. A failed load shows a warning. | The client waits for bookmark settings, reads each collection, backfills missing metadata for older entries, and builds the sections. Content-item bookmarks contribute to the total independently. |
| Resolve legacy entries | Saved references gain display text when metadata is available. | The list APIs validate and deduplicate submitted identities. The report list resolves up to 100 in a batch and reconstructs requested order before separating Quran and hadith rows. |
| Remove | An item can be removed in its section. Clear all appears for a populated list. | Each type’s removal uses its own identity. The bulk action clears the supported stores, including the Mushaf position and content items, then reloads the list. |

## Following a request

Saving a hadith marks one report, while bookmarking the surrounding chapter saves a heading. Both can appear in the list and lead to different destinations. The one-page Mushaf bookmark acts as a reading position rather than a collection of every page visited.

## Earlier desktop and phone captures

These links open the archived route atlas. The URL identifies the original capture, including any redirect or gated state it encountered.

| Screen | Requested URL | Desktop | Phone |
| --- | --- | --- |
| Bookmarks · empty | `/bookmarks` | [Wide](../../design-system/screens/saved-wide.jpg) | [Narrow](../../design-system/screens/saved-small.jpg) |

## Implementation and related reading

- List construction, metadata backfill and removal. [views/bookmarks.ejs](../../../views/bookmarks.ejs)
- Typed lookups and list fragments. [routes/bookmarks.js](../../../routes/bookmarks.js)
- Generic content bookmark actions. [routes/content_items.js](../../../routes/content_items.js)
- Content-item controls and account state. [public/static/js/content-item-actions.js](../../../public/static/js/content-item-actions.js)

[All features](../README.md)
