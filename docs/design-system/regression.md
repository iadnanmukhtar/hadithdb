# Front-end regression coverage

Run `npm test -- --runInBand` for the repository suite. For browser checks, start the local app with `npm start` and run `npm run test:frontend:all` from the repository root. Each part can also run independently. The browser suites use Chrome through Playwright and default to localhost on port 3004. Set `UX_TEST_ORIGIN` to select another local instance and `UX_BROWSER_CHANNEL` to select an installed browser channel.

| Command | Coverage |
| --- | --- |
| `npm run test:frontend` | Opens the routes in the design-system inventory and additional direct entries at 390 and 1440 px. Checks response status, shell, viewport overflow, anonymous edit visibility and computed page-title parity with Settings. Exercises menu dismissal, dark canvas, catalog search and dialog focus return, Community contributor search, Settings filtering, Quran navigation and expandable contents. |
| `npm run test:frontend:admin` | Renders the administration template and shared editor against disposable responses. Opens all five bilingual pair managers and the legacy grader manager, adds, edits, merges and removes disposable pairs, saves a book alias, edits formatted Markdown and an RTL field, retries a rejected save and changes a draft during an in-flight save. Checks immediate select updates and explicit commentary submission. |
| `npm run test:frontend:personal` | Exercises failed and successful preference saves and reads the result on the Quran Settings route. Checks a shared note outline link and keyboard zoom. Account identity and persistence use local fixtures. |

The Jest checks in `spec/frontendMakeover.spec.js` compile every EJS file, resolve local includes, enumerate HTML document templates and confirm that admin modal triggers resolve to labelled, dismissible dialogs. The route suite checks the retired translation request list and both feeds for HTTP 410. The route suite also verifies all twelve retired list, feed and RSS URLs redirect to Community. The sitemap suite checks that an older cached sitemap omits the retired list when served.

## Interpreting results

A successful route check verifies the loaded state and the interactions listed above. Private screens reached anonymously exercise their access boundary. Browser fixtures exercise the client’s save contract. Live sign-in, payment, mail delivery, Drive synchronization and database mutations require separate integration verification.

To track an existing failure, run the same Jest command on both revisions with `--json --outputFile=<path>`. Compare failed assertion names and suites that fail during setup. Totals alone can hide a new failure when an unrelated timing-sensitive test passes.

## Layout checks

The scripts under `skills/hadithdb-ux-audit/scripts/` exercise details that a page-load assertion misses.

- `compare-titles.js /settings /books` compares computed typeface, size, weight and line height.
- `compare-toc-layout.js` checks Hadith, Tafsir and Sharḥ contents against Books at 390, 700, 701, 991, 992 and 1440 px. It distinguishes the visible rail from the closed navigation drawer and checks the available width of bilingual title rows.
- `check-search-insets.js` measures the centered icon on the collapsed search launcher and both insets on the expanded launcher.
- `compare-overlay-close.js` checks close-button size, glyph, keyboard focus and return to the opener in light and dark themes.

## Makeover verification on November 23, 2026

The live route suite passed all 170 checks across 85 URLs and two viewport widths. The personal and admin fixture suites passed at both widths. All 18 book contents layout comparisons passed, along with the search inset and overlay dismissal checks.

The full Jest run recorded 3,395 passing tests, 81 failures and 84 skips. The pre-edit baseline had 3,353 passing tests, 89 failures and 84 skips. Every remaining failure also appeared in the baseline comparison by suite and assertion name. Outstanding failures include Community editing, reader routing, metadata, and source-import fixtures. The skipped cases include MySQL integration and source-EPUB-dependent tests. Live payment, Google sign-in, Drive synchronization, email delivery and corpus writes remain unverified.
