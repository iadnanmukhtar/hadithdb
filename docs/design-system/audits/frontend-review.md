# Front-end refactor audit

## Current review · November 24, 2026

The [component library](../library.html) is the implementation reference for master. The route atlas preserves the original captures for comparison. This review used the local application at revision `2e3bf716` with the working-tree changes.

| Component | Inconsistency found | Treatment |
| --- | --- | --- |
| Local filters | Notebook used two field styles. Memorization progress supplied its own clear handler. The search source picker and admin managers used separate Bootstrap fields. | Share the Books and Settings funnel field, including its focus ring, clear action, Escape behavior, disabled state and accessible label. The Community note importer uses the same field. |
| Highlighted books | A pending scroll event could reset the centered cover while the local book filter hid its shelf. | Preserve the selected book until the visible carousel has measurable width. |
| Contributor lookup | The Community rail opens a dialog through a control styled independently of the other rail tools. | Use the rail field surface and height. Keep a real button, magnifier and dialog semantics because it opens a people search. |
| Bookmarks | The empty collection displayed a bright alert and offered bulk removal. | Use quiet status text. Show Clear all only for populated collections and reserve the alert for a failed load. |
| Hadith detail | Client initialization inserted the language controls above the reference heading. | Keep the reference first, followed by the book switcher and language controls. Test after JavaScript runs. |
| Design guidance | Contributors were directed to compare against master as though it still contained the classic interface. Some library specimens described implemented weights and dropdown styles as proposals. | Document the merged baseline and current type and control hierarchy. The cover finish options and the editorial selection of highlighted Sharḥ titles remain under review. |

**Coverage.** The public browser suite exercises 87 route cases at 390 and 1440 CSS pixels, including aliases, search, readers, catalogs, Community, personal pages, errors and retired endpoints. Representative visual captures include both homepages, Books, Settings, Quran Study, Mushaf, Tafsir, hadith detail, results, Bookmarks, Notebook, About and the MCP information page. Admin editing and personal interactions use isolated browser fixtures. The visual sample covers initial page states. Native device browsers, live production accounts and every combination of personalized content remain outside this review.

### Reading and navigation typography

The type audit sampled the public route atlas at 390 and 1440 CSS pixels. The figures below use the default reader zoom. On Muslim 1864, Chrome reported the Inter Regular and Kitab Regular faces on the breadcrumb links. At 125% reader zoom, English commentary on the phone increased from 16.7 to 20.8 px.

| Role and surface | Phone | Desktop |
| --- | --- | --- |
| Full English reading text, hadith and commentary | 16.7 px, Regular | 18 px, Regular |
| Arabic reading text, hadith and commentary | 21.7 px, Regular | 23.4 px, Regular |
| English breadcrumb on a sharḥ detail page | 13.7 px, Regular | 14.8 px, Regular |
| Arabic breadcrumb on the same page | 14.5 px, Regular | 15.6 px, Regular |
| Contributor metadata, article bylines and translation credits | 13.7 px | 14.8 px |
| Books, Settings, MCP and article detail titles | 25 px, Semibold | 31 px, Semibold |

The large Arabic surah-name glyphs and the smaller inline footnote numbers have separate reading roles. Check the actual Kitab face for the breadcrumb and the English and Arabic paragraph sizes independently of those glyphs. The broader hierarchy changes are under review in the component library.

### Cross-route comparisons

| Family | What was checked | Outcome |
| --- | --- | --- |
| Page titles and rails | Computed font family, size, weight and line height for Books and Settings. TOC layout on Bukhari, Tafsir and Sharḥ at six widths from 390 to 1440 px. | The reference titles matched at 390 and 1280 px. All 18 TOC layout checks passed. |
| Masthead search and overlays | Leading and trailing insets on Books and Settings around the 1200 px search breakpoint. Close controls on the menu drawer, global search, book info and note dialog in light and dark themes. | The expanded search had balanced insets. Close controls shared a 44 px hit area and 18 px glyph, exposed keyboard focus and returned focus to their openers. |
| Navigation, choices and actions | Collection tabs, collapsed mode selectors, book pickers, scope selection, filter pills and inline editing. | Keep a tab for a view, a picker for a single value, and a removable pill for an applied filter. The Bootstrap button classes on existing routes pick up the shared Midnight styles from the foundation stylesheet. Single-choice menus progressively enhance the native select. |
| Search inputs | Global library query, local list filter, and record autocomplete in admin editing. | Use the compound scope/query field for full library search and the funnel field for narrowing an existing list. A record picker that commits an entity still needs suggestions, selection and its existing keyboard handling. |
| Marketing and reading typography | Mudhakkir and MCP landing headers, Quran text, Arabic book covers and interface headings. | Preserve the distinct marketing display scale and Arabic reading fonts. Use the Settings scale for application headings, filters, metadata and menu items. |

