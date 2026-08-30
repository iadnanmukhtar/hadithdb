-- Adds the canonical hdith.com collection number to each mapped local book.
-- Run through the application migration path after checking whether the column/index exist.
ALTER TABLE books ADD COLUMN hdith_book_id INT NULL AFTER id;
ALTER TABLE books ADD UNIQUE KEY books_hdith_book_id (hdith_book_id);
UPDATE books b
JOIN hdith_book_mappings m ON m.local_book_id=b.id
SET b.hdith_book_id=m.source_book_id;
