# HadithDB

HadithDB (Hadith Unlocked) is a website for reading, searching, and citing the Quran and ḥadīth. You can browse it online at <https://hadithunlocked.com>.

Every record keeps the original Arabic text alongside an English translation where one is available, together with chapter listings and grading information. For ḥadīth, the chain of narrators (isnād) and the report itself (matn) are stored separately so each can be read and searched on its own.

## What's New

Recent work has improved the reading, browsing, and search experience across the site:

* **Reading the Quran** — move naturally between Passage, Ayat, Mushaf, Practice, and Mudhakkir views while the site keeps your place. You can like, comment on, bookmark, and share a passage, move easily between verses and sections, and use the page-faithful Mushaf with database-backed spaced repetition.
* **The 15-line Mushaf** — read all 604 pages in a responsive, page-faithful Digital Khatt layout with infinite scrolling, Quranic surah headers, interactive words and ayah markers, page bookmarks, passage-aware coloring, and continuous recitation.
* **Commentary and translation** — full-page commentary and translation views, tabs for switching between commentary works, hover explanations, dynamic translation selection, and the option to show Arabic and English side by side. You can turn individual works on or off and choose the order they appear in.
* **Quran audio** — choose a reciter, begin from a selected ayah, continue across page boundaries, repeat a passage or subsection, and control playback speed without losing synchronized ayah highlighting or translation captions.
* **Search** — searching now covers the Quran and its commentaries as well as ḥadīth, returns Quran matches faster, lets you filter to commentary results, and presents cleaner highlights and a single, unified set of suggestions.
* **My Settings** — separate starting points for ḥadīth and Quran, remembered commentary, translation, and reciter preferences, and bookmarked passages and Mushaf pages saved for later.

## Quran Unlocked

**Read the Quran as a book, explore it as a study text, and hear it as a continuous recitation—all in one place.** Quran Unlocked combines a responsive 15-line Mushaf with word-level learning, passage structure, trusted translations and tafsīr, personalized audio, and tools for saving and sharing what matters.

Open the Mushaf and begin where you left off. Tap a word for its meaning, select an ayah to read its translation, or let the recitation carry you seamlessly across pages. Switch to Practice to test recall against the same 15-line page layout, or move instantly to a focused ayah or structured passage without losing your place.

## Quran Features

### Five connected reading modes

* **Passage** presents the Quran in titled sections and subsections for thematic reading.
* **Ayat** focuses the reading experience on individual verses and the ayah hero view.
* **Mushaf** reproduces the familiar 15-line, page-by-page reading experience.
* **Practice** keeps the Digital Khatt Mushaf font and 15-line page layout while replacing ordinary words with underlined blanks. The basmalah and ayah markers remain visible.
* **Mudhakkir** tests due ayat using an ayah-level spaced-repetition schedule. Learning ayat enter the queue first and progress through short new-card steps before graduating to Good.
* The mode links, page subtitle, URL, previous/next links, and related passage automatically follow the content currently in view during infinite scrolling.
* Direct navigation is available by surah, ayah, passage, subsection, juz, manzil, Mushaf page, and search result.

### A responsive Digital Khatt Mushaf

* All **604 pages** use Digital Khatt Quran text in a page-faithful 15-line layout.
* Pages load continuously with vertical infinite scroll; after page 604, reading can continue again from page 1.
* The layout scales for desktop, portrait phones, and landscape phones without changing through the normal text-size controls or bleeding beyond the page.
* Quranic surah headers use the QCF header font. A new surah opens with its header and basmalah kept with the beginning of the surah; Surah 9 correctly omits the basmalah.
* Subtle inner-edge shading distinguishes odd and even pages like an open printed book.
* Alternating black and saddle-brown text reveals h3 subsection boundaries while preserving the Quranic styling of ayah markers.
* Each page identifies its page number, juz, surah number, and Arabic surah name. Page, juz, and surah numbers are directly editable, while the custom surah picker opens at the current surah.
* The page footer links the passage and subsection titles that actually begin on that page, making the Mushaf’s thematic structure visible without repeating earlier headings.
* `/quran/page` resumes at the bookmarked Mushaf page, or page 1 when no page bookmark exists.

### Practice view

