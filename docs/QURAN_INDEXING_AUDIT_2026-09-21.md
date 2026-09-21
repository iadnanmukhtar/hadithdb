# Quran indexing audit — September 21, 2026

## Outcome and deployment status

Sitemap delivery is fixed in this checkout and verified on the running local application. Production deployment and submission of the new `/sitemap.xml` index remain pending; no production deployment mechanism was available in the repository.

Search Console cleanup is complete: removed the old oversized `/sitemap.txt` submission (Google explicitly reported **Too many URLs**) and the failed old `/sitemap-5.txt` submission. Verified the submitted list now contains only the four successful files, `/sitemap-1.txt` through `/sitemap-4.txt`. These remain in place until the new index is live. Removing a sitemap submission does not remove its content URLs from Google.

The new generated inventory needs a fifth file again. That new file will be discovered through the new index after deployment; it is not the obsolete 798-URL submission removed above.

## Evidence and coverage

- [Page indexing](https://search.google.com/search-console/index?resource_id=sc-domain%3Aquran.islamunlocked.com), updated September 17: 61 indexed; 188,996 discovered but not indexed; 4,791 crawled but not indexed; 3,979 redirects; 213 noindex exclusions.
- [Crawl stats](https://search.google.com/search-console/settings/crawl-stats?resource_id=sc-domain%3Aquran.islamunlocked.com), updated September 19: 90.4K requests over 90 days, 95% refresh / 5% discovery, 308 ms average response time, no host problems. Requests include resources and repeated visits, not just distinct HTML pages.
- All 61 indexed examples were reviewed to choose samples. There were verse URLs, surah passage URLs, tafsir catalogs, and one legacy tafsir passage URL. No bare `/quran/<surah>` URL was in that indexed example list.
- Twelve anonymous local HTTP samples were inspected for response, canonical, robots, server HTML, content, links, and duplication. Live browser rendering was checked for verses, surah passages, tafsir catalogs, and a tafsir passage.
- The live browser has an existing Khattab translation preference; some core verse/passage navigations therefore changed to `/quran/en-khattab/...`. Anonymous local HTML was used to verify default canonical and content separately. Personalized browser URLs are not evidence of Google's selected canonical.
- Google URL Inspection for `quran:38:75` explicitly reported successful fetch on September 19, crawling allowed, indexing allowed, and the inspected URL as Google-selected canonical, but it was not indexed.
- This is a bounded audit, not a crawl of all 200K pages. Local raw HTML measurements are not claims about production transfer sizes or every production cache variant.

## Sitemap fix

Files: `routes/search.js`, `app.js`, `spec/sitemapDelivery.spec.js`.

1. `/sitemap.xml` now returns a sitemap index referencing the actual number of existing text children; each child contains at most 50,000 URLs.
2. `/sitemap.txt` permanently redirects to the index, rather than returning an oversized full inventory.
3. Missing or invalid numeric child pages return HTTP 404 directly, without a redirect to an HTML error page.
4. `/robots.txt` advertises the appropriate hostname's sitemap index and preserves existing directives.
5. All 6,236 core verse URLs are required and generated, independently of whether a verse has a stored English title. The old live inventory contained only `quran:34:46` and `quran:5:32` as core verse URLs.
6. Cached inventories missing these verses rebuild automatically. Duplicate URLs are removed before pagination.
7. Bare surah URLs, which redirect to the first passage, are excluded; canonical passage URLs remain.
8. Shared Hadith sitemap index delivery stays on the Hadith hostname.

Local end-to-end results:

| Child | URLs | Uncompressed bytes | HTTP |
|---|---:|---:|---:|
| sitemap-1.txt | 50,000 | 3,137,196 | 200 |
| sitemap-2.txt | 50,000 | 3,268,208 | 200 |
| sitemap-3.txt | 50,000 | 3,232,601 | 200 |
| sitemap-4.txt | 50,000 | 3,318,597 | 200 |
| sitemap-5.txt | 297 | 19,793 | 200 |
| sitemap-6.txt | — | 19 | 404 |

Total: **200,297 unique URLs**, exactly **6,236 core verses**, no bare-surah redirects. Counts reflect the local corpus at audit time. The XML index and robots declaration were also read from the running application.

Validation: focused sitemap and existing analytics tests, JavaScript syntax checks, and `git diff --check`. Tests exercise the 50,000 boundary, final partial child, direct 404, stale-cache rebuilding, untitled verse inclusion, duplicate removal, redirected-surah exclusion, legacy redirect, and hostname separation.

Google references: [sitemap indexes](https://developers.google.com/search/docs/crawling-indexing/sitemaps/large-sitemaps), [formats and limits](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

## Representative page audit

Statuses below are the observed Search Console report classifications, not promises of current search visibility. All sampled final anonymous local pages returned 200, supplied their expected canonical, and had no noindex directive.

| Family | Indexed example | Unindexed example | Finding |
|---|---|---|---|
| Verse | [49:15](https://quran.islamunlocked.com/quran:49:15) | [38:75](https://quran.islamunlocked.com/quran:38:75), crawled/not indexed | Both have substantive Arabic and English server-rendered text, descriptive titles, breadcrumbs, and neighbouring navigation. No template-level indexability difference was found. |
| Surah reading passage | [52/1](https://quran.islamunlocked.com/quran/52/1) | [76/1](https://quran.islamunlocked.com/quran/76/1), crawled/not indexed | Both contain substantive bilingual passage text. Bare `/quran/52` and `/quran/76` redirect to their first passages; they are not distinct full-surah documents. |
| Tafsir catalog | [Irab al-Quran](https://quran.islamunlocked.com/quran/tafsir/irab-al-quran) | [Aysar](https://quran.islamunlocked.com/quran/tafsir/aysar), crawled/not indexed | Both have book identity and extensive crawlable navigation. Anonymous HTML contains 1,853 main-area anchor elements in each (730 and 717 unique hrefs respectively), including alternative TOC views. Much of their structure is shared. |
| Tafsir passage | [Legacy Saadi 2/62](https://quran.islamunlocked.com/quran/tafsir/saadi/2/62) appears in indexed report | [Baghawi 106:1](https://quran.islamunlocked.com/quran/tafsir/baghawi/quran:106:1) is an additional rendering sample; individual index status not inspected | Legacy Saadi redirects to `/quran/tafsir/saadi/quran:2:62`; the historical indexed legacy URL does not establish the new canonical's status. Both sampled current templates initially contain empty commentary content areas. |

### High-priority finding: tafsir depends on JavaScript

`views/tafsir_passage.ejs` supplies `initialTafsirEntries` to `views/sub-views/quran_tafsirs.ejs`. That partial serializes the entries into `script[type=application/json].quran-tafsir-initial-data` and emits an empty `.quran-tafsir-content` div. `public/static/js/script.js` subsequently builds the panels.

The anonymous Saadi sample contains 4,016 characters of commentary HTML inside JSON, and Baghawi contains 8,904. In both, the server-rendered `.quran-tafsir-content` has zero non-whitespace HTML characters. Baghawi's Arabic commentary and footnotes did appear in the live rendered DOM. The text is available, but depends on JavaScript initialization for its article presentation.

Recommended next implementation: render the initial selected tafsir as actual article HTML, then enhance that same markup on the client. Preserve Arabic/English columns, exact source text, footnote IDs, bookmarks, and carousel behavior. Do not create duplicate visible articles or disable required content APIs. This audit did not change the tafsir rendering architecture.

### Duplication and internal linking

The article text in anonymous `quran:38:75` and its parent `/quran/38/8` matched exactly (2,832 normalized characters after excluding scripts, styles, selectors, and modals). The verse URL adds its selected-verse hero and different title/canonical. Adjacent `quran:38:76` repeats the surrounding passage and adds a different hero and similar-verse material.

This is meaningful overlap, not proof that Google classified these URLs as duplicates. Do not canonicalize all verses to their parent passages without a deliberate product decision. The verse pages have independent verse-reference intent.

Passage pages link to books, chapters, and neighbouring passages; individual ayah controls and tafsir/translation entry points often use buttons that need interaction. Therefore content navigation available to a person is not always a direct crawlable anchor to the canonical verse/detail URL. The corrected verse sitemap addresses the verified discovery omission; a follow-up can add accessible, normal links to appropriate existing controls.

Catalog pages are link-rich, so these samples are not orphaned empty catalogs. More links alone does not explain why Irab is indexed and Aysar is not. Clear book-specific introductions and distinctions would be more useful than repeating generic SEO copy across catalogs.

## Analytics and resource review

### Two production analytics configurations

Production DOM contains both:

- App tag **G-9VR5K0F8Q9**, emitted by `views/sub-views/scripts.ejs` and selected by `lib/GoogleAnalytics.js`.
- Head-injected tag **G-WN0F9NNBRE**, associated with `google_tags_first_party` and `/9j51/` scripts.

The second tag is absent from the searched repository source and anonymous local output. Its markup and first-party request paths identify gateway injection outside the app; confirm its configuration in Cloudflare/Google Tag Gateway before changing it. [Cloudflare documents that gateway injection is zone-wide, including subdomains](https://developers.cloudflare.com/google-tag-gateway/).

Crawl Stats' Other category totals 45.3K requests (50% of all requests). The first ten sampled requests were `/9j51/ga/g/c` analytics events. Matching page loads emitted `quran_script_default` to both measurement IDs. This proves duplicate event destinations in the sample; it does not prove all 45.3K requests were analytics or that removing them would produce an equivalent increase in content crawling.

Recommended configuration review: establish whether the zone-wide tag is intentional cross-site reporting. If not, remove the extra tag setup or use supported hostname-specific tag firing. Do not blindly disable the entire gateway, since it can serve other subdomains. No gateway or analytics account settings were changed.

### Default-script event

`initQuranScriptPreference()` calls `trackQuranScriptDefault(script, 'resolved')` on initialization. The latter sets the `quran_script_default` user property and sends a separate non-interaction event. Page-level deduplication prevents repeated identical calls per document, but each page load still creates the event, and both configured tags receive it.

Recommended simplification: keep the user property and send preference-change events on actual user changes rather than emitting a resolved-default event on every page. Analytics behavior was reviewed, not changed, in this task.

### JSON requests need classification, not a blanket block

The JSON category totals 10.6K requests. Its first ten examples included full-book `.json` downloads (Yusuf Ali, Jalalayn, Basit, Rida, Khattab, Itani) and older `/quran/api/comments`, `/quran/api/likes`, and `/quran/api/corpus` requests. These examples date from August, so the cumulative category does not establish the current request mix. Current robots already disallows `/api/` and `/quran/api/`; no additional API blocks were added.

Preserve content/data endpoints needed for rendering and controls. Review download indexing separately from content APIs. Optional comments/likes can be initialized on relevant interaction or visibility rather than eagerly, but verify existing lazy-loading behavior before changing it.

### HTML and inline-script weight

Anonymous local samples were approximately 0.72–1.39 MB of **uncompressed HTML**, not compressed network transfer. The 52/1 page contained 89 script elements and about 858 KB of inline JavaScript (excluding JSON/JSON-LD); 76/1 contained 77 scripts and about 714 KB. Repeated inline comment-widget initialization in ayah modal panes contributes to this growth. Tafsir samples also embed roughly 295–299 KB of JSON data including catalogs and initial entries.

Recommended follow-up: extract shared comment-widget logic into one cacheable module and instantiate widgets only when needed; trim repeated catalog payloads after verifying consumers. Keep essential CSS, fonts, reader JavaScript, and actual commentary resources accessible. No robots restrictions or rendering-resource removals were introduced.

## Remaining production steps

1. Deploy only the intended sitemap changes, preserving unrelated notebook work in this checkout.
2. Fetch production `/sitemap.xml`, all listed children, `/robots.txt`, and an out-of-range child; verify hostnames, XML, counts, core verses, 200/404 statuses, and no redirects in the submitted inventory.
3. Submit `https://quran.islamunlocked.com/sitemap.xml` in Search Console after those checks pass. Retain the four valid existing submissions until the new index is accepted; they are not harmful obsolete errors.
4. Implement and verify server-rendered tafsir content as the highest-priority rendering follow-up. Request indexing for a small representative set after deployment; monitor discovery/indexing by page family over subsequent weeks.
5. Review the gateway's second measurement ID and resolved-default event with analytics intent established. These optimizations do not guarantee additional indexing.