**Regression results.** The public route suite passed 174 checks. Isolated admin and personal scenarios passed at both widths. The full Jest run had 3,364 passed, 111 failed and 84 skipped, matching the pre-edit baseline, including the failing test names.

**Open design decision.** On both homepages the floating support widget sits over the lower-right portion of the phone content, directly above the persistent bottom toolbar. Its color, circular launcher and dismissal affordance come from the vendor. The footer already contains a support link. A footer-only treatment on narrow screens would free that reading area while preserving the destination. This proposal is under review.

[Mobile comparison at 390 px](current-mobile.jpg) · [Desktop comparison at 1440 px](current-desktop.jpg)

## Historical review

Reviewed the local ux-makeover checkout at `a4f1e565`. The main shell and catalog are substantially standardized. Search, readers, article typography, signed-out authoring and admin workflows still have visible inconsistencies.

## Follow-up on ux-makeover

The findings below describe the original review. The accepted fixes were checked in local Chrome at 390 × 850 and 1440 × 850.

| Surface | Follow-up |
| --- | --- |
| Community writer | The server hides the workspace initially. The browser fixture holds the account response open, checks that the title is unavailable, releases the response, enters a draft, and signs out. The editor closes and the title clears. |
| Search | The query owns the page H1. Hadith result titles and titleless Quran references use subordinate headings. Empty general and Quran searches reopen the corresponding dialog with the original query, including on a direct visit. |
| Quran contents | At phone width the Juz, Surahs and Manzils filters follow the view selector. At desktop width each uses the contents rail. Both discovery carousels remain available. |
| Articles and readers | On the sampled Blog and Community articles, the mobile cover title measured 27.5 px and its first body heading 22 px. Bukhari 1 shows its reference and title before the update date and book switcher. Bukhari 11, which has no title, retains one page heading when related narrations render. English and Arabic chapter names share the same heading rank. |
| Admin pair manager | The modal opens on the search and results. Selecting a pair reveals merge options. Clearing the selection hides them and returns focus to search. The fixture also exercises canceling and confirming the merge. |
| Error recovery | Both a missing URL and the explicit 404 page show the library link. At phone width the heading starts 25 px from the viewport edge. |

The follow-up public browser run passed 172 of 172 route and viewport checks. The separate admin and personal browser fixtures passed at both widths. The full Jest suite still has failures outside these browser checks.

## Original findings in priority order