* Open a Mushaf page with `?memorize`, such as `/quran/page/1?memorize`, select **Practice** from the Quran reading-mode controls, or use the **Practice** item after **Tafsir** in the Quran menu.
* Hidden words retain their exact Digital Khatt width and placement and are individually underlined, preserving the page-faithful 15-line layout. Surah headers, the basmalah, and ayah markers remain visible.
* Clicking a hidden word reveals it; clicking that visible word hides it immediately. When Word auto-hide is enabled, a clicked word fades back to an underlined blank after **two seconds**.
* The chevron beside each āyah marker includes **Play** and **Reveal** in Practice mode. Reveal changes to **Hide** while that āyah is visible. Play uses the reader's default reciter, automatically reveals the complete āyah, plays only that one āyah, and shows its translation in the audio marquee; neither action changes memorization or FSRS state. Play remains available during Mudhakkir, while the separate Reveal and Hide actions are omitted there.
* Clicking an ayah marker toggles that complete ayah between visible text and blanks without changing the other ayat.
* Alt-clicking, Option-clicking, Command-clicking, or Control-clicking an ayah marker toggles that ayah and all earlier ayat on the Mushaf page between visible text and blanks.
* Icon-only **Page** and **Word auto-hide** controls appear at both the top and bottom of each page. The bottom controls replace the passage and subpassage headings in Practice mode.
* The **Page** control reveals every word on that page or returns the page to blanks. Hiding also clears individual word and ayah reveals.
* The **Word auto-hide** control determines whether individually clicked words disappear after two seconds or remain visible. Auto-hide is off by default and remains a page-local display control; it is not stored as memorization progress in the browser.
* The plus and minus controls reveal the next hidden ayah or hide the most recently revealed ayah, one ayah at a time.
* Each page keeps its own state as additional pages load through infinite scrolling, and Practice mode remains active through page, surah, juz, URL, and previous/next navigation.
* Audio, reciter and translation controls, the translation marquee, and word-translation tooltips are intentionally omitted so the view remains focused on recall.
* Optional recitation feedback records a short passage, sends it to a separately configured self-hosted Quran speech-recognition service, and highlights matched, missed, different, and repeated words. It does not change Mudhakkir ratings automatically.

#### Self-hosted recitation feedback

Recitation feedback is disabled unless it is enabled in `~/.hadithdb/settings.json`. It does not use the site's personal OpenAI key. A self-hosted Quran speech-recognition service is included under [`services/quran-asr`](services/quran-asr/README.md); configure HadithDB to call it:

```json
{
  "quran": {
    "recitationFeedback": {
      "enabled": true,
      "endpoint": "http://127.0.0.1:8010/transcribe",
      "model": "tarteel-ai/whisper-base-ar-quran",
      "token": "replace-with-a-long-random-value"
    }
  }
}
```

The endpoint receives `multipart/form-data` containing `file`, `language`, `prompt`, `page`, and optional `model` fields. It must return JSON in the form `{ "text": "recognized Arabic words" }`. Keep `enabled` false, or omit the section, to remove the microphone controls and restore the global `microphone=()` browser permission policy.

### Ayah-level memorization and spaced review

Memorization identity is the surah and ayah reference, not a Mushaf page. Page numbers remain useful for navigation, but every ayah has its own lifecycle, schedule, and append-only review history. Untouched ayat behave as **Later** without creating 6,236 rows for every user.

The six visible memorization states use the same recall language as the review grades. Automatic recovery is stored internally but presented inside Hard:

| State | Meaning |
|---|---|
| **Later** | Memorization has not started, or the ayah was removed from active memorization |
| **Learning** | Memorization has started but the complete ayah is not yet independently recitable |
| **Hard** | The ayah is memorized but recall is fragile, so it remains scheduled with shorter review intervals; automatic recovery after a failed Good review is included here |
| **Good** | The complete ayah can be recalled independently and remains under spaced review |
| **Easy** | The ayah is known by heart, considered memorized, and not scheduled for regular review |
| **Paused** | Learning or review is temporarily suspended without deleting its schedule or history |

