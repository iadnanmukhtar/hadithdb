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
-- Table structure for table `hadiths_sim_candidates`
--

DROP TABLE IF EXISTS `hadiths_sim_candidates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hadiths_sim_candidates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `hadithId1` int NOT NULL,
  `hadithId2` int DEFAULT NULL,
  `ref_num` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `rating` decimal(10,3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ndx_unique` (`hadithId1`,`hadithId2`),
  KEY `ndx_id1` (`hadithId1`),
  KEY `ndx_id2` (`hadithId2`),
  KEY `ndx_rating` (`rating`),
  KEY `ndx_ref_num` (`ref_num`),
  CONSTRAINT `fk_sim_c_hadith1` FOREIGN KEY (`hadithId1`) REFERENCES `hadiths` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4450477 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
ALTER DATABASE `hadithdb` CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`adnanmukhtar`@`%`*/ /*!50003 TRIGGER `hadiths_sim_candidates_BEFORE_INSERT` BEFORE INSERT ON `hadiths_sim_candidates` FOR EACH ROW BEGIN

	IF NEW.`ref_num` IS NOT NULL THEN
		SET @bookAlias := regexp_substr(NEW.`ref_num`, '^[^:]+');
		SET @num := regexp_substr(NEW.`ref_num`, '([^:]+|[0-9]+:[0-9]+)$');
        SET NEW.`hadithId2` = (
			SELECT h.id FROM hadiths h, books b
            WHERE
				h.bookId = b.id
			AND b.alias = @bookAlias
            AND h.num = @num
        );
	ELSE
		SET @num := (
			SELECT concat(b.alias,':',h.num) FROM books b, hadiths h
            WHERE 
				NEW.`hadithId2` = h.id
			AND h.bookId = b.id
		 );
		SET NEW.`ref_num` = @num;
	END IF;

END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
ALTER DATABASE `hadithdb` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ;
ALTER DATABASE `hadithdb` CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`adnanmukhtar`@`%`*/ /*!50003 TRIGGER `hadiths_sim_candidates_BEFORE_UPDATE` BEFORE UPDATE ON `hadiths_sim_candidates` FOR EACH ROW BEGIN

	IF NEW.`ref_num` IS NOT NULL THEN
		SET @bookAlias := regexp_substr(NEW.`ref_num`, '^[^:]+');
		SET @num := regexp_substr(NEW.`ref_num`, '([^:]+|[0-9]+:[0-9]+)$');
        SET NEW.`hadithId2` = (
			SELECT h.id FROM hadiths h, books b
            WHERE
				h.bookId = b.id
			AND b.alias = @bookAlias
            AND h.num = @num
        );
	ELSE
		SET @num := (
			SELECT concat(b.alias,':',h.num) FROM books b, hadiths h
            WHERE 
				NEW.`hadithId2` = h.id
			AND h.bookId = b.id
		 );
		SET NEW.`ref_num` = @num;
	END IF;
    
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
ALTER DATABASE `hadithdb` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2023-07-30  0:33:44
