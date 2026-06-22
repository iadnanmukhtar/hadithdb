CREATE TABLE IF NOT EXISTS v_hadiths_virtual_snapshot AS
SELECT *
FROM v_hadiths_virtual
WHERE 1 = 0;

CREATE TABLE IF NOT EXISTS v_hadiths_virtual_snapshot_refresh_queue (
	book_id INT NOT NULL PRIMARY KEY,
	requested_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

DROP PROCEDURE IF EXISTS ensure_v_hadiths_virtual_snapshot_index;
DROP PROCEDURE IF EXISTS drop_v_hadiths_virtual_snapshot_index;

DELIMITER //

CREATE PROCEDURE drop_v_hadiths_virtual_snapshot_index(
	IN p_index_name VARCHAR(64),
	IN p_drop_sql TEXT
)
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.STATISTICS
		WHERE TABLE_SCHEMA = DATABASE()
			AND TABLE_NAME = 'v_hadiths_virtual_snapshot'
			AND INDEX_NAME = p_index_name
	) THEN
		SET @drop_sql = p_drop_sql;
		PREPARE stmt FROM @drop_sql;
		EXECUTE stmt;
		DEALLOCATE PREPARE stmt;
	END IF;
END//

CREATE PROCEDURE ensure_v_hadiths_virtual_snapshot_index(
	IN p_index_name VARCHAR(64),
	IN p_index_sql TEXT
)
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.STATISTICS
		WHERE TABLE_SCHEMA = DATABASE()
			AND TABLE_NAME = 'v_hadiths_virtual_snapshot'
			AND INDEX_NAME = p_index_name
	) THEN
		SET @index_sql = p_index_sql;
		PREPARE stmt FROM @index_sql;
		EXECUTE stmt;
		DEALLOCATE PREPARE stmt;
	END IF;
END//

CALL drop_v_hadiths_virtual_snapshot_index(
	'PRIMARY',
	'ALTER TABLE v_hadiths_virtual_snapshot DROP PRIMARY KEY'
)//
CALL ensure_v_hadiths_virtual_snapshot_index(
	'idx_vhvs_id',
	'CREATE INDEX idx_vhvs_id ON v_hadiths_virtual_snapshot (id)'
)//
CALL ensure_v_hadiths_virtual_snapshot_index(
	'idx_vhvs_book_ordinal',
	'CREATE INDEX idx_vhvs_book_ordinal ON v_hadiths_virtual_snapshot (book_id, ordinal, id)'
)//
CALL ensure_v_hadiths_virtual_snapshot_index(
	'idx_vhvs_book_h1_ordinal',
	'CREATE INDEX idx_vhvs_book_h1_ordinal ON v_hadiths_virtual_snapshot (book_id, h1, ordinal, id)'
)//
CALL ensure_v_hadiths_virtual_snapshot_index(
	'idx_vhvs_book_h1_h2_ordinal',
	'CREATE INDEX idx_vhvs_book_h1_h2_ordinal ON v_hadiths_virtual_snapshot (book_id, h1, h2, ordinal, id)'
)//
CALL ensure_v_hadiths_virtual_snapshot_index(
	'idx_vhvs_book_h1_h2_h3_ordinal',
	'CREATE INDEX idx_vhvs_book_h1_h2_h3_ordinal ON v_hadiths_virtual_snapshot (book_id, h1, h2, h3, ordinal, id)'
)//
CALL ensure_v_hadiths_virtual_snapshot_index(
	'idx_vhvs_hid',
	'CREATE INDEX idx_vhvs_hid ON v_hadiths_virtual_snapshot (hId)'
)//

DROP PROCEDURE drop_v_hadiths_virtual_snapshot_index//
DROP PROCEDURE ensure_v_hadiths_virtual_snapshot_index//

DROP PROCEDURE IF EXISTS refresh_v_hadiths_virtual_snapshot//
DROP PROCEDURE IF EXISTS refresh_v_hadiths_virtual_snapshot_row//
DROP PROCEDURE IF EXISTS queue_v_hadiths_virtual_snapshot_refresh//
DROP PROCEDURE IF EXISTS process_v_hadiths_virtual_snapshot_refresh_queue//
DROP EVENT IF EXISTS process_v_hadiths_virtual_snapshot_refresh_queue//

CREATE PROCEDURE refresh_v_hadiths_virtual_snapshot(IN p_book_id INT)
BEGIN
	DECLARE v_lock_acquired INT DEFAULT 0;
	DECLARE EXIT HANDLER FOR SQLEXCEPTION
	BEGIN
		IF v_lock_acquired = 1 THEN
			DO RELEASE_LOCK('v_hadiths_virtual_snapshot_refresh');
		END IF;
		RESIGNAL;
	END;

	SELECT GET_LOCK('v_hadiths_virtual_snapshot_refresh', 30)
	INTO v_lock_acquired;
	IF v_lock_acquired <> 1 THEN
		SIGNAL SQLSTATE '45000'
			SET MESSAGE_TEXT = 'Unable to acquire v_hadiths_virtual_snapshot refresh lock';
	END IF;

	IF p_book_id IS NULL THEN
		TRUNCATE TABLE v_hadiths_virtual_snapshot;
		INSERT INTO v_hadiths_virtual_snapshot
		SELECT DISTINCT *
		FROM v_hadiths_virtual;
	ELSE
		DELETE FROM v_hadiths_virtual_snapshot
		WHERE book_id = p_book_id;
		INSERT INTO v_hadiths_virtual_snapshot
		SELECT DISTINCT *
		FROM v_hadiths_virtual
		WHERE book_id = p_book_id;
	END IF;

	DO RELEASE_LOCK('v_hadiths_virtual_snapshot_refresh');