* Signed-in readers make one initial self-assessment for an untouched Later āyah: Learn, Hard, Good, or Easy. After enrollment, review grades manage Learning, Hard, and Good; individual āyah, page, surah, and progress-group controls expose Easy, Paused, and Later. A complete page or surah can receive another initial bulk assessment only while all of its āyāt are Later. Signed-out readers are not shown a control that could imply local persistence.
* A new account with no Quran memorization rows starts with all 18 āyāt of Surahs 1, 113, and 114 in Learning. Initialization is idempotent and never adds these starter āyāt to an account that already has any memorization state recorded.
* An initial **Learning** assessment creates a New FSRS 6 card, admits it gradually within the Learning and overall session caps, and gives admitted Learning cards the highest queue priority. Again resets learning progress, Hard keeps it Learning, two successful Good reviews graduate it, and Easy graduates it immediately. The first intervals are approximately 10 minutes to 1 day for Again, 1 to 2 days for Hard, 3 to 4 days for Good, and 6 to 7 days for Easy before FSRS adapts them from review history. The Learning summary tile on **Memorization Progress** filters to groups containing Learning ayat and links each group directly to its first Learning ayah in Practice mode.
* An initial **Hard** assessment initializes the ayah like a Hard review result, with lower stability, higher difficulty, and a short first interval. Hard āyāt remain eligible for regular review. One Easy or two consecutive Good reviews can promote Hard to Good once its FSRS difficulty is 6 or lower; difficulty greater than 6 keeps it Hard.
* An initial **Good** assessment confirms that the complete ayah can be recited independently. FSRS initializes it like a Good result, records the memorization date, and schedules its first recall from that strength. Good is not a terminal archive: the scheduler continues adapting the interval after each review.
* An initial **Easy** assessment initializes the FSRS estimate like an Easy result, records a memorization date, clears the next review date, and keeps the āyah out of regular review. It can still be included deliberately in a custom Surah review session.
* A scheduled Good or Hard āyah also graduates automatically to **Easy** after a Good or Easy review when its FSRS stability is greater than 730 days and difficulty is below 2. Graduation clears its next review date. Existing cards that already satisfy both thresholds are migrated to Easy. A user may also mark an individual enrolled āyah as Easy directly.
* **Hard** combines deliberately fragile memorization, any scheduled āyah with an FSRS recall-difficulty score greater than 6, and scheduler-driven recovery after Again on a Good āyah. Recovery remains distinct internally for scheduling, but it uses the Hard label, red color, count, and progress filter. Successful reviews return it to Good only after calculated difficulty reaches 6 or lower.
* **Later**, **Easy**, and **Paused** āyāt never enter regular Learning or Mudhakkir queues. **Regular review** for a surah follows that same rule. An **all-āyāt review** deliberately enrolls Later āyāt in the selected surah as Learning and can include Easy and Paused āyāt in the session. After enrollment, the only manual changes are Easy, Paused, or Later, and all preserve review history. Internal recovery remains distinct from Later and is presented as Hard because it represents previously memorized recall that now needs strengthening.
* Practice and Mudhakkir use consistent accents for Learning, Hard, Good, Easy, and Paused. Hard is red, Good is blue, and Easy is green, matching the review-grade buttons. Internal recovery uses the Hard presentation. The regular Mushaf does not show memorization-state highlights. Where accents are shown, the full ayah is treated without reducing Arabic-text contrast, and the marker also exposes a textual state so color is not the only cue.

Select **Mudhakkir** to open `/quran/review`, which combines Memorization Progress with the session launcher. Progress reports Due now, Learning, Hard, Good, Easy, Paused, and Later against the canonical 6,236 ayat rather than counting stored rows alone. Due now includes initialized FSRS cards whose scheduled timestamp has arrived. Learning includes both ungraded FSRS New cards and Learning cards with review history, since New is an internal FSRS phase rather than a separate memorization state. Automatic recovery remains internal and is included in the Hard count, filter, color, and page summaries. Hard, Good, and Easy are initialized immediately from the user's stated memory strength. The active-progress table groups Mushaf pages beneath each surah and shows a shared page under every surah it contains; each row counts only that surah's ayat on the page and shows its per-stage totals and Arabic opening words without a translation.

The top of the signed-in Mudhakkir page shows a one-year review activity heatmap, today's reviewed āyāt and elapsed review time, daily average, percentage of days learned, longest streak, and current streak. Scheduler, review, and session timestamps are stored as UTC. Due checks compare UTC instants, while displayed dates, heatmap days, streaks, and the set of āyāt revealed as reviewed today use the current browser's timezone. This keeps late-evening reviews on the user's local day while progress remains consistent across devices.

Signed-out visitors see a concise Quran memorization introduction with a sign-in invitation, a plain-language explanation of how adaptive spaced review keeps Quran hifz fresh, progress-tracking benefits, and a link to explore the Mushaf. Memorization Progress and review-session controls are shown only after authentication.

During a recall attempt, the sticky controls record a result rather than changing a permanent status directly:

Mudhakkir pages after page 1 show the final Arabic line of the preceding Mushaf page in a compact, always-visible continuity strip above the current page. The strip is non-interactive and excluded from concealment, grading, memorization-state controls, and audio selection.

| Result | Scheduling meaning |
|---|---|
| **Again** | Recall failed; keep Learning or Hard in its current state, move Good into Hard recovery, and allow one retry near the end of this session |
| **Hard** | Recall succeeded independently with significant hesitation; use a shorter next interval |
| **Good** | Recall succeeded with ordinary effort; use the normal next interval |
| **Easy** | Recall was fluent and effortless; use a longer next interval |
| **Skip** | Advance without changing lifecycle, strength, schedule, or review history |

