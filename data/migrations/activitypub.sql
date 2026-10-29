CREATE TABLE IF NOT EXISTS activitypub_actors (
  id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  author_uid VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS activitypub_followers (
  actor_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  remote_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  remote_actor TEXT NOT NULL,
  inbox TEXT NOT NULL,
  follow_id TEXT NOT NULL,
  PRIMARY KEY (actor_id, remote_hash)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS activitypub_objects (
  source VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_id BIGINT NOT NULL,
  actor_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  activity_json MEDIUMTEXT NOT NULL,
  active TINYINT NOT NULL DEFAULT 1,
  sort_at DATETIME(3) NOT NULL,
  PRIMARY KEY (source, source_id),
  KEY actor_objects (actor_id, active, source_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS activitypub_deliveries (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  actor_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  remote_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  inbox TEXT NOT NULL,
  activity_json MEDIUMTEXT NOT NULL,
  source VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  source_id BIGINT NULL,
  attempts INT NOT NULL DEFAULT 0,
  status VARCHAR(12) NOT NULL DEFAULT 'queued',
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY pending (status, available_at, id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS activitypub_receipts (
  receipt_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS activitypub_cursors (
  source VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  last_id BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS activitypub_activities (
  id VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  actor_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_id BIGINT NOT NULL,
  activity_json MEDIUMTEXT NOT NULL
) ENGINE=InnoDB;
