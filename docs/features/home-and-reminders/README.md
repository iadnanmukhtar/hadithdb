# Home shelves and daily reminders

Both homepages combine a small curated library with a search across works. The Quran homepage also provides a contents navigator.

## Using the feature

| Function | What the reader sees and does | How it works |
| --- | --- | --- |
| Choose a shelf | Beginner Books and Twelve Books show bilingual covers with the selected book centered. Other lists the remaining titles. Quran starts with Translations, then English Tafsirs and Other. | Initial HTML includes the selection and neighboring covers. Arrows, swipes and adjacent covers change selection. Activating the centered cover opens its contents. |
| Find a book | Search books replaces the shelf with matching titles or authors. Clearing it brings back the selected tab and cover. | Filtering searches the full directory across tabs. On the Quran homepage the Juz, Surahs and Manzils filter has its own query and results. |
| Read a reminder | Below the books, the reminder offers Another reminder and a source link. The separate Sunnah of the Day dialog shows a bilingual excerpt and linked reference. | The daily selector draws from eligible bilingual readings in Mujtaba, Al-Adhkar and ʿAmal al-Yawm wa-l-Laylah. The default changes at midnight on fixed UTC−05:00. A manual choice survives a reload on the same day. |
| Dismiss or revisit | Close or Escape minimizes the daily dialog into the menu and returns focus there. Readers can reopen it without leaving the page. | The client tracks automatic opening per browser session, checks the date on resume, and refreshes an open dialog when the reading day changes. |
| Discover articles | Community articles below the books lead into published reading pages. | HomeArticles supplies the recommendations to the homepage rail independently of shelf selection. |

## Following a request

On a narrow screen the title, main action, tabs and full-width search field precede the books. A title search may lead outside the currently highlighted set. After clearing it, selecting a neighboring cover centers it first, so tapping a visible book and opening it can be two distinct actions.

## Earlier desktop and phone captures

These links open the archived route atlas. The URL identifies the original capture, including any redirect or gated state it encountered.

| Screen | Requested URL | Desktop | Phone |
| --- | --- | --- |
| Hadith home | `/` | [Wide](../../design-system/screens/home-wide.jpg) | [Narrow](../../design-system/screens/home-small.jpg) |
| Quran home | `/quran` | [Wide](../../design-system/screens/quran-wide.jpg) | [Narrow](../../design-system/screens/quran-small.jpg) |

## Implementation and related reading

- Hadith homepage composition. [views/index.ejs](../../../views/index.ejs)
- Quran homepage and contents. [views/toc.ejs](../../../views/toc.ejs)
- Shelf selection and filtering. [public/static/js/home-library.js](../../../public/static/js/home-library.js)
- Candidate selection and reading day. [lib/SunnahReminder.js](../../../lib/SunnahReminder.js)
- Dialog, session and rollover handling. [public/static/js/sunnah-reminder.js](../../../public/static/js/sunnah-reminder.js)
- Article rail data. [lib/HomeArticles.js](../../../lib/HomeArticles.js)

Related guides · [Book catalogs and metadata](../book-catalog/README.md) · [Quran Study, contents and word exploration](../quran-study/README.md)

[All features](../README.md)