The help text reserves Again for an attempt that required reading the ayah or receiving its missing continuation; Hard still means the complete ayah was recalled independently. The first Again queues the same āyah once near the end of the session. A second Again records the lapse without another retry, so the same āyah can receive Again at most twice per session and cannot create an unlimited loop.

Regular review sessions are persisted and bounded. They admit eligible Learning, Hard, and Good āyāt, including automatic Hard recovery, allocate the overall limit fairly across nonempty categories, and present Learning first. Fragile Hard āyāt and previously Good āyāt in Hard recovery share one combined Hard cap. Newly enrolled, ungraded Learning cards are immediately included in Due now, but enter each session gradually under the Learning cap. Any one-time Again retries follow the original queue; Easy āyāt are not admitted to regular sessions. An āyah cannot reappear after a grade or Skip unless it entered that retry slot. **My Settings → Quran Memorization** and the **Mudhakkir settings** modal configure the maximum total āyāt per session (default 10), optional time budget, and a collapsed Advanced session limits group containing Learning, Hard, and Good caps plus queue order.

#### Page and surah review

The **Start Review** menu offers a custom **Surah Review** session. Its autocomplete accepts English names, Arabic names, Arabic or Latin surah numbers, and alternate names. Suggestions use the Quran search result style and show the surah number, English name, Arabic name, and total āyāt.

Practice mode also places a **Mudhakkir** button beneath each Mushaf page. Its contextual dialog offers **Just this page** or **A surah**. Just this page creates a persisted page-review session containing the āyāt on that exact Mushaf page, including pages shared by multiple surahs. A surah opens the same searchable Surah Review workflow without requiring the user to return to Memorization Progress first.

After choosing a surah, the user chooses one of two review types. **Regular review** uses only that surah's eligible Learning, Hard, and Good āyāt, follows their existing due schedules and regular session limits, and does not enroll or change untouched āyāt. **All-āyāt review** enrolls every missing or Later āyah in the surah as Learning and adds the complete surah to a persisted Quran-order session. Already-enrolled Learning, Hard, Good, Easy, and Paused āyāt receive no enrollment write: their existing state, schedule, and history are preserved when the session is created, and they are simply added to its queue. The user can review **āyah by āyah** or **passage by passage**. Passage review uses the most specific Study range containing the current āyah—an h3 range when available, otherwise its h2 range. The passage is only an āyah batch: the chosen result is recorded as a separate review event for every included āyah, and each āyah receives its own FSRS calculation, state, and next-review schedule.

Page-review and all-āyāt sessions are not constrained by Due now, regular category caps, or the optional time budget. They continue until every included āyah has been graded or skipped. **Regular review** for a surah uses the normal scheduler and its limits. Again, Hard, Good, and Easy are recorded as real FSRS assessments, so grading an Easy or Paused āyah in an all-āyāt session can return it to scheduled memorization according to the result. Skip advances without changing the āyah's state, schedule, or review history.

The Mushaf review footer can pause a page or surah review session without losing its current āyah or queue position, or end it while preserving completed review history. Memorization Progress lists the active session together with paused sessions. Continuing the active session or switching to a paused session is explicit; switching atomically pauses the current session before resuming the selected one. Any active or paused session can be ended. Ending closes its remaining queue while retaining completed FSRS review history.

FSRS 6 settings are available in My Settings and in a modal on `/quran/review`:

* **Target Memory Goal** ranges from 80% to 95% and defaults to the recommended 90%. Raising it increases review frequency.
* **Initial Memory Strength** adjusts the first intervals for new ayat.
* **Mudhakkir Interval Multiplier** offers conservative, standard, and aggressive stability growth.
* **Lapse Recovery Speed** offers mild, standard, and strict stability penalties after Again.
* **Personalize Algorithm** uses the official FSRS optimizer after at least 100 graded reviews. It trains all 21 FSRS 6 parameters from the user's append-only history and is intended to be rerun about monthly.

Difficulty damping, mean reversion, and same-day review smoothing are handled automatically. The simplified controls transform the default or personalized parameter vector and do not expose the underlying mathematical weights.

Mudhakkir deliberately uses one focused ayah workflow rather than separate Individual Ayah and Connected Recitation modes. A grade applies only to the scheduled ayah. The current target, preceding ayat, and ayat already completed during review remain fully visible for Quran context, while future unreviewed ayat stay muted. Mudhakkir sessions and API responses no longer store or return a display mode or fetch separate adjacent-ayah context. Legacy review-mode URL parameters are redirected to the canonical `?review=surah:ayah` form.

