---
name: hadithdb-ux-audit
description: Audit HadithDB pages during the UX makeover, compare repeated controls across rendered states, and carry finalized patterns into the component library. Use for page makeovers, component consistency reviews, and design-system adoption.
---

# HadithDB UX audit

Start with the current page and the [component library](../../docs/design-system/library.html). The [audit atlas](../../docs/design-system/index.html) helps locate equivalents across routes. The library records accepted designs. After selection, fold the chosen treatment into its existing entry, refresh affected specimens, and retire the comparison files and styles after checking their consumers. Keep original audit captures available for before-and-after review.

Use standard URLs on ux-makeover. Compare the same routes on master for the classic baseline. Switch collections, reload, verify return links, and check route-specific assets and cached HTML.

## Inspect two ways

1. **Walk the page by task.** Inventory the panels, controls and routes that share the view. Read the template and client renderers to find elements that appear after loading, signing in, connecting an account, opening a nested disclosure, changing view, or enabling a feature. Map these to the states the user can actually reach. Use local fixtures for account writes and gated services. Record any state you could only inspect in source.
2. **Walk across the page by control family.** Open comparable surfaces with the same viewport, theme, data and interaction state. Put the rendered controls side by side. Include panel headers and toolbars, fields and unit suffixes, switches and favorites, links and buttons, cards and rows, disclosure indicators, and inline feedback wherever present. For a new page, look for additional families specific to its tasks.

Check desktop and phone. Look at hierarchy, wrapping, alignment, typography, spacing, and affordances in context. Use the DOM to resolve differences that a screenshot can hide: bounding boxes for height and alignment, computed colors for checked and focused states, and the accessible name, role and selected state. Inspect the winning CSS rule and its owner before changing it. Bootstrap layout utilities can implement an approved pattern; a familiar class name alone tells you little about the rendered experience.

## Turn a discrepancy into a decision

Track a short working record per family: **surfaces compared · states viewed · observed difference · intended shared pattern or reason to differ · verification**. Use scratch notes or screenshots during the audit. Report consequential differences and coverage gaps to the user.

Concrete Settings comparisons to carry forward:

- **Fields.** Compare a Review number input and its attached “minutes” suffix with a Billing select and threshold input. Measure rendered heights, check label baselines, and narrow the panel until the grid wraps. Test focus and disabled states.
- **Switches and actions.** Compare a checked catalog switch with connected Drive and auto-recharge switches. Check the track color, size and visible label. In Drive, exercise disconnected and connected states to reveal the primary Connect, secondary Import, and lightweight folder and disconnect actions.
- **Control-to-label spacing.** Measure from the painted control edge to the first line of label text in the rendered UI. Padding on a wrapper can be canceled by a floated input or negative margin. Compare a short label with a wrapping one at phone width and enlarged text. Check that continuation lines align with the first word, the switch stays beside the first line, and clicking the label still toggles it.
- **Round trips and feedback.** Enter a shared destination from each parent route, then use its visible Back link. Verify the originating panel is open and visible, including its Quran or beta variant. Where one page mixes explicit-save and immediate actions, verify each result appears beside the controls that triggered it.
- **Type hierarchy across routes.** Compare a catalog with the accepted reference page at identical desktop and phone widths. Measure computed type on global and local navigation, rail titles and links, page and group headings, item titles in each script, metadata and badges. When two roles should match, record both computed values at identical viewports and assert equality for family, size, weight and line height. For page titles, run `node skills/hadithdb-ux-audit/scripts/compare-titles.js /settings /books` against the local server. The check fails if any computed value differs. Inspect paired English and Arabic titles together, including diacritics and long names. Compare perceived size at normal reading distance. Put short and long bilingual names in adjacent cards at the same width. Check their row placement, Arabic alignment and whether a size indicator wraps onto a line by itself. Check whether static metadata looks clickable alongside real controls. Inspect the rendered page for headings that read like ordinary rows even when their tap targets are large.
- **Overlay dismissal.** Compare the X on a drawer, a native dialog and a Bootstrap modal, including dynamically built overlays. At matching widths and themes, inspect the glyph, target, focus ring and hover surface. Activate the X and verify focus returns to the opener. Run `node skills/hadithdb-ux-audit/scripts/compare-overlay-close.js` against local Books beta.
- **Spacing inside compound controls.** Measure both inner edges in the rendered control, from its boundary to the leading icon and trailing accessory. Compare those distances with the intended insets at the breakpoint and at a wider viewport. Check the winning CSS when dimensions differ. For the beta header, run `node skills/hadithdb-ux-audit/scripts/check-search-insets.js` against the local app.
- **Shared navigation.** On routes with a fixed header, measure how much of the first phone viewport remains for content. Open a later collection directly and check that its active tab is visible. Measure immediately below and above each breakpoint, then repeat after scrolling. Check icon hit areas, drawer focus and Escape return, including overlap with persistent bottom controls. Compare the footer height, surface and type scale with the last content section on desktop and phone. At the end of the list, activate footer links above the bottom controls.
- **Right rails.** Compare the rail’s left edge, width and sticky offset below the header across routes. Resize through the desktop breakpoint with a filter active and confirm the same controls and results remain available.
- **Toolbars.** Open Reciters, Translations, and Tafsir together. Compare the location of the count or description, Enable all, and the Tile / Full selector where present. Check the alignment again when the rail moves above the content and when all entries are enabled.

Trace the CSS hierarchy from foundation token to component to route layout. Search for existing rules and all consuming templates before adding a selector. Consolidate competing definitions at their owner, scope route-specific layout locally, and check the winning declarations in the browser on each affected surface. Verify that versioned stylesheets pick up the change.

Reuse the accepted component or shared CSS owner when the tasks match. Preserve distinctions such as immediate versus explicit save, Quran script typography, and semantic links versus buttons. For a proposed visual direction, record it as a candidate until selected. When a pattern is finalized, add its real specimen, states, implementation hook and consumers to the library, or extend its existing entry.

## Verify and maintain

Revisit the same surfaces and states after edits. Check keyboard operation, focus, and the affected behavior (for example reload persistence, rollback, or return navigation). Record visual comparisons separately from functional tests. A passing save test cannot establish that two fields align.

At the end of each makeover page, and whenever the user identifies a miss, review this skill. If the work exposed a reusable blind spot, add the smallest comparison that would have caught it and how to verify it. Merge overlapping guidance. Keep design values and component specimens in the library, and keep audit methods here. Make warranted updates on the makeover branch alongside the page change.
