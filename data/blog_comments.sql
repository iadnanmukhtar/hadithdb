CREATE TABLE IF NOT EXISTS blog_comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_slug VARCHAR(255) NOT NULL,
  parentId INT NULL,
  user_uid VARCHAR(128) NOT NULL,
  user_provider VARCHAR(64) NOT NULL,
  user_name VARCHAR(255) NOT NULL,
  user_email VARCHAR(255) NULL,
  text TEXT NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  up_vote INT DEFAULT 0,
  down_vote INT DEFAULT 0,
  deleted TINYINT(1) DEFAULT 0,
  INDEX idx_post_slug (post_slug),
  INDEX idx_parent (parentId),
  INDEX idx_createdAt (createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blog_comments_votes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  commentId INT NOT NULL,
  user_uid VARCHAR(128) NOT NULL,
  direction ENUM('up','down') NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_vote (commentId, user_uid),
  INDEX idx_comment (commentId),
  CONSTRAINT fk_blog_comments_votes_comment FOREIGN KEY (commentId) REFERENCES blog_comments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
