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
-- Temporary view structure for view `v_hadiths_virtual`
--

DROP TABLE IF EXISTS `v_hadiths_virtual`;
/*!50001 DROP VIEW IF EXISTS `v_hadiths_virtual`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_hadiths_virtual` AS SELECT 
 1 AS `id_virtual`,
 1 AS `book_id_virtual`,
 1 AS `h1_virtual`,
 1 AS `h2_virtual`,
 1 AS `h3_virtual`,
 1 AS `numInChapter_virtual`,
 1 AS `num_virtual`,
 1 AS `num0_virtual`,
 1 AS `hId`,
 1 AS `doctype`,
 1 AS `book_id`,
 1 AS `book_alias`,
 1 AS `book_shortName_en`,
 1 AS `book_shortName`,
 1 AS `book_name_en`,
 1 AS `book_name`,
 1 AS `book_author`,
 1 AS `book_virtual`,
 1 AS `level`,
 1 AS `h1_id`,
 1 AS `h1`,
 1 AS `h1_title_en`,
 1 AS `h1_title`,
 1 AS `h1_intro_en`,
 1 AS `h1_intro`,
 1 AS `h1_start`,
 1 AS `h1_count`,
 1 AS `h2_id`,
 1 AS `h2`,
 1 AS `h2_title_en`,
 1 AS `h2_title`,
 1 AS `h2_intro_en`,
 1 AS `h2_intro`,
 1 AS `h2_start`,
 1 AS `h2_count`,
 1 AS `h3_id`,
 1 AS `h3`,
 1 AS `h3_title_en`,
 1 AS `h3_title`,
 1 AS `h3_intro_en`,
 1 AS `h3_intro`,
 1 AS `h3_start`,
 1 AS `h3_count`,
 1 AS `ordinal`,
 1 AS `numInChapter`,
 1 AS `grade_id`,
 1 AS `grade_grade_en`,
 1 AS `grade_grade`,
 1 AS `grader_id`,
 1 AS `grader_shortName_en`,
 1 AS `grader_shortName`,
 1 AS `grader_name_en`,
 1 AS `grader_name`,
 1 AS `verified`,
 1 AS `remark`,
 1 AS `numActual`,
 1 AS `num`,
 1 AS `num0`,
 1 AS `title_en`,
 1 AS `title`,
 1 AS `part_en`,
 1 AS `part`,
 1 AS `chain_en`,
 1 AS `body_en`,
 1 AS `footnote_en`,
 1 AS `chain`,
 1 AS `body`,
 1 AS `footnote`,
 1 AS `tags`,
 1 AS `lastmod`,
 1 AS `highlight`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary view structure for view `v_hadiths`
--

DROP TABLE IF EXISTS `v_hadiths`;
/*!50001 DROP VIEW IF EXISTS `v_hadiths`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_hadiths` AS SELECT 
 1 AS `hId`,
 1 AS `doctype`,
 1 AS `book_id`,
 1 AS `book_alias`,
 1 AS `book_shortName_en`,
 1 AS `book_shortName`,
 1 AS `book_name_en`,
 1 AS `book_name`,
 1 AS `book_author`,
 1 AS `book_virtual`,
 1 AS `level`,
 1 AS `h1_id`,
 1 AS `h1`,
 1 AS `h1_title_en`,
 1 AS `h1_title`,
 1 AS `h1_intro_en`,
 1 AS `h1_intro`,
 1 AS `h1_start`,
 1 AS `h1_count`,
 1 AS `h2_id`,
 1 AS `h2`,
 1 AS `h2_title_en`,
 1 AS `h2_title`,
 1 AS `h2_intro_en`,
 1 AS `h2_intro`,
 1 AS `h2_start`,
 1 AS `h2_count`,
 1 AS `h3_id`,
 1 AS `h3`,
 1 AS `h3_title_en`,
 1 AS `h3_title`,
 1 AS `h3_intro_en`,
 1 AS `h3_intro`,
 1 AS `h3_start`,
 1 AS `h3_count`,
 1 AS `ordinal`,
 1 AS `numInChapter`,
 1 AS `grade_id`,
 1 AS `grade_grade_en`,
 1 AS `grade_grade`,
 1 AS `grader_id`,
 1 AS `grader_shortName_en`,
 1 AS `grader_shortName`,
 1 AS `grader_name_en`,
 1 AS `grader_name`,
 1 AS `verified`,
 1 AS `remark`,
 1 AS `numActual`,
 1 AS `num`,
 1 AS `num0`,
 1 AS `title_en`,
 1 AS `title`,
 1 AS `part_en`,
 1 AS `part`,
 1 AS `chain_en`,
 1 AS `body_en`,
 1 AS `footnote_en`,
 1 AS `chain`,
 1 AS `body`,
 1 AS `footnote`,
 1 AS `tags`,
 1 AS `lastmod`,
 1 AS `highlight`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary view structure for view `v_toc`
--

DROP TABLE IF EXISTS `v_toc`;
/*!50001 DROP VIEW IF EXISTS `v_toc`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_toc` AS SELECT 
 1 AS `hId`,
 1 AS `tId`,
 1 AS `doctype`,
 1 AS `level`,
 1 AS `book_id`,
 1 AS `book_alias`,
 1 AS `book_shortName_en`,
 1 AS `book_shortName`,
 1 AS `book_name_en`,
 1 AS `book_name`,
 1 AS `book_author`,
 1 AS `book_virtual`,
 1 AS `h1_id`,
 1 AS `h1`,
 1 AS `h1_title_en`,
 1 AS `h1_title`,
 1 AS `h1_intro_en`,
 1 AS `h1_intro`,
 1 AS `h1_start`,
 1 AS `h1_count`,
 1 AS `h2_id`,
 1 AS `h2`,
 1 AS `h2_title_en`,
 1 AS `h2_title`,
 1 AS `h2_intro_en`,
 1 AS `h2_intro`,
 1 AS `h2_start`,
 1 AS `h2_count`,
 1 AS `h3_id`,
 1 AS `h3`,
 1 AS `h3_title_en`,
 1 AS `h3_title`,
 1 AS `h3_intro_en`,
 1 AS `h3_intro`,
 1 AS `h3_start`,
 1 AS `h3_count`,
 1 AS `numInChapter`*/;
