# Substack workflow study and HadithDB adaptation

Observed October 29, 2026 in the user's signed-in local Chrome browser. Implementation remains local; no deployment, production data changes, or public research posts/replies were made.

## What was explored

| Flow | Direct observation | HadithDB adaptation |
| --- | --- | --- |
| Feed → new note | A single avatar-and-prompt entry point opens a roughly 600px modal over the feed. The author appears above an open writing area. Post is disabled while empty. | Retain the existing feed entry point and author heading; simplify the composer by collapsing optional title/cover settings. |
| Typing → formatting | Selecting text reveals a compact floating strip: bold, italic, strike, code, lists, quote, and link. Formatting is visible in the editor instead of exposing syntax. | Add a selection-sensitive formatting strip and a formatted short-text editor. Store Markdown through the existing APIs. |
| Attachments | Images, video, emoji, poll, and schedule controls sit below the note. Overflow includes additional options. | Preserve existing Image, Link, and Video tools. Do not invent unsupported publishing features. |
| Cancel/return | Note cancellation returns to the underlying feed without publishing. Drafts is a separate visible entry point. | Preserve the existing local composer text when closing/reopening it. Do not claim server-side short-note draft autosave. |
| Feed → note detail | The main post remains above counts and replies. The author avatar, name, timestamp, and quiet action row repeat consistently. | Keep the existing feed/detail structure and actions, with lighter reflection styling and readable text. |
| Reply | “Leave a reply…” opens a composer showing the parent author's avatar, name, date and text above the current author's writing area. | Show parent author and a text excerpt above the reply field, both for feed discussions and post-detail reflections. Keep the existing parent IDs and moderation controls. |
| Nested discussion | Replies are visibly grouped, retaining author identity and independent reaction/reply controls. | Preserve the existing threaded order and bounded indentation; make the relationship visible with a thin thread rule. |
| Note share menu | Copy link, Send as message, Share to Notes, Facebook, Bluesky, X, and Embed were visible. | Preserve supported HadithDB sharing targets, copy fallback, and native share. |
| Share to Notes | A new composer embeds a bordered copy of the original note, including avatar, author, date, and text. No cover image is necessary. | Show a compact author/summary card in the share pane; retain the canonical destination. |
| Article editing | The existing blank article draft exposed title/subtitle, author, Saved state, version history, persistent formatting, media insertion, and Preview/Continue. | Keep HadithDB's full article editor and extended Markdown workflow. The lightweight editor now applies to articles as well as short posts, share captions and replies, with the full article bar retained. |
| Article preview | Mobile, Desktop, and Email preview tabs, a subscriber-view selector, and Share were visible. | Keep the existing public-preview workflow. Email/audience simulation was not added. |
| Continue/publish | Continue on the existing blank draft stopped at “Add a title.” The draft was not filled or published. | Keep existing validation, preview and publication permissions. |
| Article sharing | A published article's Share dialog displayed a preview card and Copy link, Facebook, Email, Notes, More. This particular article had artwork. | Keep real covers; fall back to public author identity when there is no image. |
| WhatsApp unfurl | The user's supplied screenshot shows a small square author photo, `Name (@handle)` heading, post text, and host. | Match that pattern in server-rendered Open Graph metadata for imageless Community posts/articles. |

## Reference surfaces

