# Quran recitation and audio ranges

Recitation controls attach playback to an ayah or selection in Study, Mushaf and Practice.

## Using the feature

| Function | What the reader sees and does | How it works |
| --- | --- | --- |
| Choose recitation | A compact audio control opens playback options. Reciter preferences also appear in Reading & listening in Settings. | The recitations endpoint supplies available reciters. A passage request resolves the requested reciter and Quran range into playable audio with timing data. |
| Play a range | The range dialog sets the start and end of the reading. The active ayah follows playback. In facing-page view one set of controls serves both leaves. | The player associates the playback position in a surah recording with ayah segments. Crossing a page boundary can advance the Mushaf while keeping the same recitation. |
| Listen on mobile | The native app exposes an audio control beside the selected ayah or recall prompt. | The app caches the shared surah file and complete timing manifest for each reciter/surah combination. A second ayah from the same recording can reuse that stored file. |

## Following a request

To hear an ayah from a two-page spread, select it on either leaf and use Play. If the wrong ayah is active, distinguish the selected reference, the reciter’s segment timings and the currently displayed page. They are managed by separate parts of the playback flow.

## Earlier desktop and phone captures

These links open the archived route atlas. The URL identifies the original capture, including any redirect or gated state it encountered.

| Screen | Requested URL | Desktop | Phone |
| --- | --- | --- |
| Reciter picker | `/quran/2/1` | [Wide](../../design-system/screens/audio-wide.jpg) | [Narrow](../../design-system/screens/audio-small.jpg) |

## Implementation and related reading

- Inline controls. [views/sub-views/quran_audio_control.ejs](../../../views/sub-views/quran_audio_control.ejs)
- Range selection. [views/sub-views/quran_audio_range_modal.ejs](../../../views/sub-views/quran_audio_range_modal.ejs)
- Recitation catalog and passage responses. [routes/proxy.js](../../../routes/proxy.js)
- Recording and timing resolution. [lib/QuranRecitations.js](../../../lib/QuranRecitations.js)
- Native playback cache. Local workspace file `apps/quran-review/src/recitationCache.ts`.

[All features](../README.md)