Mudhakkir initially shows Reveal instead of the recall grades. Selecting Reveal displays the scheduled āyah or Study passage and then exposes Again, Hard, Good, and Easy. Saving a grade and selecting the next persisted review unit happen in one API request, so the interface advances as soon as the transaction commits instead of waiting on a second queue request or an artificial display delay. The footer's Undo action reverses the most recent single-āyah grade atomically, restoring the prior FSRS state, review event, session counters, and queue item even after the next āyah has loaded. Every āyah that precedes the current Mudhakkir target on its Mushaf page is always revealed so the passage remains in Quran order. Āyāt already graded during the current day's review work also remain revealed whenever they are visible on a later Mudhakkir page, even if Start Review created a replacement session; unreviewed āyāt after the current target and Again-retry answers remain concealed until their turn is completed. The active session, current attempt, review history, and revealed-review list are restored from authenticated server data after navigation, reload, or switching devices; memorization state is never managed in browser storage. The icon-only Skip action remains available before and after Reveal and advances immediately without revealing, grading, or permanently revealing the answer.

Scheduling uses FSRS 6 with its 21-parameter model and trainable forgetting-curve decay. The per-user, per-ayah card stores FSRS state, stability, difficulty, scheduled interval, learning-step position, review and lapse counts, the latest grade, and last and next review times. Recall attempts are appended to a separate history table for statistics and parameter optimization; moving an ayah to Later, Easy, or Paused never deletes those events.

Changing Target Memory Goal bulk-reschedules every initialized Learning, Hard, Good, and automatic-recovery card from its existing stability and last review time. The update changes stored review dates and Due now immediately without fabricating grades or review-history entries. Easy, Paused, Later, and ungraded new Learning cards are not rewritten.

Google Analytics records privacy-safe Quran memorization events without account identifiers: `quran_review_session_start`, `quran_review_session_resume`, `quran_review_item_presented`, and `quran_review_grade` measure review participation and Mushaf pages reviewed. `quran_memorization_enroll` records successful first-time enrollment conversions with an `enrollment_scope` of `ayah`, `page`, or `surah` and the number of newly enrolled āyāt. Mark `quran_memorization_enroll` as a key event in Google Analytics to report it as a conversion.

The `quran_script_default` event and `quran_script_default` user property measure unique users by their resolved Quran script preference: `uthmani`, `indo-pak`, or `warsh`. The event is emitted once per page for the resolved default and again only when the preference changes on that page; no account identifier is included.

This is an initial ayah-level FSRS deployment, not an upgrade from an earlier ayah scheduler. Initialize the tables and replace every existing user's Quran memorization settings with the canonical FSRS 6 defaults by running `npm run init:quran-fsrs6`. The initializer preserves unrelated user settings. Use `npm run init:quran-fsrs6 -- --dry-run` to preview how many user rows will be updated without creating tables or writing settings.

The memorization tables use case-sensitive ASCII user identifiers and composite indexes for exact ayah lookup, due-review selection, recently reviewed ayat, active sessions, and persisted session queues. Existing installations can preview and apply the schema optimization with:

```sh
npm run quran-memorization-optimize
npm run quran-memorization-optimize -- --apply
```

### Interactive Arabic and ayah tools

* Hovering over a word highlights it using the same interaction language in Passage and Mushaf views.
* Clicking a Quran word reveals corpus information and its word-level translation. In the standard Mushaf it also toggles selection of the complete ayah; Practice mode instead performs its temporary reveal without translations.
* Selected and audio-playing ayat use a full-ayah highlight and the established Quran passage colors rather than disconnected word boxes.
* Clicking elsewhere clears the selected ayah.
* Ayah markers offer the same compact **View** and **Play** actions in Passage and Mushaf modes. View opens the focused ayah; Play begins recitation from that marker.
* Clicking an ayah, word, or marker displays its selected translation in the footer marquee, even when audio is not playing.
* Juz starts are marked with `۞`, and Quran metadata such as sajdah markers can be rendered alongside the standard ayah marker.

### Continuous, passage-aware audio

* Recitation uses continuous surah recordings with ayah timing segments, avoiding the audible breaks caused by stitching together separate per-ayah files.
* Playback continues across lazy-loaded Mushaf pages and passage boundaries while the current ayah remains highlighted.
* Audio begins at the selected ayah; without a selection it begins at the top of the current page or passage.
* Repeat is a true toggle. It repeats the current h3 subsection, falling back to its h2 passage, even when that range crosses a page boundary.
* The active reciter can be changed during playback. Available reciters are alphabetized, can be enabled or disabled in My Settings, and the preferred reciter is remembered.
* The sticky audio footer provides previous, repeat, play/pause, stop, speed, and next controls in one non-wrapping row.
* Playback speeds are **x1, x1.25, x1.5, x2.0, x2.5, and x3**. The selected rate is retained for the browser session and reapplied after stop, resume, source changes, and page transitions.
* A translation marquee appears above the sticky footer during playback. It identifies the reciter and translation once, uses unobtrusive superscript ayah references, honors LTR and RTL translations, and streams consecutive translations separated by a spaced dot—starting each entry from the center as its audio segment begins.

