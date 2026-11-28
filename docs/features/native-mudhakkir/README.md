# Mudhakkir native app

The Expo app brings printed pages, Practice, recall and normalized Quran search to phones and tablets. On Apple-silicon Macs it runs in iPad compatibility mode.

## Using the feature

| Function | What the reader sees and does | How it works |
| --- | --- | --- |
| Read and practice | The Mushaf screen presents a numbered printed page. Practice uses the same local layout and adds concealment. The reader can open web Study for the selected verse. | A bundled SQLite database holds the 604-page layout, words, meanings and normalized search index. Public Quran reading can use bundled content independently of the review server. |
| Search | A dedicated search screen lists matching Quran references that can be opened in the reader. | Search queries the bundled normalized index. It operates on the content version included with the app build. |
| Review | The card shows the reference and a recall prompt. Reveal replaces it with centered Arabic and meanings, followed by grade buttons. Skip and Undo sit below. | Google sign-in enables server review. The app submits the grade and elapsed time, obtains the next attempt, and keeps an undo token for the previous submission. |
| Listen | Audio and Study actions appear alongside the recall target. Playback can reuse downloaded recordings. | The app combines local text with server-managed reciter timing data. Recitation checking via microphone belongs to web Practice. Native audio supports playback. |

## Following a request

Opening a page offline exercises bundled text and any previously cached recording. Resuming a graded review additionally requires the authenticated memorization API. Shared reference, grade and session definitions keep native and web clients aligned.

## Implementation and related reading

- Supported platforms and content boundaries. Local workspace file `apps/quran-review/README.md`.
- Top-level navigation. Local workspace file `apps/quran-review/src/App.tsx`.
- Printed page and Practice controls. Local workspace file `apps/quran-review/src/MushafScreen.tsx`.
- Search UI. Local workspace file `apps/quran-review/src/SearchScreen.tsx`.
- Prompt, reveal, grade and undo. Local workspace file `apps/quran-review/src/ReviewScreen.tsx`.
- Shared review contracts. [packages/quran-review-core](../../../packages/quran-review-core)

Related guides · [Practice, Mudhakkir review and progress](../memorization/README.md) · [Quran recitation and audio ranges](../quran-audio/README.md)

[All features](../README.md)
