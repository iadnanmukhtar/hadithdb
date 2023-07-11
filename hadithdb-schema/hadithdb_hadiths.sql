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
-- Table structure for table `hadiths`
--

DROP TABLE IF EXISTS `hadiths`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hadiths` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ordinal` int NOT NULL DEFAULT '0',
  `bookId` int NOT NULL,
  `tocId` int NOT NULL,
  `numInChapter` decimal(10,2) DEFAULT NULL,
  `h1` decimal(10,2) DEFAULT NULL,
  `h2` decimal(10,2) DEFAULT NULL,
  `h3` decimal(10,2) DEFAULT NULL,
  `remark` tinyint NOT NULL DEFAULT '0',
  `num` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `numActual` varchar(15) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `num0` decimal(10,3) DEFAULT NULL,
  `highlight` datetime DEFAULT CURRENT_TIMESTAMP,
  `verified` tinyint DEFAULT '0',
  `gradeId` int NOT NULL DEFAULT '-1',
  `graderId` int NOT NULL DEFAULT '-1',
  `title_en` mediumtext COLLATE utf8mb4_unicode_ci,
  `title` mediumtext COLLATE utf8mb4_unicode_ci,
  `part_en` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `part` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `chain_en` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `chain` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `body_en` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `body` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `footnote_en` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `footnote` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `tags` mediumtext COLLATE utf8mb4_unicode_ci,
  `text_en` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `text` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `requested` tinyint DEFAULT '0',
  `back_ref` int DEFAULT NULL,
  `temp_trans` tinyint DEFAULT '0',
  `gradeText` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `search_chain` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `search_body` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `search_text` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `lastmod` datetime DEFAULT CURRENT_TIMESTAMP,
  `lastmod_user` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `undx_hadith` (`id`),
  KEY `ndx_bookId` (`bookId`),
  KEY `ndx_hadith` (`bookId`,`num`),
  KEY `ndx_hadith0` (`num0`,`bookId`),
  KEY `ndx_remark` (`remark`),
  KEY `ndx_h1` (`h1`),
  KEY `ndx_h2` (`h2`),
  KEY `ndx_h3` (`h3`),
  KEY `ndx_numChap` (`numInChapter`),
  KEY `ndx_gradeId` (`gradeId`),
  KEY `ndx_graderId` (`graderId`),
  KEY `ndx_join` (`bookId`,`gradeId`,`h1`,`h2`,`numInChapter`,`num0`),
  KEY `ndx_numInChap` (`bookId`,`h1`,`numInChapter`),
  KEY `ndx_temp_trans` (`temp_trans`),
  KEY `ndx_ordinal` (`ordinal`),
  KEY `ndx_lastmod` (`lastmod` DESC),
  KEY `ndx_highlight` (`highlight` DESC),
  KEY `ndx_id_highlight` (`id`,`highlight` DESC),
  KEY `ndx_hadith_toc` (`bookId`,`h1`,`h2`,`h3`),
  KEY `ndx_verified` (`verified`),
  KEY `ndx_requested` (`requested`),
  KEY `ndx_part` (`part`),
  KEY `ndx_toc` (`tocId`),
  KEY `ndx_num0` (`num0`,`bookId`),
  CONSTRAINT `fk_hadith_book` FOREIGN KEY (`bookId`) REFERENCES `books` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_hadith_grade` FOREIGN KEY (`gradeId`) REFERENCES `grades` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_hadith_grader` FOREIGN KEY (`graderId`) REFERENCES `graders` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_hadith_toc` FOREIGN KEY (`tocId`) REFERENCES `toc` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=446714 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
/*!50003 CREATE*/ /*!50017 DEFINER=`adnanmukhtar`@`%`*/ /*!50003 TRIGGER `hadiths_BEFORE_INSERT` BEFORE INSERT ON `hadiths` FOR EACH ROW BEGIN
	SET 
		NEW.`part` = remove_tashkil(NEW.`part`),
		NEW.`search_chain` = remove_tashkil(NEW.`chain`),
		NEW.`search_body` = remove_tashkil(NEW.`body`),
		NEW.`search_text` = remove_tashkil(concat(COALESCE(NEW.`chain`,''),' ',COALESCE(NEW.`body`,''),' ',COALESCE(NEW.`footnote`,''))),
		NEW.`h1` = (SELECT h1 FROM toc WHERE id=NEW.`tocId`),
		NEW.`h2` = (SELECT h2 FROM toc WHERE id=NEW.`tocId`),
		NEW.`h3` = (SELECT h3 FROM toc WHERE id=NEW.`tocId`)
	;
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
/*!50003 CREATE*/ /*!50017 DEFINER=`adnanmukhtar`@`%`*/ /*!50003 TRIGGER `hadiths_BEFORE_UPDATE` BEFORE UPDATE ON `hadiths` FOR EACH ROW BEGIN
	SET
		NEW.`lastmod` = current_timestamp(),
        NEW.`part` = remove_tashkil(NEW.`part`),
		NEW.`search_chain` = remove_tashkil(OLD.`chain`),
		NEW.`search_body` = remove_tashkil(OLD.`body`),
		NEW.`search_text` = remove_tashkil(CONCAT(COALESCE(NEW.`chain`,''),' ',COALESCE(NEW.`body`,''),' ',COALESCE(NEW.`footnote`,'')));
        IF (NEW.`h1` != OLD.`h1` OR NEW.`h2` != OLD.`h2` OR NEW.`h3` != OLD.`h3`) THEN
			SET
				NEW.`h1` = (SELECT h1 FROM toc WHERE id=NEW.`tocId`),
				NEW.`h2` = (SELECT h2 FROM toc WHERE id=NEW.`tocId`),
				NEW.`h3` = (SELECT h3 FROM toc WHERE id=NEW.`tocId`);
		END IF;
        IF (NEW.`tocId` != OLD.`tocId`) THEN
			UPDATE toc t, (
				SELECT * FROM hadiths WHERE ordinal = (
					SELECT MIN(ordinal) FROM hadiths WHERE tocId = NEW.`tocId`
				)
			) hstart
			SET
				start = hstart.num, start0 = hstart.num0
			WHERE
				t.id = hstart.tocId;
			UPDATE toc t, (
				SELECT tocId, count(*) as cnt FROM hadiths  WHERE tocId = NEW.`tocId` GROUP BY tocId
			) counts
            SET
				t.count = counts.cnt
			WHERE
				t.id = counts.tocId;
		END IF;
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

-- Dump completed on 2023-07-10 23:55:58
