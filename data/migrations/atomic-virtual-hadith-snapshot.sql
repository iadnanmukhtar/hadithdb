CREATE PROCEDURE refresh_v_hadiths_virtual_snapshot(IN p_book_id INT)
BEGIN
  DECLARE v_lock_acquired INT DEFAULT 0;
  DECLARE v_transaction_started INT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    IF v_transaction_started = 1 THEN
      ROLLBACK;
    END IF;
    IF v_lock_acquired = 1 THEN
      DO RELEASE_LOCK('v_hadiths_virtual_snapshot_refresh');
    END IF;
    RESIGNAL;
  END;

  SELECT GET_LOCK('v_hadiths_virtual_snapshot_refresh', 30)
  INTO v_lock_acquired;
  IF COALESCE(v_lock_acquired, 0) <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Unable to acquire v_hadiths_virtual_snapshot refresh lock';
  END IF;

  -- InnoDB readers retain the complete previous snapshot until COMMIT.
  -- TRUNCATE implicitly commits, so full refreshes must also use DELETE.
  START TRANSACTION;
  SET v_transaction_started = 1;
  IF p_book_id IS NULL THEN
    DELETE FROM v_hadiths_virtual_snapshot;
    INSERT INTO v_hadiths_virtual_snapshot
    SELECT DISTINCT * FROM v_hadiths_virtual;
  ELSE
    DELETE FROM v_hadiths_virtual_snapshot WHERE book_id = p_book_id;
    INSERT INTO v_hadiths_virtual_snapshot
    SELECT DISTINCT * FROM v_hadiths_virtual WHERE book_id = p_book_id;
  END IF;
  COMMIT;
  SET v_transaction_started = 0;

  DO RELEASE_LOCK('v_hadiths_virtual_snapshot_refresh');
END