### Translations, tafsīr, and study

* Change the active translation directly from Passage or Mushaf controls.
* Show or hide Arabic and translation text independently on passage pages.
* Open available translations, bilingual tafsīr, Arabic tafsīr, and English tafsīr for an ayah without leaving the reading workflow.
* Tafsīr tabs, translation disclosures, footnote popups, hover explanations, and side-by-side Arabic/English layouts support both quick reading and deeper study.
* My Settings controls the preferred translation and reciter, enabled translations, tafsīrs and reciters, and the display order of translation and tafsīr works.
* Translation choices are synchronized across passage text, the ayah hero, Mushaf controls, share cards, and the audio/selection marquee.

### Navigation, saving, and sharing

* Infinite Passage and Mushaf readers update their canonical reading context as the user scrolls.
* The compact sticky footer provides back, Quran home, text controls, and context-aware previous/next navigation; in Mushaf mode those links move by page.
* A single Mushaf page bookmark is maintained at a time, appears on the Bookmarks page, and determines the default `/quran/page` destination.
* Quran passages and ayat support bookmarks, likes, comments, reflections, and shareable image cards with selectable translations.
* Keyboard navigation and accessible labels complement touch, mouse, and mobile controls.

### Search, downloads, and integration

* Unified search covers Arabic and translated Quran text, translations, and tafsīr, with autocomplete, filters, highlighting, and direct verse navigation.
* Quran content is addressable through stable ayah, range, passage, subsection, juz, manzil, translation, tafsīr, and Mushaf-page URLs.
* Machine-readable JSON and Markdown responses support individual ayat and ranges, while translation and Quran downloads are available in JSON or EPUB where provided.
* Quran passages, commentary pages, translations, and all Mushaf pages are included in the sitemap.

### Editorial and performance support

* Passage and subsection ranges can be edited and reindexed while maintaining their Passage-to-Mushaf mapping.
* Heading, range, and title changes invalidate the related Passage and Mushaf caches so stale section references are not retained.
* Mushaf page data and section mappings use in-memory and search caches where appropriate, with disk-cache versioning and explicit flush support for updated content.

## Quran Reciters

The site includes the continuous, ayah-synchronized recitations listed below. Each one has a short alias used internally for audio selection and saved preferences.

| Alias | Reciter |
|---|---|
| `abbad` | Fares Abbad |
| `alili` | Aziz Alili |
| `banna` | Mahmoud Ali al-Banna |
| `dusari` | Yasir al-Dusari |
| `husari` | Mahmud Khalil al-Husari |
| `jalil` | Khalid al-Jalil |
| `juhani` | Abdullah Awwad al-Juhani |
| `minshawi` | Muhammed Siddiq al-Minshawi |
| `qatami` | Nasser al-Qatami |
| `shuraym` | Saud al-Shuraym |
| `sudays` | Abd al-Rahman al-Sudays |
| `yasin` | Sahl Yasin |

## Quran Commentaries and Translations

The site includes the commentary (tafsīr) and translation works listed below. Each one has a short alias used in links and an English title.

### Bilingual tafsīr

| Alias | Name |
|---|---|
| `ibn-kathir` | Tafsir al-Quran al-Azim |
| `jalalayn` | Tafsir al-Jalalayn |
| `mokhtasar` | al-Mukhtasar fi Tafsir al-Quran al-Karim |
| `muntakhab` | al-Muntakhab fi Tafsir al-Quran |

### Arabic tafsīr and Quran companions

