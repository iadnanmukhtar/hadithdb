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
-- Table structure for table `toc`
--

DROP TABLE IF EXISTS `toc`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `toc` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ordinal` int NOT NULL DEFAULT '0',
  `bookId` int NOT NULL,
  `level` tinyint(1) NOT NULL DEFAULT '0',
  `h1` decimal(10,2) NOT NULL,
  `h2` decimal(10,2) DEFAULT NULL,
  `h3` decimal(10,2) DEFAULT NULL,
  `title_en` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `title` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `intro_en` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `intro` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `start` varchar(15) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `start0` decimal(10,3) DEFAULT NULL,
  `count` int DEFAULT NULL,
  `lastmod` datetime DEFAULT CURRENT_TIMESTAMP,
  `lastmod_user` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `undx_toc` (`id`),
  KEY `fk_toc_book_idx` (`bookId`),
  KEY `ndx_toc` (`bookId`,`level`),
  KEY `ndx_h1` (`bookId`,`level`,`h1`),
  KEY `ndx_start0` (`start0`),
  KEY `ndx_h123` (`bookId`,`h1`,`h2`,`h3`,`level`),
  KEY `ndx_h12` (`bookId`,`level`,`h1`,`h2`),
  CONSTRAINT `fk_toc_book` FOREIGN KEY (`bookId`) REFERENCES `books` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=118211 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
/*!50003 CREATE*/ /*!50017 DEFINER=`adnanmukhtar`@`%`*/ /*!50003 TRIGGER `toc_AFTER_UPDATE` AFTER UPDATE ON `toc` FOR EACH ROW BEGIN
    IF (NEW.`h1` != OLD.`h1`) THEN
		UPDATE hadiths SET h1 = NEW.`h1` WHERE tocId = OLD.`id`;
		UPDATE hadiths_virtual SET h1 = NEW.`h1` WHERE tocId = OLD.`id`;
	END IF;
    IF (NEW.`h2` != OLD.`h2`) THEN
		UPDATE hadiths SET h2 = NEW.`h2` WHERE tocId = OLD.`id`;
		UPDATE hadiths_virtual SET h2 = NEW.`h2` WHERE tocId = OLD.`id`;
	END IF;
    IF (NEW.`h3` != OLD.`h3`) THEN
		UPDATE hadiths SET h3 = NEW.`h3` WHERE tocId = OLD.`id`;
		UPDATE hadiths_virtual SET h3 = NEW.`h3` WHERE tocId = OLD.`id`;
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

-- Dump completed on 2023-07-10 23:55:56