SET character_set_client = @saved_cs_client;

--
-- Temporary view structure for view `v_tags`
--

DROP TABLE IF EXISTS `v_tags`;
/*!50001 DROP VIEW IF EXISTS `v_tags`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_tags` AS SELECT 
 1 AS `id`,
 1 AS `text_en`,
 1 AS `text`,
 1 AS `description`,
 1 AS `cnt_used`*/;
SET character_set_client = @saved_cs_client;

--
-- Final view structure for view `v_hadiths_virtual`
--

/*!50001 DROP VIEW IF EXISTS `v_hadiths_virtual`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`adnanmukhtar`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_hadiths_virtual` AS select `hv`.`id` AS `id_virtual`,`hv`.`bookId` AS `book_id_virtual`,`hv`.`h1` AS `h1_virtual`,`hv`.`h2` AS `h2_virtual`,`hv`.`h3` AS `h3_virtual`,`hv`.`numInChapter` AS `numInChapter_virtual`,`hv`.`num` AS `num_virtual`,`hv`.`num0` AS `num0_virtual`,`h`.`id` AS `hId`,'hadith' AS `doctype`,`t`.`book_id` AS `book_id`,`t`.`book_alias` AS `book_alias`,`t`.`book_shortName_en` AS `book_shortName_en`,`t`.`book_shortName` AS `book_shortName`,`t`.`book_name_en` AS `book_name_en`,`t`.`book_name` AS `book_name`,`t`.`book_author` AS `book_author`,`t`.`book_virtual` AS `book_virtual`,`t`.`level` AS `level`,`t`.`h1_id` AS `h1_id`,`t`.`h1` AS `h1`,`t`.`h1_title_en` AS `h1_title_en`,`t`.`h1_title` AS `h1_title`,NULL AS `h1_intro_en`,NULL AS `h1_intro`,`t`.`h1_start` AS `h1_start`,`t`.`h1_count` AS `h1_count`,`t`.`h2_id` AS `h2_id`,`t`.`h2` AS `h2`,`t`.`h2_title_en` AS `h2_title_en`,`t`.`h2_title` AS `h2_title`,NULL AS `h2_intro_en`,NULL AS `h2_intro`,`t`.`h2_start` AS `h2_start`,`t`.`h2_count` AS `h2_count`,`t`.`h3_id` AS `h3_id`,`t`.`h3` AS `h3`,`t`.`h3_title_en` AS `h3_title_en`,`t`.`h3_title` AS `h3_title`,NULL AS `h3_intro_en`,NULL AS `h3_intro`,`t`.`h3_start` AS `h3_start`,`t`.`h3_count` AS `h3_count`,`h`.`ordinal` AS `ordinal`,`h`.`numInChapter` AS `numInChapter`,`g`.`id` AS `grade_id`,`g`.`grade_en` AS `grade_grade_en`,`g`.`grade` AS `grade_grade`,`p`.`id` AS `grader_id`,`p`.`shortName_en` AS `grader_shortName_en`,`p`.`shortName` AS `grader_shortName`,`p`.`name_en` AS `grader_name_en`,`p`.`name` AS `grader_name`,`h`.`verified` AS `verified`,`h`.`remark` AS `remark`,`h`.`numActual` AS `numActual`,`h`.`num` AS `num`,`h`.`num0` AS `num0`,`h`.`title_en` AS `title_en`,`h`.`title` AS `title`,`h`.`part_en` AS `part_en`,`h`.`part` AS `part`,`h`.`chain_en` AS `chain_en`,`h`.`body_en` AS `body_en`,`h`.`footnote_en` AS `footnote_en`,`h`.`chain` AS `chain`,`h`.`body` AS `body`,`h`.`footnote` AS `footnote`,`h`.`tags` AS `tags`,`h`.`lastmod` AS `lastmod`,`h`.`highlight` AS `highlight` from ((((`hadiths_virtual` `hv` join `hadiths` `h`) join `grades` `g`) join `graders` `p`) join `v_toc` `t`) where ((`hv`.`hadithId` = `h`.`id`) and (`h`.`gradeId` = `g`.`id`) and (`h`.`graderId` = `p`.`id`) and (`h`.`tocId` = `t`.`tId`)) order by `hv`.`bookId`,`hv`.`h1`,`hv`.`numInChapter` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_hadiths`
--

/*!50001 DROP VIEW IF EXISTS `v_hadiths`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`adnanmukhtar`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_hadiths` AS select `h`.`id` AS `hId`,'hadith' AS `doctype`,`t`.`book_id` AS `book_id`,`t`.`book_alias` AS `book_alias`,`t`.`book_shortName_en` AS `book_shortName_en`,`t`.`book_shortName` AS `book_shortName`,`t`.`book_name_en` AS `book_name_en`,`t`.`book_name` AS `book_name`,`t`.`book_author` AS `book_author`,`t`.`book_virtual` AS `book_virtual`,`t`.`level` AS `level`,`t`.`h1_id` AS `h1_id`,`t`.`h1` AS `h1`,`t`.`h1_title_en` AS `h1_title_en`,`t`.`h1_title` AS `h1_title`,NULL AS `h1_intro_en`,NULL AS `h1_intro`,`t`.`h1_start` AS `h1_start`,`t`.`h1_count` AS `h1_count`,`t`.`h2_id` AS `h2_id`,`t`.`h2` AS `h2`,`t`.`h2_title_en` AS `h2_title_en`,`t`.`h2_title` AS `h2_title`,NULL AS `h2_intro_en`,NULL AS `h2_intro`,`t`.`h2_start` AS `h2_start`,`t`.`h2_count` AS `h2_count`,`t`.`h3_id` AS `h3_id`,`t`.`h3` AS `h3`,`t`.`h3_title_en` AS `h3_title_en`,`t`.`h3_title` AS `h3_title`,NULL AS `h3_intro_en`,NULL AS `h3_intro`,`t`.`h3_start` AS `h3_start`,`t`.`h3_count` AS `h3_count`,`h`.`ordinal` AS `ordinal`,`h`.`numInChapter` AS `numInChapter`,`g`.`id` AS `grade_id`,`g`.`grade_en` AS `grade_grade_en`,`g`.`grade` AS `grade_grade`,`p`.`id` AS `grader_id`,`p`.`shortName_en` AS `grader_shortName_en`,`p`.`shortName` AS `grader_shortName`,`p`.`name_en` AS `grader_name_en`,`p`.`name` AS `grader_name`,`h`.`verified` AS `verified`,`h`.`remark` AS `remark`,`h`.`numActual` AS `numActual`,`h`.`num` AS `num`,`h`.`num0` AS `num0`,`h`.`title_en` AS `title_en`,`h`.`title` AS `title`,`h`.`part_en` AS `part_en`,`h`.`part` AS `part`,`h`.`chain_en` AS `chain_en`,`h`.`body_en` AS `body_en`,`h`.`footnote_en` AS `footnote_en`,`h`.`chain` AS `chain`,`h`.`body` AS `body`,`h`.`footnote` AS `footnote`,`h`.`tags` AS `tags`,`h`.`lastmod` AS `lastmod`,`h`.`highlight` AS `highlight` from (((`hadiths` `h` join `grades` `g`) join `graders` `p`) join `v_toc` `t`) where ((`h`.`gradeId` = `g`.`id`) and (`h`.`graderId` = `p`.`id`) and (`t`.`book_virtual` = 0) and (`h`.`tocId` = `t`.`tId`)) order by `t`.`book_id`,`t`.`h1`,`h`.`numInChapter` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_toc`
--

/*!50001 DROP VIEW IF EXISTS `v_toc`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`adnanmukhtar`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_toc` AS select `t1`.`id` AS `hId`,`t1`.`id` AS `tId`,'toc' AS `doctype`,`t1`.`level` AS `level`,`b`.`id` AS `book_id`,`b`.`alias` AS `book_alias`,`b`.`shortName_en` AS `book_shortName_en`,`b`.`shortName` AS `book_shortName`,`b`.`name_en` AS `book_name_en`,`b`.`name` AS `book_name`,`b`.`author` AS `book_author`,`b`.`virtual` AS `book_virtual`,`t1`.`id` AS `h1_id`,`t1`.`h1` AS `h1`,`t1`.`title_en` AS `h1_title_en`,`t1`.`title` AS `h1_title`,`t1`.`intro_en` AS `h1_intro_en`,`t1`.`intro` AS `h1_intro`,`t1`.`start` AS `h1_start`,`t1`.`count` AS `h1_count`,NULL AS `h2_id`,NULL AS `h2`,NULL AS `h2_title_en`,NULL AS `h2_title`,NULL AS `h2_intro_en`,NULL AS `h2_intro`,NULL AS `h2_start`,NULL AS `h2_count`,NULL AS `h3_id`,NULL AS `h3`,NULL AS `h3_title_en`,NULL AS `h3_title`,NULL AS `h3_intro_en`,NULL AS `h3_intro`,NULL AS `h3_start`,NULL AS `h3_count`,`h1`.`numInChapter` AS `numInChapter` from (`books` `b` join (`toc` `t1` left join `hadiths` `h1` on(((`h1`.`tocId` = `t1`.`id`) and (`h1`.`num0` = `t1`.`start0`))))) where ((`b`.`virtual` = 0) and (`b`.`id` = `t1`.`bookId`) and (`t1`.`level` = 1)) union select `t2`.`id` AS `hId`,`t2`.`id` AS `tId`,'toc' AS `doctype`,`t2`.`level` AS `level`,`b`.`id` AS `book_id`,`b`.`alias` AS `book_alias`,`b`.`shortName_en` AS `book_shortName_en`,`b`.`shortName` AS `book_shortName`,`b`.`name_en` AS `book_name_en`,`b`.`name` AS `book_name`,`b`.`author` AS `book_author`,`b`.`virtual` AS `book_virtual`,`t1`.`id` AS `h1_id`,`t1`.`h1` AS `h1`,`t1`.`title_en` AS `h1_title_en`,`t1`.`title` AS `h1_title`,`t1`.`intro_en` AS `h1_intro_en`,`t1`.`intro` AS `h1_intro`,`t1`.`start` AS `h1_start`,`t1`.`count` AS `h1_count`,`t2`.`id` AS `h2_id`,`t2`.`h2` AS `h2`,`t2`.`title_en` AS `h2_title_en`,`t2`.`title` AS `h2_title`,`t2`.`intro_en` AS `h2_intro_en`,`t2`.`intro` AS `h2_intro`,`t2`.`start` AS `h2_start`,`t2`.`count` AS `h2_count`,NULL AS `h3_id`,NULL AS `h3`,NULL AS `h3_title_en`,NULL AS `h3_title`,NULL AS `h3_intro_en`,NULL AS `h3_intro`,NULL AS `h3_start`,NULL AS `h3_count`,`h2`.`numInChapter` AS `numInChapter` from ((`books` `b` join `toc` `t1`) join (`toc` `t2` left join `hadiths` `h2` on(((`h2`.`tocId` = `t2`.`id`) and (`h2`.`num0` = `t2`.`start0`))))) where ((`b`.`virtual` = 0) and (`b`.`id` = `t1`.`bookId`) and (`t1`.`level` = 1) and (`t2`.`bookId` = `t1`.`bookId`) and (`t2`.`level` = 2) and (`t2`.`h1` = `t1`.`h1`)) union select `t3`.`id` AS `hId`,`t3`.`id` AS `tId`,'toc' AS `doctype`,`t3`.`level` AS `level`,`b`.`id` AS `book_id`,`b`.`alias` AS `book_alias`,`b`.`shortName_en` AS `book_shortName_en`,`b`.`shortName` AS `book_shortName`,`b`.`name_en` AS `book_name_en`,`b`.`name` AS `book_name`,`b`.`author` AS `book_author`,`b`.`virtual` AS `book_virtual`,`t1`.`id` AS `h1_id`,`t1`.`h1` AS `h1`,`t1`.`title_en` AS `h1_title_en`,`t1`.`title` AS `h1_title`,`t1`.`intro_en` AS `h1_intro_en`,`t1`.`intro` AS `h1_intro`,`t1`.`start` AS `h1_start`,`t1`.`count` AS `h1_count`,`t2`.`id` AS `h2_id`,`t2`.`h2` AS `h2`,`t2`.`title_en` AS `h2_title_en`,`t2`.`title` AS `h2_title`,`t2`.`intro_en` AS `h2_intro_en`,`t2`.`intro` AS `h2_intro`,`t2`.`start` AS `h2_start`,`t2`.`count` AS `h2_count`,`t3`.`id` AS `h3_id`,`t3`.`h2` AS `h3`,`t3`.`title_en` AS `h3_title_en`,`t3`.`title` AS `h3_title`,`t3`.`intro_en` AS `h3_intro_en`,`t3`.`intro` AS `h3_intro`,`t3`.`start` AS `h3_start`,`t3`.`count` AS `h3_count`,`h3`.`numInChapter` AS `numInChapter` from (((`books` `b` join `toc` `t1`) join `toc` `t2`) join (`toc` `t3` left join `hadiths` `h3` on(((`h3`.`tocId` = `t3`.`id`) and (`h3`.`num0` = `t3`.`start0`))))) where ((`b`.`virtual` = 0) and (`b`.`id` = `t1`.`bookId`) and (`t1`.`level` = 1) and (`t2`.`bookId` = `t1`.`bookId`) and (`t2`.`level` = 2) and (`t2`.`h1` = `t1`.`h1`) and (`t3`.`bookId` = `t2`.`bookId`) and (`t3`.`level` = 3) and (`t3`.`h1` = `t2`.`h1`) and (`t3`.`h2` = `t2`.`h2`)) union select `t1`.`id` AS `hId`,`t1`.`id` AS `tId`,'toc' AS `doctype`,`t1`.`level` AS `level`,`b`.`id` AS `book_id`,`b`.`alias` AS `book_alias`,`b`.`shortName_en` AS `book_shortName_en`,`b`.`shortName` AS `book_shortName`,`b`.`name_en` AS `book_name_en`,`b`.`name` AS `book_name`,`b`.`author` AS `book_author`,`b`.`virtual` AS `book_virtual`,`t1`.`id` AS `h1_id`,`t1`.`h1` AS `h1`,`t1`.`title_en` AS `h1_title_en`,`t1`.`title` AS `h1_title`,`t1`.`intro_en` AS `h1_intro_en`,`t1`.`intro` AS `h1_intro`,`t1`.`start` AS `h1_start`,`t1`.`count` AS `h1_count`,NULL AS `h2_id`,NULL AS `h2`,NULL AS `h2_title_en`,NULL AS `h2_title`,NULL AS `h2_intro_en`,NULL AS `h2_intro`,NULL AS `h2_start`,NULL AS `h2_count`,NULL AS `h3_id`,NULL AS `h3`,NULL AS `h3_title_en`,NULL AS `h3_title`,NULL AS `h3_intro_en`,NULL AS `h3_intro`,NULL AS `h3_start`,NULL AS `h3_count`,`h1`.`numInChapter` AS `numInChapter` from (`books` `b` join (`toc` `t1` left join `hadiths_virtual` `h1` on(((`h1`.`tocId` = `t1`.`id`) and (`h1`.`num0` = `t1`.`start0`))))) where ((`b`.`virtual` = 1) and (`b`.`id` = `t1`.`bookId`) and (`t1`.`level` = 1)) union select `t2`.`id` AS `hId`,`t2`.`id` AS `tId`,'toc' AS `doctype`,`t2`.`level` AS `level`,`b`.`id` AS `book_id`,`b`.`alias` AS `book_alias`,`b`.`shortName_en` AS `book_shortName_en`,`b`.`shortName` AS `book_shortName`,`b`.`name_en` AS `book_name_en`,`b`.`name` AS `book_name`,`b`.`author` AS `book_author`,`b`.`virtual` AS `book_virtual`,`t1`.`id` AS `h1_id`,`t1`.`h1` AS `h1`,`t1`.`title_en` AS `h1_title_en`,`t1`.`title` AS `h1_title`,`t1`.`intro_en` AS `h1_intro_en`,`t1`.`intro` AS `h1_intro`,`t1`.`start` AS `h1_start`,`t1`.`count` AS `h1_count`,`t2`.`id` AS `h2_id`,`t2`.`h2` AS `h2`,`t2`.`title_en` AS `h2_title_en`,`t2`.`title` AS `h2_title`,`t2`.`intro_en` AS `h2_intro_en`,`t2`.`intro` AS `h2_intro`,`t2`.`start` AS `h2_start`,`t2`.`count` AS `h2_count`,NULL AS `h3_id`,NULL AS `h3`,NULL AS `h3_title_en`,NULL AS `h3_title`,NULL AS `h3_intro_en`,NULL AS `h3_intro`,NULL AS `h3_start`,NULL AS `h3_count`,`h2`.`numInChapter` AS `numInChapter` from ((`books` `b` join `toc` `t1`) join (`toc` `t2` left join `hadiths_virtual` `h2` on(((`h2`.`tocId` = `t2`.`id`) and (`h2`.`num0` = `t2`.`start0`))))) where ((`b`.`virtual` = 1) and (`b`.`id` = `t1`.`bookId`) and (`t1`.`level` = 1) and (`t2`.`bookId` = `t1`.`bookId`) and (`t2`.`level` = 2) and (`t2`.`h1` = `t1`.`h1`)) union select `t3`.`id` AS `hId`,`t3`.`id` AS `tId`,'toc' AS `doctype`,`t3`.`level` AS `level`,`b`.`id` AS `book_id`,`b`.`alias` AS `book_alias`,`b`.`shortName_en` AS `book_shortName_en`,`b`.`shortName` AS `book_shortName`,`b`.`name_en` AS `book_name_en`,`b`.`name` AS `book_name`,`b`.`author` AS `book_author`,`b`.`virtual` AS `book_virtual`,`t1`.`id` AS `h1_id`,`t1`.`h1` AS `h1`,`t1`.`title_en` AS `h1_title_en`,`t1`.`title` AS `h1_title`,`t1`.`intro_en` AS `h1_intro_en`,`t1`.`intro` AS `h1_intro`,`t1`.`start` AS `h1_start`,`t1`.`count` AS `h1_count`,`t2`.`id` AS `h2_id`,`t2`.`h2` AS `h2`,`t2`.`title_en` AS `h2_title_en`,`t2`.`title` AS `h2_title`,`t2`.`intro_en` AS `h2_intro_en`,`t2`.`intro` AS `h2_intro`,`t2`.`start` AS `h2_start`,`t2`.`count` AS `h2_count`,`t3`.`id` AS `h3_id`,`t3`.`h3` AS `h3`,`t3`.`title_en` AS `h3_title_en`,`t3`.`title` AS `h3_title`,`t3`.`intro_en` AS `h3_intro_en`,`t3`.`intro` AS `h3_intro`,`t3`.`start` AS `h3_start`,`t3`.`count` AS `h3_count`,`h3`.`numInChapter` AS `numInChapter` from (((`books` `b` join `toc` `t1`) join `toc` `t2`) join (`toc` `t3` left join `hadiths_virtual` `h3` on(((`h3`.`tocId` = `t3`.`id`) and (`h3`.`num0` = `t3`.`start0`))))) where ((`b`.`virtual` = 1) and (`b`.`id` = `t1`.`bookId`) and (`t1`.`level` = 1) and (`t2`.`bookId` = `t1`.`bookId`) and (`t2`.`level` = 2) and (`t2`.`h1` = `t1`.`h1`) and (`t3`.`bookId` = `t2`.`bookId`) and (`t3`.`level` = 3) and (`t3`.`h1` = `t2`.`h1`) and (`t3`.`h2` = `t2`.`h2`)) order by `book_id`,`h1`,`numInChapter` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `v_tags`
--

/*!50001 DROP VIEW IF EXISTS `v_tags`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`adnanmukhtar`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `v_tags` AS select `t`.`id` AS `id`,`t`.`text_en` AS `text_en`,`t`.`text` AS `text`,`t`.`description` AS `description`,coalesce(count(`ht`.`hadithId`),0) AS `cnt_used` from (`tags` `t` left join `hadiths_tags` `ht` on((`t`.`id` = `ht`.`tagId`))) group by `t`.`text_en` order by `cnt_used` desc,`t`.`text_en` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Dumping routines for database 'hadithdb'
--
/*!50003 DROP FUNCTION IF EXISTS `remove_tashkil` */;
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
CREATE DEFINER=`adnanmukhtar`@`%` FUNCTION `remove_tashkil`(s MEDIUMTEXT) RETURNS mediumtext CHARSET utf8mb3 COLLATE utf8mb3_unicode_ci
    DETERMINISTIC