- [Substack home and note composer](https://substack.com/)
- [Observed public note and nested replies](https://substack.com/@rawiajourney/note/c-360139161)
- [Observed published article and share dialog](https://tsevitaarts.substack.com/p/hijab-ban)
- Existing user-owned article draft at `iadnanmukhtar.substack.com/publish/post/222692186` (read-only inspection; no draft text changed).
- User-provided WhatsApp screenshot in this conversation.

These are interaction references, not endorsements of the reference posts' content.

## Design decisions

The useful pattern is progressive disclosure: start with the author and writing, reveal formatting on selection, keep secondary metadata optional, and carry conversation context into replies. HadithDB retains its own accent-blue and neutral color variables, typography system, Arabic direction handling, source references, and public-name rules. Substack's orange branding is not copied.

The Post button now says **Post**, with no arrow, in both the main short-post composer and the shared-source composer.

The selection toolbar stays within the editor's width and wraps on smaller displays. It is sticky within the writing surface rather than being precisely anchored to a selected word. Keyboard bold/italic and native undo remain available. Pasted content is inserted as text; arbitrary pasted HTML is not imported into the editor.

## Extended Markdown preservation contract

`NotebookFormatting`, `NotebookHtml`, and the existing article Markdown editor were not replaced. The textarea remains the source of truth sent to the existing API. Opening/submitting untouched text does not normalize or rewrite its original Markdown.

Advanced constructs are edited in **Markdown** mode, with a visible explanation. Formatted-mode conversion is disabled when it cannot preserve the content. This includes underline, highlights, Arabic/English parallel columns, superscript/subscript, subtext, emoji shortcodes, definition lists, task lists, tables, fenced code, footnotes, reference links, heading attributes, wiki links, images and native HTML. Existing source-mode reference expansion is retained. Advanced syntax should be authored in Markdown mode, not typed as markup into the formatted writing surface.

Formatted mode supports ordinary text, paragraphs, headings already in supported Markdown, bold, italic, strike, inline code, links, lists, and quotes. It uses safe DOM construction and only permits supported link protocols. It does not inject parsed source HTML into the page.

## Share-preview behavior

For published posts/articles, the image preference is explicit cover, then an image already present in the published body, then public author photo/avatar fallback, then the existing brand fallback when no author image is available.

Without a content image, the Open Graph heading is the public author name and handle. The description contains the optional post title and subtitle/excerpt. Both Open Graph and Twitter image tags use the same resolved image. Existing full-name privacy rules remain authoritative; a private stored name is not introduced into metadata.

Legacy imported blog pages also receive author-first social metadata when they have no cover. Imported Community article decoration no longer invents `/blog/` as an image URL for an empty cover.

The in-app share pane shows the author and summary immediately from the published item. This is a preview of the intended data, not a guarantee of identical third-party layout. WhatsApp controls rendering and caching; a live WhatsApp unfurl of the new version cannot be verified until the changes are deployed and fetched there.

## Verification

- 185 distinct tests passed across 16 focused suites (the 184-test batch plus a final nested-list regression): short editor, metadata, social sharing, reflection replies, source sharing, feed titles, extended notebook syntax, source expansion, article autosave/conversion, Community behavior, asset/cache handling, and blog behavior.
- Tests specifically cover exact preservation of advanced Markdown, untouched-source preservation, ordinary rich-text serialization, native contenteditable paragraph boundaries, unsafe markup/links, reset behavior, and blank/oversized submissions.
- Local Chrome used the real changed templates, CSS and scripts with a temporary sample-data API at port 3016. No production account or database was used for publishing tests.
- Browser checks covered bilingual entry and paragraph direction, selection toolbar, bold, native undo, Markdown switching/protection, feed replies, nested reply context, post-detail reflections, share cards, and a 390×844 responsive viewport. No horizontal overflow was observed on the detail view.
- Two additional existing headless suites (`notebookShortcuts` and `notebookLists`) could not launch Chrome inside the sandbox; their 44 cases were not validated by that attempted run. They are not included in the 185 passing tests. Interactive Chrome checks above are reported separately.
- `git diff --check` passed.

## Captured local previews

The avatar in these sample-data previews is a placeholder, not a user's account photo.

![Desktop short-post composer](composer-desktop.jpg)

![Mobile short-post composer](composer-mobile.jpg)

![Mobile nested reply](reply-mobile.jpg)

## Boundaries and follow-through

Substack's final publishing, actual sent replies/messages, uploads, subscriber-only article content, email delivery, scheduling execution, and notification delivery were not exercised. The article used for sharing gated its full text behind a subscription, which was not bypassed. The imageless WhatsApp presentation is grounded in the supplied screenshot; the observed article-share example itself contained artwork.

The adaptation does not add polls, scheduling, private messages, email previews, or server-backed short-note drafts. It concentrates on the requested clean writing, formatting, replies and author-aware sharing experience, while preserving HadithDB's extended research-writing capabilities.

Deployment is still pending. After an explicitly authorized deployment, verify one imageless note, one imageless article, and one image-backed post from fresh public URLs in WhatsApp, plus the real authenticated source-sharing and reply paths. Existing scraper caches can delay visible metadata changes.

## Parallel-text toolbar follow-up

Added an `a|ج` control to the contextual and article formatting bars. Empty lines insert `English text here || نص عربي هنا`; populated lines keep their content and append ` || نص عربي هنا`. The Arabic sample is selected for immediate replacement. Existing parallel rows select their second column instead of adding another separator. The contextual control is also available at a collapsed caret so an empty line can be used; Markdown mode retains its own parallel-text control.

The short editor switches to protected Markdown mode for parallel content. The existing renderer continues to produce the bilingual columns. Verified in local Chrome with an empty composer and with the caret in the second paragraph; the first paragraph remained unchanged. The article command, source-mode preservation, separator handling and editor regression checks passed: 46 tests across three focused suites.

![Parallel text insertion](parallel-text.jpg)

## Article editing follow-up

Article writing now uses the same formatted writing surface and selection controls, while retaining HadithDB’s full formatting bar, article layout, colors, imports, preview, Save draft and Publish controls. The main bar remains visible while scrolling. Subtitle and cover settings are collapsed for new articles and expanded when existing values are loaded. Titles use a quieter borderless field.

The main bar acts on the live formatted selection. Extended operations such as underline, highlight and parallel columns move into the protected Markdown editor with the selection preserved. Existing advanced articles open in source mode unchanged. Media insertion maps the current rich selection to the Markdown source; image paste/drop and standalone Quran/hadith reference expansion retain their existing handlers. Draft autosave uses the same synchronized Markdown and does not rebuild the live writing DOM. Empty rich drafts are explicitly excluded from autosave.

Validation: 116 tests across 10 focused suites passed, covering article selection/formatting, autosave/conversion, extended syntax, source expansion, media, previews and sharing. Local Chrome checks confirmed bilingual typing, full-bar bold, highlighting with selection preservation, autosave completion, and 390px mobile wrapping without horizontal overflow. The browser used sample data; no production article was published.

![Article editor](article-desktop.jpg)

![Article editor on mobile](article-mobile.jpg)


## Feed and shared reflections follow-up

Visited the signed-in Substack home feed in local Chrome on October 29, 2026, then opened the comment action on [Hazel Gomez’s note](https://substack.com/@hazelgomez/note/c-351598425). The [home feed](https://substack.com/) places avatar, author and timestamp above the content, uses a quiet action row (like, comment, restack, share), and distinguishes social attribution from the primary author. Long notes expose “See more”; embedded articles have their own linked preview. Clicking Comment opened the full note and its reply entry point. No comments, reactions or posts were submitted.

Applied the useful layout pattern: full posts, articles and conversations align their content and action row with the author’s name on desktop; mobile keeps the full content width. Author and date share a compact header. Existing compact like/title/revision rows, grouping of consecutive activity, expansion and pagination remain intact.

The shared `comment_widget.ejs` now uses the same formatted editor as Community. This carries contextual formatting, protected Markdown source editing, parallel Arabic/English insertion and parent reply previews to its Hadith, Quran, Tafsir and other content consumers, including dynamically inserted widgets. Cancel reply keeps the draft. Existing reflection edits hydrate the editor, retaining advanced Markdown verbatim. Post and Save are plain text buttons; submission disables the button while pending. Threads use the same quiet background, subtle reply line and accessible action sizes.

Repeated action icon conventions across the shared reader and Community surfaces:

| Action | Bootstrap icon |
| --- | --- |
| Like / selected like | `heart` / `heart-fill` |
| Disagree / selected disagreement | `hand-thumbs-down` / `hand-thumbs-down-fill` |
| Open reflections or comments | `chat-right-text` |
| Reply to a comment | `reply` |
| Share | `share` |
| Repost | `repeat` |
| Edit | `pencil` |
| Delete | `trash` |

The audit found reader likes already used hearts and reflection entry points already used `chat-right-text`; Community and comment votes now match them. Distinct navigation, writing and informational icons retain their meanings. Outline icons represent idle actions; filled icons represent selected reactions. Buttons keep text alternatives.

Validation: 112 tests passed across 12 focused suites, including shared-widget reply/cancel/edit behavior, source safety, extended Markdown, article editing/autosave, sharing, Community activity and compact title microinteractions. Chrome sample-data checks confirmed the shared reflection reply context and formatting control, desktop feed discussion, and a 390px shared-widget layout with no horizontal overflow. These are local fixture checks, not a production deployment or production API check.

![Feed with inline discussion](feed-desktop.jpg)

![Shared reflections on mobile](shared-reflections-mobile.jpg)

## Cover-image summary cards

Added the user-requested cover treatment: a linked image card with author avatar/name, title, optional subtitle and a two-line summary over a dark gradient derived from HadithDB's blue `--c-note` token. Both article and short-post feed cards use this when an explicit cover exists, including newly loaded feed pages. Text-only posts and compact activity rows retain their layout. Full article/post Markdown remains unchanged; only feed presentation is summarized. The enhancement removes the repeated cover from media previews while retaining other images and video. Failed cover loads retain readable text on the branded background. Without JavaScript, the existing text/media feed remains available.

Validated with 42 tests across cover cards, compact activity, short editor and social sharing. Local Chrome sample-data previews passed desktop and 390px mobile checks without horizontal overflow. No deployment.

![Cover card desktop](cover-card-desktop.jpg)

![Cover card mobile](cover-card-mobile.jpg)

## Blog listing and article covers

Both blog surfaces now use the shared server-rendered `blog_cover.ejs` partial. Listing cards link to the article; the article hero has a single H1 and retains its full subtitle/description. Both show the author's public name, decorated profile photo, and publication date over the cover gradient. The article body, reflection widget, edit controls, pagination and infinite-scroll markers are preserved. Share cards receive the author and cover metadata. Blog page cache keys now include a presentation version so a later deployment cannot serve the previous cached layout under the same key.

Validation: 37 checks passed across five suites (blog cover rendering, infinite-scroll contracts, Arabic rendering, page cache, and Community cover behavior). The existing headless `blogEdit` test could not launch Chrome in this sandbox; it did not reach its assertions. Local Chrome sample-data previews verified listing and article layouts at desktop and 390px, with one article H1 and no article horizontal overflow. No deployment or production cache flush.

![Blog listing](blog-list-desktop.jpg)

![Blog article on mobile](blog-article-mobile.jpg)

## Cover carousel correction

Replaced the stack of article images below a cover card with a single carousel. The cover is slide one; remaining standalone feed images follow in source order with duplicates removed. Author/title/subtitle/summary stay visible while the image changes. Secondary images use `object-fit: contain` so diagrams are not cropped. Previous/next buttons, a live slide counter, arrow keys and horizontal touch gestures navigate without opening the article; ordinary clicks retain the article link. Video and independent embedded link previews remain separate. Single-cover cards do not show unnecessary controls.

Local Chrome verified next-slide navigation, persistent summary, no remaining stacked images, and a 390px layout without horizontal overflow. The sample second slide uses the HadithDB logo. No deployment.

![Carousel with retained summary](cover-carousel-mobile.jpg)

## Video carousel slides

Recognized YouTube, Vimeo and direct video media now share the cover/image carousel, including video posts without a separate cover. Video slides show a thumbnail or available poster, a Play control, and an explicit provider/hostname link. The article summary remains visible. Players load only after clicking Play and are removed when changing slides. Native player keyboard controls are not intercepted by carousel navigation. YouTube `/live/` links are recognized along with watch, short and embed links; video-specific thumbnails override cached generic channel logos. Vimeo thumbnails use available preview metadata; direct files use their poster when provided. Missing thumbnail metadata leaves a labeled play control, not a fabricated thumbnail.

Local Chrome sample-data checks verified a real YouTube thumbnail, provider label, mobile width, click-to-load player and player removal on slide change. The screenshot uses a sample video unrelated to the sample article text. 21 tests passed across carousel, media, preview gallery and cached video-thumbnail regressions. No deployment.

![Video slide with source and retained summary](video-carousel-mobile.jpg)

## Standard widescreen media dimensions

Carousel media now occupies a responsive 16:9 stage instead of a fixed 250px-high box. Video thumbnails fill it edge to edge using `object-fit: cover`; players use the same dimensions. The author and summary remain below the media area. Secondary reference diagrams retain their contained presentation within that same stage. YouTube thumbnails request the high-resolution variant and fall back to the normal video thumbnail on errors or tiny unavailable-image placeholders.

The ratio follows [YouTube's widescreen guidance](https://support.google.com/youtube/answer/6375112). Local Chrome measured 695.20 × 391.05 desktop and 318 × 178.875 mobile (16:9), with no mobile horizontal overflow. The preview uses sample content. Thirteen focused tests passed. No deployment.

![Widescreen video preview](video-widescreen-mobile.jpg)

## Dots and direct sliding

Inspected [Three Gems Boutique](https://threegemsboutique.com/) in local Chrome and selected the second dot on its first product: the photo and active indicator changed together. HadithDB now uses a native horizontal scroll-snap track with directly selectable dots, touch/trackpad scrolling and mouse dragging. Slides stop at the ends, support arrow/Home/End keys, and respect reduced-motion preferences for programmatic navigation. The numeric counter remains available to assistive technology; small desktop hover/focus chevrons supplement the dots. The summary does not slide. Video players are removed on slide changes, and source labels remain intact.

Validation: 15 tests passed for dot selection, native scroll synchronization, end boundaries, mouse drag/click suppression, video lifecycle, thumbnail fallback and existing preview behavior. Local Chrome verified an actual desktop drag snapping to slide two, direct dot selection of the video, and a 390px layout without horizontal overflow. Touch uses browser-native scrolling; no physical touchscreen test was performed. No deployment.

![Carousel dots](carousel-dots-mobile.jpg)

### Blog as a feed, with the shared Community rail

The blog archive now renders the same Community article cards and hydrates them through the same client renderer. This carries across author attribution, cover summaries, swipeable image/video carousels with dots, compact reaction/share controls, and inline replies. The existing blog infinite-scroll URLs and sentinel remain in place; appended pages hydrate automatically. Shared card metadata is safely embedded as JSON with `<` escaped, including author-supplied titles.

The Community contributor rail is a shared EJS partial used by Community, the blog archive, and individual blog articles. Contributor follow controls, My Notebook, responsive placement, and footer-aware fixed positioning use the existing Community implementation. Article bodies and the full Markdown renderer remain unchanged.

Imported blog articles retain their existing `blog_comments` thread: opening or replying from a feed card accesses that same slug, including parent replies. Featured Community articles continue to use Community discussions. Public server rendering supplies anonymous reaction counts, while a bounded no-store endpoint refreshes the signed-in reader's state in batches of at most 50 IDs. Imported blog comment counts are preserved when shared reaction decorators run and when readers like/repost an article. The blog presentation cache version is bumped for the new markup.

Validation: 48 focused tests pass across blog mapping/hydration, safe embedded JSON, appended pages, legacy-thread loading and reply submission with parallel Arabic Markdown, count preservation, cover rendering/carousels, pagination, page cache, and shared reflection editing. Chrome sample-data previews verified desktop archive/article rail placement, inline thread display, and a 390px mobile archive without horizontal overflow. Production database behavior and deployment were not exercised. Screenshots: `blog-feed-desktop.jpg`, `blog-feed-mobile.jpg`, and `blog-article-rail-desktop.jpg`.

### Restore blended covers in mixed-media carousels

The native swipe track had been stacked above the card's gradient, with the copy padded completely below the image. A cover followed by a video therefore lost the blended author/title treatment. The first cover slide now places a noninteractive gradient above the swipe track and overlaps the author/title into the lower image. Text links remain clickable, while the exposed image remains draggable. Dots sit above the author. Video and secondary image slides retain their clear media stage; returning to the cover restores the fade. The 16:9 dimensions, summary, colors, and extended Markdown are unchanged.

Validation: all 12 carousel tests pass, including cover/video/cover transitions. Chrome local sample-data checks covered desktop and 390px mobile blending and video-source/play visibility. Screenshots: `carousel-cover-blend-desktop.jpg`, `carousel-cover-blend-mobile.jpg`. Not deployed.

### Default cover for blog articles in every feed

Missing imported-blog covers bypassed the blended card in Community, exposing the formatted opening (including a contents list) and a separate blog preview. Blog routes already had a default cover, but the import/feed path did not. A shared Pearls of the Deep cover constant now supplies the fallback for imported blog feed items, featured published Community articles in feeds, and blog listing mapping/routes. Explicit covers remain unchanged; this is a display fallback and does not write to stored article content. The existing cover renderer now replaces the opening fragment and consumes the duplicate blog preview normally.

Validation: 24 focused tests passed, including absent/blank covers, preserved explicit covers, imported-blog decoration, carousel behavior, and feed cursors. A local sample-data Chrome preview with no cover and a contents block showed the default blended card (`blog-default-cover.jpg`). Not deployed.

### Selection-only post formatting, including Markdown mode

Removed the standalone parallel-text button and the collapsed-caret parallel-only toolbar. The contextual toolbar now appears only for a nonempty text selection. Posts containing media or extended Markdown had switched into source mode, where the contextual toolbar was disabled; source selections now offer formatting too. Source commands modify only the selected range (or selected lines for lists/quotes), preserving unrelated extended Markdown. Article formatting retains its permanent toolbar.

Validation: 44 editor/parallel/article/reflection tests pass. Local Chrome verified selection reveals all controls, parallel insertion preserves the current line, bold formatting works on the selected Arabic source text, and clearing the selection hides all contextual controls. Screenshot: `post-contextual-formatting.jpg`. Not deployed.

### Basic and advanced form layout parity

Both inputs now live inside the same editor shell, with the contextual toolbar above and the mode tools below. Markdown mode uses the same borderless background, typography, line spacing, padding, minimum height and focus accent as formatted mode. Its height grows with content up to the shared scroll limit. The article surface retains its larger writing area. Extended syntax and mode selection behavior are unchanged.

Validation: 44 existing editor tests passed. Chrome confirmed identical post input font (18px), line height (29.7px), padding and minimum height (180px) in both modes, and verified the advanced layout at 390px. Local ignored screenshots: `advanced-form-matched.jpg`, `advanced-form-matched-mobile.jpg`. Not deployed.

### Native formatted editing for parallel text

Two-column `||` rows now parse as editable side-by-side cells inside the formatted editor. Existing posts containing ordinary prose, bold Arabic, links, and parallel text open in formatted mode; the parallel control also returns directly to that surface and selects the Arabic sample. The stored contract remains Markdown with `||`, with untouched rows retaining their exact original source. Edits serialize both cells without removing neighboring prose or rows. Escaped pipes and pipes inside code spans remain literal.

Each cell retains automatic text direction. Enter/Tab moves between columns and then out into normal prose; boundary deletion and cross-column edits are guarded against accidentally merging the columns. Contextual inline formatting remains available within a cell. Other unsupported extended syntax still uses the existing lossless source fallback.

Validation: 48 editor, parallel-text, article, and reflection tests passed, covering initial rendering, unchanged submission, edited serialization/reopening, multiple rows, escaped/code pipes, and keyboard navigation. Local Chrome verified insertion, direct Arabic editing, Markdown/formatted switching, and mixed prose/columns at desktop and 390px mobile. Ignored screenshots: `parallel-rich-desktop.jpg`, `parallel-rich-mobile.jpg`. Not deployed.

### Delete editable parallel blocks

Focusing either column reveals a Delete columns control above the writing area. It removes that block and both columns' text while preserving adjacent paragraphs, and keeps the editor in formatted mode. An Undo delete columns control restores the removed block at its original position; immediate Cmd/Ctrl+Z also restores it. Deletion is explicit because Chromium's native contenteditable delete merged the following paragraph into a leftover column container during verification.

Validation: regression tests cover removing a standalone row and a row between paragraphs, plus restoration. Local Chrome verified zero remaining column containers after deletion, intact surrounding Markdown, button undo and immediate keyboard undo. Ignored screenshot: `delete-columns.jpg`. Not deployed.

### Post/article editor parity verification

Both the quick post textarea and article textarea mount `CommunityShortEditor`; the article's permanent toolbar delegates supported commands into that same component. Added article integration coverage for formatted column insertion, deletion, restoration, unchanged-source reopening/submission, and input events used by autosave. Local Chrome verified the article toolbar creates formatted columns and the shared Delete/Undo controls remove and restore them while the full article formatting bar remains present. Screenshot: `article-shared-columns.jpg` (ignored). No separate article implementation or deployment was needed.

### Replace destructive column deletion with layout removal

The prior Delete columns action is replaced by a floating × immediately after the active row, at its lower right edge. Its accessible label is Remove column layout. It unwraps the first and second columns into consecutive text blocks, preserving inline formatting, language direction, and surrounding prose. Undo restores the column layout and retains edits made to the unwrapped blocks. The shared post/article component owns this behavior.

Validation: 49 focused editor tests passed with updated preservation expectations. Chrome verified the floating control, English-then-Arabic output, retained bold formatting, and layout restoration. Ignored screenshot: `remove-column-layout.jpg`. Not deployed.

### Continue lists and quotes with Enter

The shared editor now uses the notebook continuation helper for Markdown-mode Enter: unordered bullets repeat, ordered markers increment, task items start unchecked, and quote prefixes continue. Enter on an empty item removes its marker; an empty quote line exits the quote. Fenced code/frontmatter and Shift+Enter retain their existing literal behavior. Article shortcut listeners respect the handled event to avoid double insertion.

Formatted lists retain native browser continuation and empty-item exit. Empty quote paragraphs explicitly split out into normal prose without discarding later quote paragraphs. Bare-reference expansion no longer interrupts list/quote continuation.

Validation: 57 shared editor/article/parallel/reflection tests pass. Chrome verified formatted bullet continuation and empty-item exit, quote continuation and exit, and Markdown bullet continuation/exit. The separate notebook shortcut browser suite could not launch its headless Chrome under the sandbox; live Chrome checks covered the relevant interactions. Ignored screenshot: `enter-formatting.jpg`. Not deployed.

### Tight quote-line continuation

Formatted Enter now splits into a following line inside the same quote, rather than relying on browser paragraph/block splitting. Continuation lines have no paragraph margins and serialize without an inserted blank quoted line. Enter on the empty continuation line still exits to normal prose. Existing inline quote markup retains its previous serializer unless a continuation line was introduced.

Chrome verified two typed lines share one continuous quote border and store as `> First line\n> Second line`; Enter twice then typing produces ordinary text outside the quote. Screenshot: `quote-lines.jpg` (ignored). Not deployed.

### Shared centering, highlighting, and formatting icons

- Short-post selection formatting now uses the article toolbar icons, including highlight, center, underline, quotation, and clear formatting. Article editing retains its permanent toolbar.
- Center alignment wraps selected lines with `<center>` and `</center>` on separate lines. Centered blocks and `==highlight==` reopen in formatted editing; existing extended Markdown remains available.
- The server parses Markdown inside own-line center wrappers. Explicit centering overrides automatic language alignment, including Arabic paragraphs.
- Verified in local Chrome: highlight then center stays in formatted mode and stores `<center>\n==A moment for reflection==\n</center>`. Screenshot: `center-highlight.jpg` (ignored reference artifact).
- Validation: 170 tests passed across six shared editor, article, parallel text, reflection, autosave, and notebook rendering suites. No production deployment.

### Post/article formatting parity and Subtext

Compared both toolbars: inline formatting, centering, lists, quotation, links, clearing, and parallel columns were available in both; posts lacked the article text-style menu and used a different control order. Both now offer Normal, Heading 1–6, and Subtext (-#), with matching icon order. The article retains its permanent toolbar and Markdown-help entry; posts retain selection-only controls. Code is not offered in either toolbar. Extended Markdown remains supported.

Subtext renders as a small-text paragraph in the shared formatted editor, serializes as `-# text`, and can be changed back to Normal or a heading. Both heading menus use the same handler. Focus can move into the contextual menu without dismissing it. Focused editor/article/parallel regression suites: 62 tests passed. Not deployed.

### Article-only sticky toolbar

Articles now use only their permanent formatting toolbar; rich and Markdown selections keep the contextual toolbar hidden while preserving selection for permanent toolbar actions. Posts retain selection formatting. The global horizontal `overflow: hidden` created an ancestor that trapped sticky positioning; article write pages now use `overflow-x: clip`, matching the site's reader layouts. The toolbar retains the measured fixed-header offset.

Local Chrome verification with 45 sample paragraphs: at scrollY 2668 the toolbar remained at its sticky top (0 in the headerless fixture). Screenshot: `article-sticky-toolbar.jpg` (ignored). Shared post/article tests: 52 passed. No deployment.

### Mobile post and article writing audit

Audited local Chrome at 390x844, 320x568, and a reduced 390x600 viewport. Found wasted post-dialog margins, stacked action buttons, small selection-toolbar targets, a three-row article toolbar, and oversized introductory spacing before the article body.

Changes: mobile posts use a full-height safe-area-aware writing surface with one scrolling dialog and compact Preview/Cancel/Post actions; formatted and Markdown modes have matching room to write. Both mobile formatting bars scroll horizontally in one row with 44px touch targets. Articles retain their sticky permanent bar, use less introductory spacing, and keep at least half a viewport of editing room. Bilingual column removal has a centered 44px touch target. Post previews scroll into view after rendering.

Browser checks: post formatted/Markdown switching preserved content; preview appeared and local submission returned success. Article subtext, bilingual columns, Markdown switching, preview, and draft-save response worked. No horizontal page overflow at 320px. The fixture redirects after draft save to an unsupported /community/mine route, so reopening that saved draft was not validated here. Existing regression suites cover autosave/editor behavior. These checks emulate viewport sizes, not a real iOS/Android keyboard or device. Screenshots: mobile-post-audit.jpg and mobile-article-audit.jpg (ignored). No live posts or deployment.

### Article contents in the right rail

Blog and Community article reading pages now derive an automatic contents rail from body headings, replacing the contributor pane only when usable headings exist. Existing authored anchors are retained, missing/duplicate anchors get unique IDs, subheadings are indented, and navigation headings/footnotes are excluded. Scroll tracking highlights the current section and keeps its link visible within a long fixed rail; heading links account for the fixed site header. Articles without headings retain contributors. Short posts are unchanged.

Local Chrome confirmed section navigation, active-section highlighting, fixed-rail position, and no-heading fallback. Screenshot: article-contents-rail.jpg (ignored). Shared script hashing and cached-asset rewriting include the new navigation script. No deployment.

### Article 51 advanced-mode diagnosis

The local article "The Iddah and the Mourning Period for a Widow" contained a normal `---` divider after its introduction. The rich editor's multiline frontmatter guard incorrectly matched that divider anywhere in the document, and its token renderer also lacked horizontal-rule support. Frontmatter detection is now anchored to the start of the document, while normal dividers render and serialize safely. Genuine frontmatter and unsupported extended syntax still retain source-mode protection.

The complete 14,656-character article was checked locally: formatted mode rendered 13 headings and one divider with source Markdown unchanged on opening. Added divider regressions; 55 shared editor/article tests passed. Included the shared editor in script cache versioning. No article content was saved or published.

### Article divider and editable footnotes

Article toolbar now includes Insert divider and Insert footnote. Formatted editing renders Markdown footnote references as atomic superscript markers and definitions as labeled editable text, including multiline paragraphs, inline emphasis, repeated references, and named/Arabic labels. Inserting a reference allocates an unused number, adds a definition placeholder, and selects its text for immediate editing. Markdown mode retains the same insertion controls. Nested footnote insertion is blocked inside a footnote body.

Removing the last marker preserves its definition as an explicitly labeled orphaned paragraph in the serialized Markdown, rather than silently discarding it. Removing one of several references leaves the definition linked. Native Undo restores the reference and reconnects its note during the same editing session. Existing unreferenced definitions are displayed as orphaned notes. Standard dividers round-trip as `***` so a leading divider cannot be mistaken for YAML frontmatter. Unsupported extended constructs still retain source-mode protection.

Local Chrome verified insertion, placeholder editing, marker deletion, and Undo. Screenshots: article-footnote-editing.jpg and article-orphan-footnote.jpg (ignored). Shared editor/article/parallel/autosave/reflection suites: 96 tests passed. No real articles saved or published, and no deployment.

### Subscript and superscript controls

Post contextual formatting and the article's permanent toolbar now include matching x₂/x² controls rendered as text rather than icon-font glyphs. Formatted editing uses native subscript/superscript commands and serializes to the existing `~text~` / `^text^` Markdown extensions. The shared parser reopens that syntax in formatted mode, preserves escaped spaces, and distinguishes superscript from footnote references and subscript from strikethrough. Local Chrome verified H₂O and x², visible icons, and the serialized `H~2~O and x^2^`. Screenshot: article-sub-superscript.jpg (ignored). No deployment.

### Saving articles with missing covers

Article 44 reproduced a save rejection: “Choose an image uploaded to your account.” Imported-blog decoration was feeding presentation cover URLs back into edit data. Editing responses now retain the stored cover before decoration. A missing cover shows Pearls of the Deep in the editor while the saved authored-cover field remains empty. Validation also accepts that exact default asset and tolerates the encoded form of an existing imported cover from older tabs, while continuing to reject unrelated unowned media. Failed cover previews display the default image. Focused cover, blog-feed, and article-autosave suites: 29 passed.

Verified article 44 on localhost: missing authored cover remained empty, the editor displayed “Default cover · Pearls of the Deep,” and Save draft returned “Draft saved.” The public version was not republished. No deployment.

### Consistent article rail width and update navigation

Article reading layouts now use the site's shared heading-rail width token and responsive breakpoints, rather than an expanding remainder column. Verified at a 1508px viewport: the article rail was 393px, matching the shared rule.

Explicit updates to existing articles and short posts return to the saved canonical reading URL (including blog URLs). New publication retains its My Profile destination. Autosave and Save draft keep the article editor open; concurrent edits finish saving before a requested update navigation. Reading pages still require an explicit Edit action to reopen editing. No deployment.

### Rail breakpoint correction

The previous match used the Quran/hadith expanding width, which differs from the compact search rail. Live local comparison showed 393px at 1508px on both the reader and article, but search uses 18rem; articles also incorrectly retained a 220px side column below the reader's 992px cutoff. Article rails now use 240px at 992–1199px, the shared search-width token (18rem) from 1200px upward, and no side rail below 992px. Other reader widths remain unchanged. Browser verified: 900px -> no side rail; 1100px -> 240px; 1508px and 1920px -> 324px at the site's 18px root font. This supersedes the expanding-width approach above. Screenshot: article-rail-compact-breakpoints.jpg (ignored). No deployment.

### Exact search layout and fluid article correction

The compact rail alone left the article constrained by Bootstrap's container and Community's 1120px outer/780px reading limits. Blog and Community article reading pages now use the search layout's 90rem outer maximum, 1.5rem gutters, 2rem column gap, and shared 18rem rail at every desktop breakpoint from 992px. The article fills the remaining column; mobile keeps a single column and .75rem gutters. This supersedes the 240px intermediate rail rule above.

Verified actual local blog and search pages in Chrome: at 1512px both rail widths are 324px and both start at x=1146; at 1024px both remain 324px, with the article occupying 595px and no horizontal overflow. Templates compile, all three TOC tests pass, and diff whitespace checks pass. Screenshot: article-search-layout-match.jpg (ignored). No deployment.

### Author bio rail

Blog and Community article reading pages now share a left author rail with avatar, name, profile link, and the available profile bio. Bio loading uses the existing authenticated profile endpoint and safe plain-text/link renderer, preserving profile visibility and clearing displayed bios on account changes. The left rail mirrors the right rail's 18rem width, fixed header offset, footer boundary, and 992px mobile cutoff. The article occupies the middle column. Blog Community scripts now include their content version to avoid stale browser assets.

Local Chrome verified the real author's bio and link, equal 324px rails at 1512px and 1024px, and both rails hidden at 390px without horizontal overflow. Screenshot: article-author-bio-rail.jpg (ignored). Templates compile; TOC, autosave, and update-navigation suites pass (26 tests). No deployment.

### Bio rail yields space before the article

The left bio rail now shrinks from the shared 18rem width toward 12rem as desktop space narrows, then hides below 1400px. The article recovers that column and gap. The right heading rail retains its existing 18rem width and 992px cutoff. Community article headings use the same shrinking left offset. This supersedes the equal rail cutoff above.

Chrome verified: at 1463px the bio is 275px and article 723px; at 1400px the bio shrinks to 216px while article stays 719px; at 1390px the bio hides and article expands to 961px. Right rail stays 324px throughout, with no horizontal overflow. Screenshot: article-bio-responsive.jpg (ignored). Diff checks pass; no deployment.

### Short-post author bio rail

Short-post permalinks reuse the article author rail and existing authenticated bio loading. The rail shrinks toward 12rem and hides below 1400px, while the short-post reading and reflection column remains capped at 780px. Rail positioning now supports a left rail without a right rail, including the footer boundary. Short posts keep their existing follow controls and do not gain an unrelated heading rail.

Verified the user's short-post permalink in local Chrome: author bio and link load, 324px rail beside a 780px post at 1512px; the bio hides at narrower widths and the post fills mobile space without horizontal overflow. Templates compile and 26 TOC/autosave/navigation tests pass. Screenshot: short-post-author-bio-rail.jpg (ignored). No deployment.

### Shared individual-page social bar

Blog articles and Community post/article pages now render one shared action template and use the same vote, comment, repost, share, report, and owner-edit controls. Individual-page bars no longer include the permalink arrow; feed cards retain their navigation. Blog comment actions open the existing blog reflection composer, and its live comment count updates the shared bar without moving or replacing existing discussions. The separate article edit/share controls were removed in favor of this bar.

Verified local article and short-post pages show Like, Dislike, Comments, Repost, Share, Report, and owner Edit with no permalink arrow. Article Comments navigates to the existing blog composer. The blog discussion currently displays its existing “Failed to load comments” state; posting was not tested or performed. Shared-template, autosave, update-navigation, and blog-cache checks: 49 tests pass. Screenshot: article-shared-social-bar.jpg (ignored). No deployment.

### Consistent reflections across reading and feed surfaces

Post reflections, blog and reader comment widgets, and inline feed replies now use the same avatar/entry/composer classes and shared CSS. Reaction counts sit beside their icons instead of a separate floating badge; timestamps, author typography, reply rules, spacing, neutral controls, and mobile touch targets match. Composers use the same plain Post/Save controls, reflection placeholder, and quiet posting identity; account-provider badges and redundant in-composer sign-out controls were removed (account controls remain in the site menu). Blog articles use the same collapsed Reflections disclosure as individual posts. Existing reply contexts, cancellation, drafts, extended Markdown, and context-specific moderation/edit actions are retained.

Fixed the discovered article-comment loading error by mounting the existing blog-comments router at both API prefixes used by the widgets/feed, while preserving its original route. Local article verification now loads the empty thread successfully instead of the prior error. Focused editor, disclosure, feed, action-template, and post-reflection checks: 70 tests pass, including nested Arabic replies, reaction counts, permissions, and cancel preserving draft text. No public comments were posted.

Browser verification: article reflections now load without errors; the short-post page shows the same disclosure, empty state, and Post composer; the hadith reader widget loads with matching controls. At 390px the post reflection form has no horizontal overflow. Screenshots: reflections-consistent-article.jpg and reflections-consistent-mobile.jpg (ignored). Templates and JavaScript syntax checks pass. Not deployed.

### Consistent reflection action iconography

All reflection/reply renderers now use the social bar's heart, thumbs-down, and comment-bubble glyphs, including inline feed replies. Reply controls no longer use the separate bent-arrow glyph. Dislike and selected Undo labels match across widgets and Community threads. Shared icon geometry fixes size, baseline, count spacing, and hover/focus treatment while retaining filled selected reactions and compact controls.

### Remove publication switch from reading pages

Removed the Blog post switch from the shared full-page social bar; article editing retains its publishing control. Reading-page initialization no longer requires that switch. Reports continue to store the reporter, post, optional comment, and reason in community_reports and appear in the moderator-only /community/moderation queue. Reporting itself does not send email or automatically hide content.
