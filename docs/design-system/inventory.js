const pages = [
  {
    "key": "home",
    "name": "Hadith home",
    "group": "Discovery",
    "path": "/",
    "final": "/",
    "title": "Ḥadīth Unlocked | A comprehensive collection and search for Hadith",
    "status": 200
  },
  {
    "key": "about",
    "name": "About",
    "group": "Discovery",
    "path": "/about",
    "final": "/about",
    "title": "About Hadith Unlocked",
    "status": 200
  },
  {
    "key": "mcp",
    "name": "MCP server overview",
    "group": "Discovery",
    "path": "/mcp-server",
    "final": "/mcp-server",
    "title": "Ask Islamic questions with sources | Hadith Unlocked for AI",
    "status": 200
  },
  {
    "key": "library",
    "name": "Hadith catalog",
    "group": "Discovery",
    "path": "/books",
    "final": "/books",
    "title": "Hadith Unlocked | Hadith Books",
    "status": 200
  },
  {
    "key": "history",
    "name": "History catalog",
    "group": "Discovery",
    "path": "/books?history",
    "final": "/books?history",
    "title": "Hadith Unlocked | History Books",
    "status": 200
  },
  {
    "key": "sharh-list",
    "name": "Sharh catalog",
    "group": "Discovery",
    "path": "/books?sharh",
    "final": "/books?sharh",
    "title": "Hadith Unlocked | Hadith Explanations",
    "status": 200
  },
  {
    "key": "translations",
    "name": "Translation catalog",
    "group": "Discovery",
    "path": "/books?translation",
    "final": "/books?translation",
    "title": "Hadith Unlocked | Quran Translations",
    "status": 200
  },
  {
    "key": "tafsirs",
    "name": "Tafsir catalog",
    "group": "Discovery",
    "path": "/books?tafsir",
    "final": "/books?tafsir",
    "title": "Hadith Unlocked | Tafsir Books",
    "status": 200
  },
  {
    "key": "mushafs",
    "name": "Mushaf catalog",
    "group": "Discovery",
    "path": "/books?mushaf",
    "final": "/books?mushaf",
    "title": "Hadith Unlocked | Quran Mushafs",
    "status": 200
  },
  {
    "key": "search",
    "name": "Hadith search results",
    "group": "Discovery",
    "path": "/?q=mercy",
    "final": "/?q=mercy",
    "title": "Search Results for mercy",
    "status": 200
  },
  {
    "key": "qsearch",
    "name": "Quran search results",
    "group": "Discovery",
    "path": "/quran?q=mercy",
    "final": "/quran?q=mercy",
    "title": "Search Results for mercy",
    "status": 200
  },
  {
    "key": "empty-search",
    "name": "Empty search results",
    "group": "Discovery",
    "path": "/?q=xyzqzxqz",
    "final": "/?q=xyzqzxqz",
    "title": "Search Results for xyzqzxqz",
    "status": 200
  },
  {
    "key": "command",
    "name": "Global search dialog",
    "group": "Discovery",
    "path": "/books",
    "final": "/books",
    "title": "command",
    "status": 200
  },
  {
    "key": "menu",
    "name": "Site navigation drawer",
    "group": "Discovery",
    "path": "/books",
    "final": "/books",
    "title": "menu",
    "status": 200
  },
  {
    "key": "collection",
    "name": "Hadith collection contents",
    "group": "Hadith, Sharh & history",
    "path": "/bukhari",
    "final": "/bukhari",
    "title": "Sahih al-Bukhari | Abu Abdullah Muhammad b. Ismail al-Bukhari",
    "status": 200
  },
  {
    "key": "book-intro",
    "name": "Authored book introduction",
    "group": "Hadith, Sharh & history",
    "path": "/adab/introduction",
    "final": "/adab/introduction",
    "title": "Introduction | al-Adab al-Mufrad",
    "status": 200
  },
  {
    "key": "chapter",
    "name": "Chapter entry redirect",
    "group": "Hadith, Sharh & history",
    "path": "/bukhari/1",
    "final": "/bukhari/1/1",
    "title": "Bukhari §1.1 | Beginning of Waḥī (Divine Revelation): How the Divine Revelation started to be revealed to the Messenger of Allah ﷺ",
    "status": 200
  },
  {
    "key": "hadith-chapter",
    "name": "Chapter entry · Book of Faith",
    "group": "Hadith, Sharh & history",
    "path": "/bukhari/2",
    "final": "/bukhari/2/1",
    "title": "Bukhari §2.1 | Īmān (Faith / Belief): Belief and the statement of the Prophet ﷺ \"Islām is founded on five.\"",
    "status": 200
  },
  {
    "key": "section",
    "name": "Hadith section",
    "group": "Hadith, Sharh & history",
    "path": "/bukhari/1/1",
    "final": "/bukhari/1/1",
    "title": "Bukhari §1.1 | Beginning of Waḥī (Divine Revelation): How the Divine Revelation started to be revealed to the Messenger of Allah ﷺ",
    "status": 200
  },
  {
    "key": "subsection",
    "name": "Hadith subsection entry",
    "group": "Hadith, Sharh & history",
    "path": "/bukhari/65/2/1",
    "final": "/bukhari/65/2",
    "title": "Bukhari §65.2, pg. 1 | Tafsir (Quranic Exegesis): Surat al-Baqarah (The Cow)",
    "status": 200
  },
  {
    "key": "hadith",
    "name": "Individual hadith",
    "group": "Hadith, Sharh & history",
    "path": "/bukhari:1",
    "final": "/bukhari:1",
    "title": "Sahih al-Bukhari 1 — The value of deeds is based on the intentions behind them",
    "status": 200
  },
  {
    "key": "sharh-book",
    "name": "Sharh book and coverage",
    "group": "Hadith, Sharh & history",
    "path": "/sharh/bukhari-ibnhajar",
    "final": "/sharh/bukhari-ibnhajar",
    "title": "Fatḥ al-Bārī",
    "status": 200
  },
  {
    "key": "sharh",
    "name": "Sharh on a hadith",
    "group": "Hadith, Sharh & history",
    "path": "/sharh/bukhari-ibnhajar/bukhari:1",
    "final": "/sharh/bukhari-ibnhajar/bukhari:1",
    "title": "Bukhari 1 | Fatḥ al-Bārī (Ibn Hajar al-Asqalani)",
    "status": 200
  },
  {
    "key": "history-item",
    "name": "History passage",
    "group": "Hadith, Sharh & history",
    "path": "/history:1",
    "final": "/history:1",
    "title": "islamweb Islamic History 1 — ✧ God creates the heavens and earth in six days",
    "status": 200
  },
  {
    "key": "sirah",
    "name": "Sirah passage",
    "group": "Hadith, Sharh & history",
    "path": "/yqsirah:1",
    "final": "/yqsirah:1",
    "title": "Yasir Qadhi's Seerah 1 — Introducing the Prophet ﷺ",
    "status": 200
  },
  {
    "key": "quran",
    "name": "Quran home",
    "group": "Quran & memorization",
    "path": "/quran",
    "final": "/quran",
    "title": "Quran Unlocked | Your Companion for Deeper Quran Study",
    "status": 200
  },
  {
    "key": "surah",
    "name": "Surah entry",
    "group": "Quran & memorization",
    "path": "/quran/2",
    "final": "/quran/2/1",
    "title": "Surah al-Baqarah §2.1 | Guidance for the mindful and warning to disbelievers",
    "status": 200
  },
  {
    "key": "ayah",
    "name": "Individual ayah",
    "group": "Quran & memorization",
    "path": "/quran:2:255",
    "final": "/quran:2:255",
    "title": "Surah al-Baqarah 2:255 | Charity is urged before God's supreme authority is declared",
    "status": 200
  },
  {
    "key": "passage",
    "name": "Ayah range",
    "group": "Quran & memorization",
    "path": "/passage:2:255-257",
    "final": "/passage:2:255-257",
    "title": "Surah al-Baqarah 2:255-257 | §2.23 Charity is urged before God's supreme authority is declared",
    "status": 200
  },
  {
    "key": "juz",
    "name": "Juz entry",
    "group": "Quran & memorization",
    "path": "/quran/juz/1",
    "final": "/quran/1/1",
    "title": "Surah al-Fātiḥah §1.1 | God teaches His servants to seek the straight path",
    "status": 200
  },
  {
    "key": "manzil",
    "name": "Manzil entry",
    "group": "Quran & memorization",
    "path": "/quran/manzil/1",
    "final": "/quran/1/1",
    "title": "Surah al-Fātiḥah §1.1 | God teaches His servants to seek the straight path",
    "status": 200
  },
  {
    "key": "mushaf",
    "name": "Mushaf page",
    "group": "Quran & memorization",
    "path": "/quran/page/42",
    "final": "/quran/page/42",
    "title": "Quran Mushaf Page 42 | Ayat 2:253-2:256",
    "status": 200
  },
  {
    "key": "warsh",
    "name": "Warsh script",
    "group": "Quran & memorization",
    "path": "/quran/page/1?script=warsh",
    "final": "/quran/page/1?script=warsh",
    "title": "Quran Mushaf Page 1 | Ayat 1:1-1:7",
    "status": 200
  },
  {
    "key": "indopak",
    "name": "Indo-Pak script",
    "group": "Quran & memorization",
    "path": "/quran/page/1?script=indo-pak",
    "final": "/quran/page/1?script=indo-pak",
    "title": "Quran Mushaf Page 1 | Ayat 1:1-1:7",
    "status": 200
  },
  {
    "key": "memorize",
    "name": "Mushaf practice onboarding",
    "group": "Quran & memorization",
    "path": "/quran/page/42?memorize",
    "final": "/quran/page/42?memorize",
    "title": "Quran Practice Page 42 | Ayat 2:253-2:256",
    "status": 200
  },
  {
    "key": "review",
    "name": "Mudhakkir landing",
    "group": "Quran & memorization",
    "path": "/quran/review",
    "final": "/quran/review",
    "title": "Mudhakkir: Keep your Quran hifz fresh",
    "status": 200
  },
  {
    "key": "help",
    "name": "Mudhakkir help",
    "group": "Quran & memorization",
    "path": "/quran/review?help",
    "final": "/quran/review?help",
    "title": "Mudhakkir: Keep your Quran hifz fresh",
    "status": 200
  },
  {
    "key": "recall",
    "name": "Recall entry · signed out",
    "group": "Quran & memorization",
    "path": "/quran/review?start",
    "final": "/quran/review?signedOut=1",
    "title": "Mudhakkir: Keep your Quran hifz fresh",
    "status": 200
  },
  {
    "key": "contents",
    "name": "Quran navigation drawer",
    "group": "Quran & memorization",
    "path": "/quran/page/42",
    "final": "/quran/page/42",
    "title": "contents",
    "status": 200
  },
  {
    "key": "audio",
    "name": "Reciter picker",
    "group": "Quran & memorization",
    "path": "/quran/2/1",
    "final": "/quran/2/1",
    "title": "audio",
    "status": 200
  },
  {
    "key": "translation-picker",
    "name": "Translation picker",
    "group": "Quran & memorization",
    "path": "/quran/2/1",
    "final": "/quran/2/1",
    "title": "translation-picker",
    "status": 200
  },
  {
    "key": "reflections",
    "name": "Reflection action · sign-in feedback",
    "group": "Quran & memorization",
    "path": "/quran:2:255",
    "final": "/quran:2:255",
    "title": "reflections",
    "status": 200
  },
  {
    "key": "tafsir-book",
    "name": "Tafsir book contents",
    "group": "Tafsir & translations",
    "path": "/quran/tafsir/mokhtasar",
    "final": "/quran/tafsir/mokhtasar",
    "title": "al-Tafsir al-Mukhtasar | Tafsir Center for Quranic Studies",
    "status": 200
  },
  {
    "key": "tafsir-intro",
    "name": "Tafsir introduction",
    "group": "Tafsir & translations",
    "path": "/quran/tafsir/mokhtasar/introduction",
    "final": "/quran/tafsir/mokhtasar/introduction",
    "title": "Introduction by the author | Tafsir Mokhtasar",
    "status": 200
  },
  {
    "key": "tafsir-surah",
    "name": "Tafsir surah entry",
    "group": "Tafsir & translations",
    "path": "/quran/tafsir/mokhtasar/2",
    "final": "/quran/tafsir/mokhtasar/quran:2:1",
    "title": "Tafsir Mokhtasar §2.1 | Ayat 2:1",
    "status": 200
  },
  {
    "key": "tafsir-juz",
    "name": "Tafsir juz entry",
    "group": "Tafsir & translations",
    "path": "/quran/tafsir/mokhtasar/juz/1",
    "final": "/quran/tafsir/mokhtasar/quran:1:1",
    "title": "Tafsir Mokhtasar §1.1 | Ayat 1:1",
    "status": 200
  },
  {
    "key": "tafsir-manzil",
    "name": "Tafsir manzil entry",
    "group": "Tafsir & translations",
    "path": "/quran/tafsir/mokhtasar/manzil/1",
    "final": "/quran/tafsir/mokhtasar/quran:1:0",
    "title": "Tafsir Mokhtasar §1.1 | Ayat 1:0",
    "status": 200
  },
  {
    "key": "tafsir-sub",
    "name": "Tafsir subsection",
    "group": "Tafsir & translations",
    "path": "/quran/tafsir/mokhtasar/2/1/1",
    "final": "/quran/tafsir/mokhtasar/quran:2:1",
    "title": "Tafsir Mokhtasar §2.1 | Ayat 2:1",
    "status": 200
  },
  {
    "key": "tafsir",
    "name": "Tafsir on an ayah",
    "group": "Tafsir & translations",
    "path": "/quran/tafsir/mokhtasar/2/255",
    "final": "/quran/tafsir/mokhtasar/quran:2:255",
    "title": "Tafsir Mokhtasar §2.23 | Ayat 2:255",
    "status": 200
  },
  {
    "key": "tafsir-range",
    "name": "Tafsir on a range",
    "group": "Tafsir & translations",
    "path": "/quran/tafsir/mokhtasar/quran:2:255-257",
    "final": "/quran/tafsir/mokhtasar/quran:2:255",
    "title": "Tafsir Mokhtasar §2.23 | Ayat 2:255",
    "status": 200
  },
  {
    "key": "trans-book",
    "name": "Translation book contents",
    "group": "Tafsir & translations",
    "path": "/quran/en-saheeh-intl",
    "final": "/quran/en-saheeh-intl",
    "title": "Translation: Saheeh International | Assami-Bantley-Kennedy",
    "status": 200
  },
  {
    "key": "trans-chapter",
    "name": "Translation surah entry · 404",
    "group": "Tafsir & translations",
    "path": "/quran/en-saheeh-intl/2",
    "final": "/quran/error/404/quran/en-saheeh-intl/2",
    "title": "Error 404 | Not Found",
    "status": 404
  },
  {
    "key": "trans-intro",
    "name": "Translation introduction · 404",
    "group": "Tafsir & translations",
    "path": "/quran/en-saheeh-intl/introduction",
    "final": "/quran/error/404/quran/en-saheeh-intl/introduction",
    "title": "Error 404 | Not Found",
    "status": 404
  },
  {
    "key": "trans-juz",
    "name": "Translation juz entry",
    "group": "Tafsir & translations",
    "path": "/quran/en-saheeh-intl/juz/1",
    "final": "/quran/en-saheeh-intl/1/1",
    "title": "Surah al-Fātiḥah §1.1 | Saheeh Int'l | God teaches His servants to seek the straight path",
    "status": 200
  },
  {
    "key": "trans-manzil",
    "name": "Translation manzil entry",
    "group": "Tafsir & translations",
    "path": "/quran/en-saheeh-intl/manzil/1",
    "final": "/quran/1/1",
    "title": "Surah al-Fātiḥah §1.1 | God teaches His servants to seek the straight path",
    "status": 200
  },
  {
    "key": "trans-section",
    "name": "Translation section",
    "group": "Tafsir & translations",
    "path": "/quran/en-saheeh-intl/2/1",
    "final": "/quran/en-saheeh-intl/2/1",
    "title": "Surah al-Baqarah §2.1 | Saheeh Int'l | Guidance for the mindful and warning to disbelievers",
    "status": 200
  },
  {
    "key": "trans-sub",
    "name": "Translation subsection",
    "group": "Tafsir & translations",
    "path": "/quran/en-saheeh-intl/2/1/1",
    "final": "/quran/en-saheeh-intl/2/1",
    "title": "Surah al-Baqarah §2.1 | Saheeh Int'l | Guidance for the mindful and warning to disbelievers",
    "status": 200
  },
  {
    "key": "trans-range",
    "name": "Translation passage range",
    "group": "Tafsir & translations",
    "path": "/quran/en-saheeh-intl/quran:2:255-257",
    "final": "/quran/en-saheeh-intl/quran:2:255",
    "title": "Surah al-Baqarah 2:255-257 | §2.23 Charity is urged before God's supreme authority is declared",
    "status": 200
  },
  {
    "key": "translation",
    "name": "Translations for one ayah",
    "group": "Tafsir & translations",
    "path": "/quran/translations/quran:2:255",
    "final": "/quran/translations/quran:2:255",
    "title": "Surah al-Baqarah 2:255 | God's authority over faith, life, and death defeats denial | Quran Translations",
    "status": 200
  },
  {
    "key": "community",
    "name": "Community feed",
    "group": "Community & articles",
    "path": "/community",
    "final": "/community",
    "title": "Hadith Unlocked Community",
    "status": 200
  },
  {
    "key": "community-article",
    "name": "Community article feed",
    "group": "Community & articles",
    "path": "/community?filter=article",
    "final": "/community?filter=article",
    "title": "Hadith Unlocked Community",
    "status": 200
  },
  {
    "key": "following",
    "name": "Following · signed out",
    "group": "Community & articles",
    "path": "/community/following",
    "final": "/community/following",
    "title": "Following",
    "status": 200
  },
  {
    "key": "mine",
    "name": "My profile · signed out",
    "group": "Community & articles",
    "path": "/community/mine",
    "final": "/community/mine",
    "title": "My Profile",
    "status": 200
  },
  {
    "key": "compose",
    "name": "Article editor · signed out",
    "group": "Community & articles",
    "path": "/community/write",
    "final": "/community/write",
    "title": "Write an article",
    "status": 200
  },
  {
    "key": "preferences",
    "name": "Email preferences · signed out",
    "group": "Community & articles",
    "path": "/community/email-preferences",
    "final": "/community/email-preferences",
    "title": "Email preferences",
    "status": 200
  },
  {
    "key": "profile",
    "name": "Contributor profile · signed out",
    "group": "Community & articles",
    "path": "/community/@hadithunlocked",
    "final": "/community/@hadithunlocked",
    "title": "Profile",
    "status": 200
  },
  {
    "key": "post",
    "name": "Individual Community post",
    "group": "Community & articles",
    "path": "/community/@i.adnan.mukhtar/2032",
    "final": "/community/p/b73f79d5-3a16-4fce-8ade-99ba1cf39144",
    "title": "Adnan (@i.adnan.mukhtar)",
    "status": 200
  },
  {
    "key": "community-story",
    "name": "Community article",
    "group": "Community & articles",
    "path": "/community/p/64a936a0-39b3-4bc9-a2ee-10fff93f10cf",
    "final": "/community/p/64a936a0-39b3-4bc9-a2ee-10fff93f10cf",
    "title": "The Prophecies of the Prophet ﷺ, Part Two: Later Signs and Answers to Doubt — Adnan",
    "status": 200
  },
  {
    "key": "moderation",
    "name": "Moderation entry redirect",
    "group": "Community & articles",
    "path": "/community/moderation",
    "final": "/community/mine",
    "title": "My Profile",
    "status": 200
  },
  {
    "key": "articles",
    "name": "Blog archive",
    "group": "Community & articles",
    "path": "/blog",
    "final": "/blog",
    "title": "Pearls of the Deep Blog",
    "status": 200
  },
  {
    "key": "article",
    "name": "Blog article",
    "group": "Community & articles",
    "path": "/blog/Iddah%20and%20Mourning",
    "final": "/blog/Iddah%20and%20Mourning",
    "title": "Pearls | The Iddah and the Mourning Period for a Widow — Adnan",
    "status": 200
  },
  {
    "key": "notes",
    "name": "Notebook · signed out",
    "group": "Personal tools & system",
    "path": "/notebook",
    "final": "/notebook",
    "title": "My Notebook",
    "status": 200
  },
  {
    "key": "saved",
    "name": "Bookmarks · empty",
    "group": "Personal tools & system",
    "path": "/bookmarks",
    "final": "/bookmarks",
    "title": "Bookmarks",
    "status": 200
  },
  {
    "key": "settings",
    "name": "Settings",
    "group": "Personal tools & system",
    "path": "/settings",
    "final": "/settings",
    "title": "Settings",
    "status": 200
  },
  {
    "key": "terms",
    "name": "Terms",
    "group": "Personal tools & system",
    "path": "/terms",
    "final": "/terms",
    "title": "Terms of Service | Hadith Unlocked",
    "status": 200
  },
  {
    "key": "privacy",
    "name": "Privacy",
    "group": "Personal tools & system",
    "path": "/html/privacy.html",
    "final": "/html/privacy.html",
    "title": "Privacy Policy | Hadith Unlocked",
    "status": 200
  },
  {
    "key": "offline",
    "name": "Service restarting",
    "group": "Personal tools & system",
    "path": "/html/_app_restarting.html",
    "final": "/html/_app_restarting.html",
    "title": "We'll be right back | Hadith Unlocked",
    "status": 200
  },
  {
    "key": "error",
    "name": "Page not found",
    "group": "Personal tools & system",
    "path": "/error/404",
    "final": "/error/404",
    "title": "Error 404 | Not Found",
    "status": 404
  },
  {
    "key": "public-slides",
    "name": "Standalone slideshow",
    "group": "Personal tools & system",
    "path": "/html/masjidalhusna-slides.html",
    "final": "/html/masjidalhusna-slides.html",
    "title": "",
    "status": 200
  }
];
