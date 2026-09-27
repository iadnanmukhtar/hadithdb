# Virtual-book commentary ownership

`hdith_virtual_sharh_links` identifies the stable virtual entry owning each commentary. The database update trigger moves the actual commentary row when the selected original changes, retaining its ID, text, metadata, and annotations. Commentary belonging to the original hadith or another virtual entry stays put. Linked entries cannot lose their selected original; deleting an entry removes only its owned commentary.

The selected-match editor and reference-field editor use `VirtualHadithEditing` and refresh both old and new original hadiths, including their commentary search documents and caches. Direct SQL changes move database rows through the trigger but require the caller to refresh indexes/caches.

The migration `node bin/utils/link-virtual-sharh.js` is rollback-only by default. `--apply` installs the schema and commits. It backs up ownership and full commentary rows under `temp/virtual-sharh/` before data changes. DDL is outside the data transaction. The uniqueness key becomes `(hadith_id, source_id, source_entry_id)` so unrelated commentary sources with equal entry numbers can coexist at the replacement target.

The reviewed migration adds 3,178 links: Ibn Uthaymin's Riyad (1,538), Ibn Daqiq (42), Ibn Rajab (50), and Ibn Allan's Riyad (1,548). Mirqat's 6,689 links already exist. Ownership comes from the original importers' numbering contracts and Ibn Allan's reviewed alignment file. Three previously stranded Ibn Uthaymin rows move to the current Riyad selections:

| Riyad number | Commentary row | Former hadith ID | Current hadith ID |
| --- | --- | --- | --- |
| 631 | 86368 | 112296 | 107279 |
| 1685 | 87245 | 98381 | 101273 |
| 1847 | 87381 | 108890 | 108886 |

All four legacy importers now register ownership in their import transaction. Future importers must call `VirtualHadithSharh.ensureSchema` before their transaction and `linkRows` with exact virtual-entry ownership before commit. Commentary authored for an original hadith must not be assigned to a virtual entry merely because that entry references it.

After applying, run `node bin/utils/verify-mirqat-replacement.js` for rollback-only transfer, unrelated-commentary, null-target, and deletion checks across Mishkat, Riyad, and Ibn Rajab. Refresh the six affected original hadith IDs and the three standalone commentary documents, invalidate affected reader caches, and verify SQL/search readback. Deploy the route changes for the reference-field refresh fix.

Status: explicitly approved and applied on 2026-09-27. All 9,867 ownership links match their virtual entries’ selected originals. The three stranded rows were repaired with exact content preserved. Rollback-only live replacement tests passed for Mishkat (Suyuti and misc placeholders), Riyad, and Ibn Rajab. The `riyad:1` example retains both Riyad commentaries on `bukhari:1`. The 27 focused tests pass. Database transfer behavior is active; the additional reference-field route refresh change is local and awaits normal application deployment.
