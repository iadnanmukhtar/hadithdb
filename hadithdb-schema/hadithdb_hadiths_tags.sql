CREATE DATABASE  IF NOT EXISTS `hadithdb` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;
USE `hadithdb`;
-- MySQL dump 10.13  Distrib 8.0.33, for macos13 (arm64)
--
-- Host: quranunlocked.com    Database: hadithdb
-- ------------------------------------------------------
-- Server version	8.0.33-0ubuntu0.20.04.2

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `hadiths_tags`
--

DROP TABLE IF EXISTS `hadiths_tags`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hadiths_tags` (
  `id` int NOT NULL AUTO_INCREMENT,
  `hadithId` int NOT NULL,
  `tagId` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ndx_unique` (`hadithId`,`tagId`),
  KEY `ndx_tag` (`tagId`),
  KEY `ndx_hadithId` (`hadithId`),
  CONSTRAINT `fk_hadith` FOREIGN KEY (`hadithId`) REFERENCES `hadiths` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_tag` FOREIGN KEY (`tagId`) REFERENCES `tags` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=44671 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`adnanmukhtar`@`%`*/ /*!50003 TRIGGER `hadiths_tags_AFTER_INSERT` AFTER INSERT ON `hadiths_tags` FOR EACH ROW BEGIN
	SET sql_safe_updates = 0;
	UPDATE hadiths h1, (
		SELECT h.id, GROUP_CONCAT(CONCAT('{',t.text_en,'}') SEPARATOR ' ') AS tags
		FROM hadiths h, hadiths_tags ht, tags t
		WHERE 
			h.id = ht.hadithId
			AND ht.tagId = t.id
			AND h.id = NEW.`hadithId`
		GROUP BY ht.hadithId
		) AS x
	SET
		h1.tags = x.tags
	WHERE
		h1.id = x.id;
	--
	UPDATE tags t, v_tags vt
	SET
		t.cnt_used = vt.cnt_used
	WHERE
		t.id = vt.id
	AND t.id = NEW.`tagId`;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`adnanmukhtar`@`%`*/ /*!50003 TRIGGER `hadiths_tags_AFTER_UPDATE` AFTER UPDATE ON `hadiths_tags` FOR EACH ROW BEGIN
	SET sql_safe_updates = 0;
	UPDATE hadiths h1, (
		SELECT h.id, GROUP_CONCAT(CONCAT('{',t.text_en,'}') SEPARATOR ' ') AS tags
		FROM hadiths h, hadiths_tags ht, tags t
		WHERE 
			h.id = ht.hadithId
			AND ht.tagId = t.id
			AND h.id = NEW.`hadithId`
		GROUP BY ht.hadithId
		) AS x
	SET
		h1.tags = x.tags
	WHERE
		h1.id = x.id;
	--
	UPDATE tags t, v_tags vt
	SET
		t.cnt_used = vt.cnt_used
	WHERE
		t.id = vt.id
	AND t.id = NEW.`tagId`;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2023-07-10 23:56:03