| Alias | Name |
|---|---|
| `tabari` | Jami al-Bayan an Tawil Ay al-Quran |
| `samarqandi` | Bahr al-Ulum |
| `abu-zamanayn` | Tafsir al-Quran al-Aziz |
| `makki` | al-Hidayah ila Bulugh al-Nihayah |
| `mawardi` | al-Nukat wa-al-Uyun |
| `samaani` | Tafsir al-Quran |
| `baghawi` | Maalim al-Tanzil fi Tafsir al-Quran |
| `zamakhshari` | al-Kashshaf an Haqaiq Ghawamid al-Tanzil |
| `ibn-al-jawzi` | Zad al-Masir fi Ilm al-Tafsir |
| `razi` | Mafatih al-Ghayb |
| `qurtubi` | al-Jami li-Ahkam al-Quran wa-al-Mubayyin |
| `baydawi` | Anwar al-Tanzil wa-Asrar al-Tawil |
| `nasafi` | Madarik al-Tanzil wa-Haqaiq al-Tawil |
| `ibn-juzay` | al-Tashil li-Ulum al-Tanzil |
| `abu-hayyan` | al-Bahr al-Muhit |
| `thalabi` | al-Kashf wa-al-Bayan an Tafsir al-Quran |
| `ibn-adil` | al-Lubab fi Ulum al-Kitab |
| `biqaii` | Nazm al-Durar fi Tanasub al-Ayat wa-al-Suwar |
| `iji` | Jami al-Bayan fi Tafsir al-Quran |
| `suyuti-t` | al-Durr al-Manthur fi al-Tafsir bi-al-Mathur |
| `shawkani` | Fath al-Qadir |
| `alusi` | Ruh al-Maani |
| `qinnawji` | Fath al-Bayan fi Maqasid al-Quran |
| `qasimi` | Mahasin al-Tawil |
| `irab-al-quran` | al-Jadwal fi Irab al-Quran wa-Sarfih wa-Bayanih |
| `saadi` | Taysir al-Karim al-Rahman fi Tafsir Kalam al-Mannan |
| `ibn-ashur` | al-Tahrir wa-al-Tanwir |
| `shanqiti` | Adwa al-Bayan fi Idah al-Quran bi-al-Quran |
| `ibn-uthaymin` | Tafsir al-Quran al-Karim |
| `aysar` | Aysar al-Tafasir li-Kalam al-Ali al-Kabir |
| `muyassar` | al-Tafsir al-Muyassar |
| `ibn-atiyah` | al-Muharrar al-Wajiz |
| `basit` | al-Tafsir al-Basit |
| `tadabbur-wa-amal` | al-Quran: Tadabbur wa-Amal |
| `wajiz` | al-Tafsir al-Wajiz |
| `mathur` | Mawsuat al-Tafsir al-Mathur |
| `qiraat` | al-Jadwal fi Qira'at al-Quran wa-Tawjihatih |
| `irab-daas` | Irab al-Quran al-Karim wa-Bayanuh |
| `shawi` | Nafahat min Tafsir al-Quran al-Karim |
| `yasir` | al-Yasir fi Tafsir al-Quran |
| `khadiri` | al-Siraj fi Bayan Gharib al-Quran |
| `wasit` | al-Tafsir al-Wasit li-al-Quran al-Karim |

### English translations

| Alias | Name |
|---|---|
| `en-khattab` | The Clear Quran |
| `en-saheeh-intl` | The Holy Qur'an (Saheeh International) |
| `en-hilali-khan` | Interpretation of the Meanings of the Noble Qur'an |
| `en-bridges` | Bridges' Translation of the Ten Qira'at of the Noble Qur'an |
| `en-taqi-usmani` | The Meanings of the Noble Qur'an with Explanatory Notes |
| `en-itani` | Quran in English: Clear and Easy to Read |
| `en-bewley` | The Noble Qur'an: A New Rendering of Its Meaning in English |
| `en-study-quran` | The Study Quran: A New Translation and Commentary |
| `en-ghali` | Towards Understanding the Ever-glorious Qur'an |
| `en-ahmedraza` | The Holy Quran |
| `en-wahiduddin` | The Quran: Translation and Commentary with Parallel Arabic Text |
| `en-qaribullah` | The Holy Qur'an |
| `en-busool` | The Wise Qur'an: These Are the Verses of the Wise Book |
| `en-tahir-ul-qadri` | Irfan-ul-Quran |
| `en-rowwad` | Explanation of the Meanings of the Noble Quran |
| `en-asad` | The Message of the Qur'an |
| `en-sarwar` | The Holy Qur'an: The Arabic Text and English Translation |
| `en-daryabadi` | Tafseer-e-Majidi |
| `en-shakir` | The Qur'an |
| `en-pickthall` | The Meaning of the Glorious Koran |
| `en-qarai` | The Qur'an with an English Paraphrase |

### English tafsīr

| Alias | Name |
|---|---|
| `en-maududi` | Tafhim al-Quran |
| `en-maarif-al-quran` | Maarif al-Quran |
| `en-tazkir-al-quran` | Tadhkir al-Quran |
| `en-easy-tajwid` | Easy Tajwid |

## Books and Collections

The catalog holds 23 books and collections in all: 20 source books and 3 themed collections drawn from them. The source books together hold 203,840 records, and the collections link to another 4,755.