| Priority | Surface and observation | Proposed treatment and acceptance check |
| --- | --- | --- |
| High | **Community authoring.** At both widths, a signed-out visitor to `/community/write` is told to sign in to open the editor. The title, subtitle and rich-text body are already editable. A temporary title could be entered and disappeared on reload. | Render a direct sign-in action in place of editable fields until the account is ready. Test signed out, sign-in pending and signed in. If anonymous drafting is intentional, provide explicit local saving and restore the draft across sign-in. Owners: `views/community.ejs` and `public/static/js/community.js`. |
| High | **Search hierarchy and recovery.** On mobile, `/?q=mercy` had ten visible H1s, all result titles. The empty search had none. At both widths `/?q=xyzqzxqz` displayed “0 results found” in the toolbar above a blank body. English Hadith titles also have H1 opening tags closed with H4 in the shared partial. | Give the query and results one page heading, nest result titles beneath it, and make editing the query or clearing filters available in the empty state. Check Hadith and Quran, zero results, and appended results. Owners: `views/search.ejs` and `views/sub-views/hadith.ejs`. |
| High | **Quran home, mobile.** At 390 × 850, “Search juz” ends at y=223. The first Juz row starts at y=788. The two discovery tabs and a carousel occupy the 565 px between the filter and the list it controls. Its placement suggests it searches books. | Keep both carousels. Move the mobile contents filter immediately after the Juz/Surahs/Manzils selector. On all three views the filter and its first match or empty state should be visible together. Keep the desktop contents rail. Owners: `views/toc.ejs` and `public/static/js/script.js`. |
| Medium | **Blog and Community article titles.** On the Iddah blog article the cover title is 20 px on mobile and 28.8 px on desktop. “Key Takeaways” and other body H1s are larger at 25 px and 30.96 px. The sampled Community article also places a 22 px section heading under a 20 px mobile title. | Separate the detail-cover title from the feed-card title in the CSS cascade. Render authored headings below the article heading level while preserving source Markdown, anchor IDs and section order. Verify both article surfaces and their feed cards. Owners: `views/sub-views/blog_cover.ejs` and `public/static/css/community.css`. |
| Medium | **Hadith detail and chapter identity.** On `/bukhari:1`, update metadata, book switching and language controls come before the hadith title. The title starts at y=301 on mobile and uses 15.8 px / weight 500, while “Scholarly Grades” uses the same size at weight 700. On desktop the two are again the same size, 18.4 px. On the chapter reader the English chapter name is 17.1 px / 500 on mobile and its Arabic counterpart is 29.2 px / 700. | Give the reference and bilingual title a single recognizable heading group before secondary metadata. Keep Arabic script sizing appropriate to the typeface and distinguish source-text emphasis from interface heading rank. Check both long titles and missing-title records. Owners: `views/search.ejs`, `views/chapter.ejs`, and their shared reader partials. |
| Medium | **Admin bilingual pair manager.** The merge form precedes the list used to select a pair. With no selection it takes 456 px on mobile and 321 px on desktop. After the search box, the list starts at y=638 on mobile and y=536 on desktop. The modal title is H2 and its subsection titles skip to H4. | Put results directly under search. Reveal the merge fields when selections make them useful, keeping the selection count visible when searching. Use H3 for subsections. Recheck filter, select, merge, clear, retry and keyboard focus with the existing fixture. Owner: `views/admin.ejs`. |
| Lower | **Error layout.** At 390 px the 404 title and explanation begin at x=0, compared with x=25 for Settings. The body gives no recovery action next to the error. | Use the shared content gutter and add a direct library or search action. Check a missing content URL as well as `/error/404`. Owner: `views/error.ejs`. |

## Evidence and coverage

[Phone screenshots](mobile-review.jpg) show signed-out authoring, the Quran contents filter, empty search and the admin pair manager. [Desktop screenshots](desktop-review.jpg) show populated and empty search, Hadith detail and the blog article.

Captured 77 distinct URLs in local Chrome at **390 × 850 and 1440 × 850**, including the route atlas, Quran Settings, the admin access boundary and a missing-path probe. Compared computed heading sizes, weights, coordinates and document width, and visually inspected representative screenshots from each major family. None of the 154 document-level measurements showed horizontal overflow. This check does not detect misplaced controls within the viewport.

The public browser regression passed all 170 route and viewport checks. Additional width probes on six core routes at 320, 768, 991 and 992 px found no horizontal document overflow. The Books/TOC layout comparisons passed for Hadith, Tafsir and Sharḥ at 390, 700, 701, 991, 992 and 1440 px. Header search inset and overlay close checks passed. Admin and personal browser fixtures passed at both primary widths. The admin measurements above use the real template and an isolated browser fixture. Signed-in production accounts, real billing and Drive, native mobile browsers, screen readers and every dark-theme state were outside this review.

## Refactor status at the original review

Shared shell adoption, valid route responses and working form submissions cover different questions from visual hierarchy and task order. Keep the current Books and Settings patterns as references. Prioritize the editor access state, search page semantics and the Quran mobile filter before a cosmetic pass. Recheck the article and reader findings at component level so the changes reach all consumers.
