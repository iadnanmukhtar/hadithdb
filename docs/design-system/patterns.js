// The specimen markup is local, illustrative content. Evidence keys resolve to captured pages.
const patterns = [
  {
    name: 'Reader modes', evidence: ['ayah','tafsir'], source: 'quran_reader_modes',
    observed: 'The ayah header has a compact mode strip. Tafsir adds another row for switching books. At phone width these two choices compete for the same horizontal space.',
    standard: 'Keep one persistent row for reading mode. Put the selected commentary or translation in a separate, labeled source picker below it. Carry the current ayah into every destination.',
    check: 'Show the current mode in text and expose aria-current on its link. Changing the source must preserve the passage.',
    sample: '<div class="row between"><strong>Al-Baqarah 2:255</strong><span class="chip">Quran</span></div><hr><div class="row"><button data-mode="passage" aria-pressed="false">Passage</button><button data-mode="tafsir" aria-pressed="true">Tafsir</button><button data-mode="mushaf" aria-pressed="false">Mushaf</button></div><div class="mode-context"></div>'
  },
  {
    name: 'Navigation & rails', evidence: ['menu','contents'], source: 'offcanvas_primary_nav',
    observed: 'The site menu and Quran navigator both open left drawers. One lists site destinations and books, the other lists divisions within the Quran. Reader pages also display a contents rail and bottom controls.',
    standard: 'Reserve Menu for site destinations and Contents for movement within a work. Use the same current-location marker in the rail and drawer. Keep previous and next controls in a stable order.',
    check: 'Give each drawer a distinct accessible name, focus its heading on open and return focus to its trigger on close. Verify the bottom bar clears the last item.',
    sample: '<strong>Contents</strong><p class="sub">Quran · Surahs</p><hr><div>1. Al-Fatihah</div><div class="notice"><strong>2. Al-Baqarah</strong> · Current surah</div><div>3. Ali Imran</div>'
  },
  {
    name: 'Search & filters', evidence: ['command','qsearch'], source: 'global_search_dialog',
    observed: 'Global search opens a dialog. The results page puts filters beside bilingual results on desktop, while book catalogs have their own filter field and view controls.',
    standard: 'Name the scope beside the input. Echo active filters and the result count beside the results. Preserve query and filters when opening a result and returning.',
    check: 'Keep a visible field label, announce result counts after filtering and provide a clear recovery action for zero matches.',
    sample: '<label>Search the Quran<input type="search" value="mercy" readonly></label><div class="row"><span class="chip">Quran</span><span class="chip">Commentaries</span></div>'
  },
  {
    name: 'Catalog cards & rows', evidence: ['library','sharh-list'], source: 'book_catalog_navigation',
    observed: 'Hadith and Sharh catalogs share pale cards and language metadata. A Sharh book detail switches to a coverage table. A small card can contain several secondary download targets.',
    standard: 'Give each catalog item one title destination, an aligned Arabic title, one metadata line and a separate download group. Use a table when the user needs to compare coverage.',
    check: 'Keep titles and downloads separately focusable. Grid and list presentations should retain the same title, language and destination.',
    sample: '<div class="row between"><strong>Sahih al-Bukhari</strong><span dir="rtl" lang="ar">صحيح البخاري</span></div><p class="sub">Hadith collection</p><hr><div class="row"><span class="chip">Arabic</span><span class="chip">English</span><span class="sub">Downloads · EPUB · JSON</span></div>'
  },
  {
    name: 'Bilingual reading', evidence: ['hadith','sirah'], source: 'hadith_item',
    observed: 'Hadith pairs a reference and grade with parallel text. Sirah uses chapter headings and narrative text. Both stack languages on a phone. The Mushaf has its own page composition.',
    standard: 'Share the reference line, text-width rules and spacing across narrative readers. Keep chain, report, grade, commentary and author footnote as separate semantic fields. Preserve exact source numbering.',
    check: 'Test long Arabic with diacritics, a missing translation and enlarged type. Apply direction to each language block. Preserve the selected Mushaf script and line layout.',
    sample: '<div class="row between"><strong>Sahih al-Bukhari</strong><span class="chip">Bukhari 1</span></div><hr><div class="reading"><div lang="ar" dir="rtl">كتاب بدء الوحي</div><div>Beginning of Revelation</div></div>'
  },
  {
    name: 'Commentary & references', evidence: ['sharh','tafsir-intro'], source: 'quran_commentary_article',
    observed: 'Sharh places the source hadith above the explanation. Tafsir introductions pair authored text with a book switcher and navigation. A translation comparison repeats the ayah above its sources.',
    standard: 'Group the canonical reference, work title and author before the commentary. Visually separate quoted source text from editorial or translated text. Keep headings addressable and retain author order.',
    check: 'A copied reference should identify the work and passage. Verify navigation for book introductions, headings, ranges and the final entry.',
    sample: '<p class="sub">Hadith commentary</p><strong>Fatḥ al-Bārī</strong><p>Ibn Hajar al-Asqalani</p><hr><div class="notice">Source hadith · Bukhari 1</div>'
  },
  {
    name: 'Item actions & reflections', evidence: ['hadith','post'], source: 'content_item_actions',
    observed: 'Hadith has a top group of contextual actions and a compact social row. Community renders actions beneath the post. Activating reflections on the ayah hero produces a sign-in notice in the signed-out session.',
    standard: 'Use one compact row for bookmark, like, reflections and share, with a stable order and accessible names. Keep scholarly tools such as grading and Sharh in the reading context.',
    check: 'Expose toggle state, keep a zero count distinguishable from missing data, and attach the action to the exact item when a page contains several.',
    sample: '<div class="row between"><strong>Bukhari 1</strong><span class="sub">Item actions</span></div><hr><div class="row"><button type="button" data-toggle="Saved" aria-pressed="false">Bookmark</button><button type="button" data-toggle="Liked" aria-pressed="false">Like</button><span class="chip">0 reflections</span></div>'
  },
  {
    name: 'Feeds & article covers', evidence: ['community','articles'], source: 'community_card',
    observed: 'The activity feed uses compact avatar rows. Articles use large image covers with an overlaid title. The article rail shows a third, thumbnail-sized preview.',
    standard: 'Define compact activity, article preview and featured cover variants. Share author, time, content type and title fields. Limit the featured cover to surfaces where the article is the main destination.',
    check: 'Support missing covers and long titles. Give the title its own link and keep follow, share and profile targets independent.',
    sample: '<p class="sub">Community · Article</p><strong>The Iddah and the Mourning Period for a Widow</strong><p class="sub">Adnan · Pearls of the Deep</p>'
  },
  {
    name: 'Editors & notes', evidence: ['compose','notes'], source: 'content_format_controls',
    observed: 'The Community editor exposes article title, cover, formatting and publishing together. Notebook opens as a personal collection with its own search and note cards.',
    standard: 'Share formatting controls and the Markdown preview renderer. Put visibility and save status next to the primary action. Keep publishing explicit and notebook entries private by default.',
    check: 'Test pasted mixed-direction text, keyboard editing and switching between formatted and Markdown views without losing the selection.',
    sample: '<label>Article title<input value="Reading notes" readonly></label><hr><div class="row between"><span class="chip">Private draft</span><span class="sub">Draft saved</span></div>'
  },
  {
    name: 'Audio & memorization', evidence: ['mushaf','memorize'], source: 'quran_memorize_controls',
    observed: 'The Mushaf preserves a page-like reading area. Practice adds hidden-text controls and an introductory overlay. Signed-out recall returns to the Mudhakkir landing page.',
    standard: 'Separate playback transport, script selection and recall assessment. Keep the ayah reference visible while text is hidden. Label assessment choices independently of their status colors.',
    check: 'Expose Play, Stop and Repeat state to assistive technology. Preserve page and ayah when switching modes, and make the onboarding overlay dismissible.',
    sample: '<div class="row between"><strong>Practice</strong><span class="chip">Al-Baqarah 2:255</span></div><hr><details><summary>Show reference</summary><p>Surah 2 · Ayah 255 · Mushaf page 42</p></details>'
  },
  {
    name: 'Settings & disclosures', evidence: ['settings','preferences'], source: '../settings',
    observed: 'Settings groups preferences in expandable rows. Community email preferences uses a separate page and a signed-out prompt.',
    standard: 'Give each settings row a name, current value and one change control. Group dependent controls under a disclosure. State whether a change applies to this device or the signed-in account.',
    check: 'Keep the disclosure operable by keyboard. Show saving, saved and failed states beside the changed field.',
    sample: '<details><summary><strong>Quran reading</strong> · Script preference</summary><p class="sub">Selected script</p><span class="chip">Uthmani</span></details>'
  },
  {
    name: 'Feedback & access', evidence: ['saved','empty-search'], source: '../bookmarks',
    observed: 'Bookmarks uses a blue empty-state banner, Notebook shows a sign-in message, and an empty search leaves a largely blank results column. The restart screen offers a recovery button.',
    standard: 'Distinguish an empty collection, zero search results, sign-in requirements and a failed request. State what happened and give one context-specific next action.',
    check: 'Keep search terms after a retry. Announce asynchronous results and errors without moving focus. Place error details next to the relevant input.',
    sample: '<div class="notice"><strong>No matching passages</strong><p>Try a broader term or remove a book filter.</p></div>'
  }
,
  {
    name: 'Dialogs & pickers', evidence: ['command','translation-picker'], source: 'quran_ayah_modal',
    observed: 'Global search uses a centered dialog with a backdrop. Translation selection opens a small anchored menu over the passage. Practice onboarding also dims the surrounding reader.',
    standard: 'Use an anchored picker for a short local choice. Use a dialog for a multi-step task or scoped search. Name it for its task and show the current selection.',
    check: 'Support Escape, return focus to the opener and keep options reachable at phone width. Persistent notices should allow dismissal.',
    sample: '<details><summary><strong>Translation</strong> · Saheeh International</summary><hr><div class="row"><span class="chip">English</span><span>Saheeh International</span></div></details>'
  },
  {
    name: 'Progression & pagination', evidence: ['passage','trans-section'], source: 'quran_commentary_pagination',
    observed: 'The ayah hero has edge arrows. Section readers also have numbered references, a contents rail and a bottom navigation strip. These controls move through different units.',
    standard: 'Name the unit in each accessible label: previous ayah, next section or next results page. Keep the current reference between its adjacent destinations. Preserve script, work and mode.',
    check: 'At the first and last item expose the unavailable direction. Test chapter boundaries and ranges with both right-to-left and left-to-right content.',
    sample: '<div class="row between"><span class="control">Previous ayah</span><strong>2:255</strong><span class="control">Next ayah</span></div>'
  },
  {
    name: 'Badges & metadata', evidence: ['hadith','sharh-book'], source: 'hadith_metadata_rail',
    observed: 'The hadith rail groups reference information and grades. The Sharh detail uses a coverage table, while catalog cards carry compact language labels.',
    standard: 'Give language, grade, reference and coverage separate roles. Keep the grader beside the grade and the canonical number beside the collection. Use quiet styling for descriptive metadata.',
    check: 'Preserve multiple gradings and the named source. Keep purely descriptive badges out of the tab order. Do not rely on color to convey scholarly status.',
    sample: '<div class="row"><span class="chip">Arabic</span><span class="chip">English</span></div><hr><div class="row between"><span>Collection reference</span><strong>Bukhari 1</strong></div>'
  }
];
