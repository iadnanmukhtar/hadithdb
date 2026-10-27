-- Stable identities for commentary and introduction actions. Existing hadith/ayah
-- actions keep their own identities; likes/reflections use type='content'.
CREATE TABLE IF NOT EXISTS content_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  source_key VARCHAR(191) NOT NULL UNIQUE,
  title TEXT NOT NULL,
  url TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS content_item_bookmarks (
  item_id BIGINT UNSIGNED NOT NULL,
  user_uid VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(item_id,user_uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
