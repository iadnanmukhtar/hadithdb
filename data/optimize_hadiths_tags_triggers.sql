-- Avoid materializing and sorting the full v_tags aggregate after every tag write.
-- ndx_tag(tagId) makes the per-tag count below an indexed lookup.
DROP TRIGGER IF EXISTS hadiths_tags_AFTER_INSERT;
DROP TRIGGER IF EXISTS hadiths_tags_AFTER_UPDATE;

DELIMITER //

CREATE TRIGGER hadiths_tags_AFTER_INSERT AFTER INSERT ON hadiths_tags
FOR EACH ROW
BEGIN
	SET sql_safe_updates = 0;
	UPDATE hadiths h1, (
		SELECT h.id, GROUP_CONCAT(CONCAT('{', t.text_en, '}') SEPARATOR ' ') AS tags
		FROM hadiths h
		JOIN hadiths_tags ht ON h.id = ht.hadithId
		JOIN tags t ON ht.tagId = t.id
		WHERE h.id = NEW.hadithId
		GROUP BY ht.hadithId
	) AS x
	SET h1.tags = x.tags
	WHERE h1.id = x.id;

	UPDATE tags
	SET cnt_used = (SELECT COUNT(*) FROM hadiths_tags WHERE tagId = NEW.tagId)
	WHERE id = NEW.tagId;
END//

CREATE TRIGGER hadiths_tags_AFTER_UPDATE AFTER UPDATE ON hadiths_tags
FOR EACH ROW
BEGIN
	SET sql_safe_updates = 0;
	UPDATE hadiths h1, (
		SELECT h.id, GROUP_CONCAT(CONCAT('{', t.text_en, '}') SEPARATOR ' ') AS tags
		FROM hadiths h
		JOIN hadiths_tags ht ON h.id = ht.hadithId
		JOIN tags t ON ht.tagId = t.id
		WHERE h.id = NEW.hadithId
		GROUP BY ht.hadithId
	) AS x
	SET h1.tags = x.tags
	WHERE h1.id = x.id;

	UPDATE tags
	SET cnt_used = (SELECT COUNT(*) FROM hadiths_tags WHERE tagId = NEW.tagId)
	WHERE id = NEW.tagId;
END//

DELIMITER ;
