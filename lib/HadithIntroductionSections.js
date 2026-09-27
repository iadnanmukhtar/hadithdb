'use strict';

// Empty sections after the first report remain chapter introductions.
// Only the front matter before the reports belongs on the book introduction page.
function chapterSections(rows) {
 const firstReport = Math.min(...rows.filter(row => Number(row.h2_count) > 0).map(row => Number(row.ordinal)));
 return rows.filter(row => Number(row.h2_count) > 0 || Number(row.ordinal) >= firstReport);
}
module.exports = { chapterSections };
