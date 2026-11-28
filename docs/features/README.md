# HadithDB feature handbook

Choose the task you want to understand. Each guide pairs the visible controls with their routing, data sources, state changes and access conditions. The implementation references point into the same checkout as this handbook.

## Finding and reading sources

- [Site navigation and public pages](site-navigation/README.md) — Start here for the masthead, route-specific navigation, installation and recovery screens shared across the library.
- [Home shelves and daily reminders](home-and-reminders/README.md) — Both homepages combine a small curated library with a search across works. The Quran homepage also provides a contents navigator.
- [Book catalogs and metadata](book-catalog/README.md) — Use /books to choose a work across Hadith, History and Sirah, Sharḥ, translations, tafsir and Mushaf editions.
- [Global search and results](search/README.md) — Search the library from the masthead or open a results URL with a query. The selected scope determines the suggestions and destination.
- [Hadith contents, reading and source detail](hadith-reader/README.md) — A book hierarchy and a numbered report are separate ways to reach a narration. The section preserves reading order. The individual report exposes its source evidence.
- [Sharḥ collections and explanations](sharh/README.md) — Sharḥ readers connect a commentary work to the headings and narrations it explains.
- [History and Sirah](sirah-history/README.md) — Historical works share the library’s bilingual navigation while presenting source passages as individually addressable reading items.

## Quran reading and memorization

- [Quran Study, contents and word exploration](quran-study/README.md) — Study follows an ayah, a range or an editorial passage. A printed page, an authored commentary entry and a Study section each group ayat differently.
- [Mushaf pages and facing-page reading](mushaf/README.md) — The Mushaf uses the printed page as the navigation unit. Selecting a word or ayah adds context while keeping the page layout intact.
- [Quran translation library and comparison](quran-translations/README.md) — Read one translator continuously in Study or compare available translations for a single ayah.
- [Tafsir library and passage reading](tafsir/README.md) — A tafsir passage is an entry in a named work. Its author may explain one ayah or several together.
- [Quran recitation and audio ranges](quran-audio/README.md) — Recitation controls attach playback to an ayah or selection in Study, Mushaf and Practice.
- [Practice, Mudhakkir review and progress](memorization/README.md) — Practice hides or reveals text on the Mushaf. Mudhakkir schedules recall and records grades against individual ayat.
- [Mudhakkir native app](native-mudhakkir/README.md) — The Expo app brings printed pages, Practice, recall and normalized Quran search to phones and tablets. On Apple-silicon Macs it runs in iPad compatibility mode.

## Personal tools and Community

- [Bookmarks and saved reading positions](bookmarks/README.md) — Bookmarks brings saved narrations, ayat, headings, commentary, content items and the Mushaf reading position into one personal list.
- [Notebook, editing, sharing and export](notebook/README.md) — My Notebook holds private Markdown notes and source-linked annotations. Readers can open the same material from a library item, a note link or the notebook navigator.
- [Community feeds, profiles and interactions](community/README.md) — Community gathers published writing and activity into Everyone, Following and personal views. Visibility depends on both the source and the viewer.
- [Community writing, articles and blog](publishing/README.md) — Authors can write a short post or a longer article, preview it and publish a version for others to read. The blog also exposes public article archives and feeds.
- [Reader reflections and replies](reflections/README.md) — A reflection attaches a discussion to a specific library item or article. The widget can appear inside a reading page or an ayah dialog.
- [Account, sign-in and preferences](accounts-settings/README.md) — Both Settings routes group reading, memorization, storage and account preferences into expandable rows.
- [Email subscriptions and in-app alerts](notifications/README.md) — Readers manage email delivery by category and author. In-app alerts have their own unread state.

## Services and administration

- [Points, billing and on-demand translation](billing-and-translation/README.md) — When enabled, a reader can request translation of a supported content item and manage the points used by the service.
- [Administration and inline editing](editorial-admin/README.md) — Administrators maintain shared source identities in manager dialogs and edit individual fields where readers encounter them.
- [AI research tools and MCP](mcp/README.md) — The public MCP overview explains how an assistant can search the library and retrieve identifiable evidence. The protocol endpoint is also usable without a browser page.

## Cross-feature workflows

- [Sharing, image cards and printing](sharing-and-printing/README.md) — Readers can share a canonical link, prepare a bilingual image or text excerpt, and print a selected reading range.
- [Formatted writing and bilingual typography](formatted-content/README.md) — Hadith, Sharḥ, tafsir, Community and Notebook render authored text across reading pages, previews, dialogs and exports.
- [Quran edition downloads and reader updates](quran-editions/README.md) — Public Quran readers install versioned content in the browser so repeated Study and Mushaf navigation can reuse the same book files.
- [ActivityPub federation](federation/README.md) — When federation is enabled, a public Community profile can display an address that readers follow from another ActivityPub server.

## Reading the visual evidence

The descriptions follow the routes, templates and client code on master at `f2ba6134`. Linked desktop and phone atlas captures document earlier versions. Some show an access prompt, a redirect or an older error state. Component crops illustrate a particular control and can also predate later behavior. Native, privileged and external-service flows are described from source. No live account actions were performed for this handbook.

The design library records the status of individual treatments, including those still under review. Use it for current design decisions and the template inventory to trace shared renderers. [Design decisions](../design-system/library.html#makeover-status) · [Route atlas](../design-system/index.html) · [Template inventory](../design-system/template-inventory.md) · [Browser coverage](../design-system/regression.md)