In the table below, **Records** is the number of entries in each work, **English** is how many of those have an English translation, and **Graded** is how many carry an authenticity grading. The counts were last updated on 2026-04-26.

| ID | Alias | Name | Type | Records | English | Graded | Graders |
|---:|---|---|---|---:|---:|---:|---|
| 0 | `quran` | The Holy Quran | Source | 6,236 | 6,236 | 0 | N/A |
| 57 | `ibnrajab50` | Jāmiʿ al-ʿUlūm wa-al-Ḥikam | Virtual | 93 | N/A | N/A | N/A |
| 61 | `riyad` | Riyāḍ al-Ṣāliḥīn min Kalām Sayyid al-Mursalīn | Virtual | 2,755 | N/A | N/A | N/A |
| 15 | `adab` | al-Adab al-Mufrad | Source | 1,326 | 1,326 | 1,326 | Albānī, Arnaʾūṭ |
| 50 | `lulu-marjan` | al-Luʾluʾ wa-al-Marjān (Muttafaq ʿAlayh) | Virtual | 1,907 | N/A | N/A | N/A |
| 1 | `bukhari` | Ṣaḥīḥ al-Bukhārī | Source | 7,277 | 7,277 | 7,276 | Bukhārī, Luʿluʿ wa-al-Marjān |
| 2 | `muslim` | Ṣaḥīḥ Muslim | Source | 7,469 | 7,469 | 7,469 | Muslim |
| 4 | `abudawud` | Sunan Abū Dāwūd | Source | 5,276 | 5,276 | 4,897 | Albānī, Arnaʾūṭ |
| 5 | `tirmidhi` | Jamiʿ al-Tirmidhī | Source | 4,052 | 4,052 | 3,908 | Albānī, Arnaʾūṭ, Tirmidhī, ʿAli Zaʾī |
| 3 | `nasai` | Sunan al-Nasāʾī | Source | 5,769 | 5,769 | 5,460 | Albānī, Arnaʾūṭ, Ḥākim, Nasāʿī, ʿAli Zaʾī |
| 6 | `ibnmajah` | Sunan Ibn Mājah | Source | 4,345 | 4,345 | 4,184 | Albānī, Arnaʾūṭ, ʿAli Zaʾī |
| 9 | `darimi` | Sunan al-Dārimī | Source | 3,547 | 3,546 | 3,199 | Dārānī, Ibn Ḥibbān, Ibn Mājah |
| 8 | `ahmad` | Musnad Aḥmad | Source | 27,735 | 27,668 | 27,734 | Arnaʾūṭ, ʿAli Zaʾī |
| 7 | `malik` | Muwaṭṭaʾ Mālik | Source | 1,975 | 1,975 | 1,975 | Mālik |
| 10 | `hakim` | Mustadrak al-Ḥākim | Source | 8,809 | 8,788 | 8,809 | Aḥmad, Dhahabī, Ḥākim, Haythamī, Ibn Ḥibbān |
| 11 | `ibnhibban` | Ṣaḥīḥ Ibn Ḥibbān | Source | 7,539 | 7,496 | 6,723 | Arnaʾūṭ |
| 16 | `bazzar` | Musnad al-Bazzār | Source | 9,030 | 22 | 0 | N/A |
| 17 | `ibnkhuzaymah` | Ṣaḥīḥ Ibn Khuzaymah | Source | 2,414 | 1 | 0 | N/A |
| 12 | `tabarani` | al-Muʿjam al-Kabīr, Ṭabarānī | Source | 21,373 | 21,264 | 19 | Aḥmad, Albānī, Arnaʾūṭ, Haythamī, Muslim |
| 13 | `nasai-kubra` | al-Sunan al-Kubrá, Nasāʾī | Source | 11,446 | 11,414 | 4 | Arnaʾūṭ, Nasāʿī, Tirmidhī, ʿAli Zaʾī |
| 14 | `bayhaqi` | al-Sunan al-Kabīr, Bayhaqī | Source | 19,953 | 19,850 | 5 | Bayhaqī, Bukhārī, Muslim |
| 82 | `ahmad-zuhd` | al-Zuhd, Aḥmad | Source | 2,360 | 2,355 | 0 | N/A |
| 1000 | `suyuti` | Jamʿ al-Jawāmiʿ, Suyūṭī | Source | 45,909 | 1,397 | 61 | Albānī, Arnaʾūṭ, Bayhaqī, Bukhārī, Dhahabī, Ḥākim, Haythamī, Ibn al-Jawzī, Ibn Ḥajar, Luʿluʿ wa-al-Marjān, Mudhiri, Muslim, Nawawī, Suyūṭī, Tirmidhī |
