# Practice, Mudhakkir review and progress

Practice hides or reveals text on the Mushaf. Mudhakkir schedules recall and records grades against individual ayat.

## Using the feature

| Function | What the reader sees and does | How it works |
| --- | --- | --- |
| Practice a page | Word taps, hide/reveal one ayah, show all words and clicked-word auto-hide controls change the visible text. The marker menu can reveal, hide or play a whole ayah. | Page concealment is a practice interaction. Enrolling an untouched ayah uses a separate self-assessment of Learn, Hard, Good or Easy, individually or by group. |
| Check recitation | When enabled, Check recitation on the web Practice page accepts microphone input for the selected page. | The transcription API passes audio and page context to the configured recitation feedback service. Availability depends on that service and browser recording support. |
| Start daily review | The dashboard offers Start or Continue, progress and on-demand help. The recall view prompts before revealing the answer and grading controls. | The regular session selects learning and due ayat subject to configured limits. Later, Easy and Paused stay outside the regular queue. Upcoming active ayat may enter when nothing is due. |
| Grade, skip or undo | After recall the reader reveals the ayah and grades it. Skip moves on. Undo returns to the preceding grade. | FSRS uses grade and elapsed time to update scheduling. Skip preserves stage and schedule. Undo restores the prior review date and state. The preceding printed page’s final line supplies context. |
| Run a custom review | Launch from a passage, page or surah. Choose ayah-by-ayah or passage-by-passage and whether to stop at the selected boundary. | Custom review follows Quran order. Untouched ayat enroll when reached. A single passage grade is applied to each ayah so their schedules remain individual. |
| Manage progress | Progress groups ayat, shows current and paused sessions, and allows switching, pausing or ending review. | Switching pauses the current session. Ending keeps completed reviews. The server owns sessions, grades and next-item selection across devices. The help view remains available before sign-in. |

## What the grade changes

| Action after recall | Effect on this ayah |
| --- | --- |
| Again | Brings the ayah back sooner. A Good ayah enters Hard recovery and may recur near the end of the session. |
| Hard | Records independent but hesitant recall. Learning or Hard can stay in that stage with a shorter interval. |
| Good | Records recall with ordinary effort. Two consecutive Good reviews can promote Learning or Hard to Good once calculated difficulty is at most 6. |
| Easy | Records fluent recall. One Easy can promote Learning or Hard to Good at the same difficulty threshold. The Easy learning *state* has a separate meaning and normally stays out of scheduled review. |
| Skip | Advances within the session without changing the stage or due date. |
| Undo | Restores the last graded item and its prior schedule so the reader can correct the assessment. |

Changing **Target Memory Goal** can recalculate dates for active, initialized ayat. Changing **Initial Memory Strength** affects newly assessed ayat. This distinction explains why one settings change can alter today’s due count immediately while another only affects future enrollment.

## Following a request

A reader can reveal every word in Practice without submitting a recall grade. To schedule an ayah, assess it once, then review it from the dashboard. Learning and fragile ayat can move to Good after an Easy or repeated Good reviews when calculated difficulty permits. Again on Good starts recovery.

## Earlier desktop and phone captures

These links open the archived route atlas. The URL identifies the original capture, including any redirect or gated state it encountered.

| Screen | Requested URL | Desktop | Phone |
| --- | --- | --- |
| Mushaf practice onboarding | `/quran/page/42?memorize` | [Wide](../../design-system/screens/memorize-wide.jpg) | [Narrow](../../design-system/screens/memorize-small.jpg) |
| Mudhakkir landing | `/quran/review` | [Wide](../../design-system/screens/review-wide.jpg) | [Narrow](../../design-system/screens/review-small.jpg) |
| Mudhakkir help | `/quran/review?help` | [Wide](../../design-system/screens/help-wide.jpg) | [Narrow](../../design-system/screens/help-small.jpg) |
| Recall entry · signed out | `/quran/review?start` | [Wide](../../design-system/screens/recall-wide.jpg) | [Narrow](../../design-system/screens/recall-small.jpg) |

## Implementation and related reading

- User-facing stages, grade rules and session types. [views/sub-views/quran_memorization_help_content.ejs](../../../views/sub-views/quran_memorization_help_content.ejs)
- Dashboard, progress and help. [views/quran_memorization_pages.ejs](../../../views/quran_memorization_pages.ejs)
- Recall experience. [views/quran_review.ejs](../../../views/quran_review.ejs)
- Session, state, grade, undo, progress and transcription APIs. [routes/quranMemorization.js](../../../routes/quranMemorization.js)
- Persistence and scheduling. [lib/QuranAyahMemorization.js](../../../lib/QuranAyahMemorization.js)
- FSRS calculations. [lib/QuranFsrs.js](../../../lib/QuranFsrs.js)
- Web transcription service. [services/quran-asr/README.md](../../../services/quran-asr/README.md)

Related guides · [Account, sign-in and preferences](../accounts-settings/README.md) · [Mudhakkir native app](../native-mudhakkir/README.md)

[All features](../README.md)
