CREATE TABLE IF NOT EXISTS grader_dictionary_state (id TINYINT PRIMARY KEY, revision BIGINT UNSIGNED NOT NULL) ENGINE=InnoDB;
INSERT IGNORE INTO grader_dictionary_state VALUES (1,1);
CREATE TABLE IF NOT EXISTS grader_dictionary_alias (
  grader_id INT NOT NULL, old_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  PRIMARY KEY (grader_id, old_name)
) ENGINE=InnoDB;
DELIMITER //
CREATE TRIGGER IF NOT EXISTS dict_graders_insert AFTER INSERT ON graders FOR EACH ROW
BEGIN
  UPDATE grader_dictionary_state SET revision=revision+1 WHERE id=1;
END//
CREATE TRIGGER IF NOT EXISTS dict_graders_update AFTER UPDATE ON graders FOR EACH ROW
BEGIN
  IF OLD.shortName IS NOT NULL AND NOT (BINARY OLD.shortName <=> BINARY NEW.shortName) THEN
    INSERT IGNORE INTO grader_dictionary_alias VALUES (OLD.id,OLD.shortName);
  END IF;
  IF NOT (BINARY OLD.shortName <=> BINARY NEW.shortName AND BINARY OLD.shortName_en <=> BINARY NEW.shortName_en AND BINARY OLD.name_en <=> BINARY NEW.name_en) THEN
    UPDATE grader_dictionary_state SET revision=revision+1 WHERE id=1;
  END IF;
END//
CREATE TRIGGER IF NOT EXISTS dict_graders_delete AFTER DELETE ON graders FOR EACH ROW
BEGIN
  DELETE FROM grader_dictionary_alias WHERE grader_id=OLD.id;
  UPDATE grader_dictionary_state SET revision=revision+1 WHERE id=1;
END//
CREATE TRIGGER IF NOT EXISTS dict_hdith_hadith_grades_insert AFTER INSERT ON hdith_hadith_grades FOR EACH ROW
BEGIN
  UPDATE grader_dictionary_state SET revision=revision+1 WHERE id=1;
END//
CREATE TRIGGER IF NOT EXISTS dict_hdith_hadith_grades_update AFTER UPDATE ON hdith_hadith_grades FOR EACH ROW
BEGIN
  IF NOT (BINARY OLD.grader <=> BINARY NEW.grader AND BINARY OLD.grader_source_id <=> BINARY NEW.grader_source_id AND BINARY OLD.grader_en <=> BINARY NEW.grader_en) THEN
    UPDATE grader_dictionary_state SET revision=revision+1 WHERE id=1;
  END IF;
END//
CREATE TRIGGER IF NOT EXISTS dict_hdith_hadith_grades_delete AFTER DELETE ON hdith_hadith_grades FOR EACH ROW
BEGIN
  UPDATE grader_dictionary_state SET revision=revision+1 WHERE id=1;
END//
DELIMITER ;
UPDATE grader_dictionary_state SET revision=revision+1 WHERE id=1;
