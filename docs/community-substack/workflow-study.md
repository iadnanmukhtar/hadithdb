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