END//

CREATE PROCEDURE queue_v_hadiths_virtual_snapshot_refresh(IN p_book_id INT)
BEGIN
	IF p_book_id IS NOT NULL THEN
		INSERT INTO v_hadiths_virtual_snapshot_refresh_queue
			(book_id, requested_at)
		VALUES
			(p_book_id, CURRENT_TIMESTAMP(6))
		ON DUPLICATE KEY UPDATE
			requested_at = CURRENT_TIMESTAMP(6);
	END IF;
END//

CREATE PROCEDURE process_v_hadiths_virtual_snapshot_refresh_queue()
process_body: BEGIN
	DECLARE done INT DEFAULT 0;
	DECLARE v_book_id INT;
	DECLARE v_requested_at DATETIME(6);
	DECLARE v_process_lock_acquired INT DEFAULT 0;
	DECLARE refresh_cursor CURSOR FOR
		SELECT book_id, requested_at
		FROM tmp_v_hadiths_virtual_snapshot_refresh_queue
		ORDER BY requested_at, book_id;
	DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;
	DECLARE EXIT HANDLER FOR SQLEXCEPTION
	BEGIN
		IF v_process_lock_acquired = 1 THEN
			DO RELEASE_LOCK('v_hadiths_virtual_snapshot_queue_process');
		END IF;
		RESIGNAL;
	END;

	SELECT GET_LOCK('v_hadiths_virtual_snapshot_queue_process', 0)
	INTO v_process_lock_acquired;
	IF v_process_lock_acquired <> 1 THEN
		LEAVE process_body;
	END IF;

	DROP TEMPORARY TABLE IF EXISTS tmp_v_hadiths_virtual_snapshot_refresh_queue;
	CREATE TEMPORARY TABLE tmp_v_hadiths_virtual_snapshot_refresh_queue (
		book_id INT NOT NULL PRIMARY KEY,
		requested_at DATETIME(6) NOT NULL
	) ENGINE=MEMORY;

	INSERT INTO tmp_v_hadiths_virtual_snapshot_refresh_queue
		(book_id, requested_at)
	SELECT book_id, requested_at
	FROM v_hadiths_virtual_snapshot_refresh_queue;

	OPEN refresh_cursor;
	refresh_loop: LOOP
		FETCH refresh_cursor INTO v_book_id, v_requested_at;
		IF done THEN
			LEAVE refresh_loop;
		END IF;

		CALL refresh_v_hadiths_virtual_snapshot(v_book_id);
		DELETE FROM v_hadiths_virtual_snapshot_refresh_queue
		WHERE book_id = v_book_id
			AND requested_at <= v_requested_at;
	END LOOP;
	CLOSE refresh_cursor;

	DROP TEMPORARY TABLE tmp_v_hadiths_virtual_snapshot_refresh_queue;
	DO RELEASE_LOCK('v_hadiths_virtual_snapshot_queue_process');
END//

DROP TRIGGER IF EXISTS hadiths_virtual_snapshot_after_insert//
DROP TRIGGER IF EXISTS hadiths_virtual_snapshot_after_update//
DROP TRIGGER IF EXISTS hadiths_virtual_snapshot_after_delete//

CREATE TRIGGER hadiths_virtual_snapshot_after_insert
AFTER INSERT ON hadiths_virtual
FOR EACH ROW
BEGIN
	CALL queue_v_hadiths_virtual_snapshot_refresh(NEW.bookId);
END//

CREATE TRIGGER hadiths_virtual_snapshot_after_update
AFTER UPDATE ON hadiths_virtual
FOR EACH ROW
BEGIN
	IF OLD.bookId <> NEW.bookId THEN
		CALL queue_v_hadiths_virtual_snapshot_refresh(OLD.bookId);
	END IF;
	CALL queue_v_hadiths_virtual_snapshot_refresh(NEW.bookId);
END//

CREATE TRIGGER hadiths_virtual_snapshot_after_delete
AFTER DELETE ON hadiths_virtual
FOR EACH ROW
BEGIN
	CALL queue_v_hadiths_virtual_snapshot_refresh(OLD.bookId);
END//

CREATE EVENT process_v_hadiths_virtual_snapshot_refresh_queue
ON SCHEDULE EVERY 5 SECOND
DO
BEGIN
	CALL process_v_hadiths_virtual_snapshot_refresh_queue();
END//

CALL refresh_v_hadiths_virtual_snapshot(NULL)//

DELIMITER ;