BEGIN
	SET @re="[\\u064B-\\u0652\\u0670\\:«»\\(\\)\"\'\\.\\,\\{\\}\\[\\]\\-،۔ﷺـ]";
RETURN regexp_replace(s, @re, "");
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
ALTER DATABASE `hadithdb` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ;
/*!50003 DROP PROCEDURE IF EXISTS `log` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`adnanmukhtar`@`%` PROCEDURE `log`(IN p_message VARCHAR(512))
BEGIN
	INSERT INTO log (message) VALUES(p_message);
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `merge_tags` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`adnanmukhtar`@`%` PROCEDURE `merge_tags`(IN oldtag VARCHAR(255), IN newtag VARCHAR(255))
BEGIN
	SET @oldt = (SELECT id FROM tags WHERE text_en = oldtag);
	SET @newt = (SELECT id FROM tags WHERE text_en = newtag);
	UPDATE IGNORE
		hadiths_tags ht
	SET 
		ht.tagId = @newt
	WHERE 
		ht.tagId = @oldt;
	DELETE FROM tags WHERE id=@oldt;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `reset_counts` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`adnanmukhtar`@`%` PROCEDURE `reset_counts`()
BEGIN
	set sql_safe_updates = 0;
    
	-- update TOC counts
	create temporary table counts (
        select bookId, tocId, h1, h2, h3, count(*) cnt from hadiths group by bookId, tocId, h1, h2, h3
        );
	update toc set count = 0;
	update toc, counts set toc.count = counts.cnt where toc.id = counts.tocId;
	drop table counts;
    create temporary table counts (
		select bookId, h1, count(*) cnt from hadiths group by bookId, h1
		);
	update toc, counts set toc.count = counts.cnt where toc.bookId = counts.bookId and toc.h1=counts.h1 and h2 is null and h3 is null;
	drop table counts;

	-- update Virtual TOC counts
	create temporary table counts (
        select bookId, tocId, h1, h2, h3, count(*) cnt from hadiths_virtual group by bookId, tocId, h1, h2, h3
        );
	update toc t, books b set t.count = 0 where t.bookId=b.id and b.`virtual`=1;
	update toc, counts set toc.count = counts.cnt where toc.id = counts.tocId;
	drop table counts;
    create temporary table counts (
		select bookId, h1, count(*) cnt from hadiths_virtual group by bookId, h1
		);
	update toc, counts set toc.count = counts.cnt where toc.bookId = counts.bookId and toc.h1=counts.h1 and h2 is null and h3 is null;
    drop table counts;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `reset_ordinals` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`adnanmukhtar`@`%` PROCEDURE `reset_ordinals`()
BEGIN
    
    CALL log('Resetting Ordinals');
	SET sql_safe_updates = 0;
    
    SET @n := 0;
    UPDATE toc SET ordinal=(@n:=@n+1) ORDER BY bookId,h1,h2,h3;
    CALL log('Completed resetting for TABLE toc');
    
	SET @n := 0;
    UPDATE hadiths SET ordinal=(@n:=@n+1) ORDER BY bookId,h1,numInChapter;
    CALL log('Completed resetting for TABLE hadiths');

END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 DROP PROCEDURE IF EXISTS `sequence` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE DEFINER=`adnanmukhtar`@`%` PROCEDURE `sequence`(IN start_number INT, IN end_number INT)
BEGIN
  DECLARE i INT DEFAULT start_number;
  drop table temp_sequence;
  CREATE TEMPORARY TABLE temp_sequence (value INT);
  WHILE i <= end_number DO
    INSERT INTO temp_sequence (value) VALUES (i);
    SET i = i + 1;
  END WHILE;
  SELECT * FROM temp_sequence;
END ;;
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

-- Dump completed on 2023-07-10 23:56:10
