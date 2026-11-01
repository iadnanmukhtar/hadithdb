# Abu Amina Elias source download

Run from the HadithDB repository:

```sh
# Download all public articles using WordPress's content API (no login or model).
node bin/utils/download-abuamina-hadiths.js
# Rebuild extracted JSONL from saved pages, without network access.
node bin/utils/download-abuamina-hadiths.js --offline
# Optional read-only database comparison; no INSERT/UPDATE/DELETE operations.
node bin/utils/download-abuamina-hadiths.js --offline --plan-db
```

`--out DIR` changes the default `data/abuamina` directory. Raw pages, a manifest,
`hadiths.jsonl`, and summary are retained locally. The cache is excluded from git.
A new online run refreshes all pages; offline runs reuse the complete snapshot.
Pagination totals and unique IDs must agree before extraction succeeds.

Each article includes its exact title, source URL, translation block, Arabic,
references, attributed grade text, and paragraphs for inspection. These are
source articles, not necessarily 4,906 distinct canonical hadith records.
Translations and grades remain attributed to the source; commentary and
multi-report articles are not automatically proposed for enrichment.

The optional `enrichment-plan.json` matches supported exact book/number references
and substantial contiguous Arabic body text. Unsupported editions, ambiguous
matches, and duplicate article candidates are held for review. It skips the whole
record if either title exists or any of `lastfixed`, `lastmod_user`, Arabic revision
history, `temp_trans`, or `verified` indicates prior editing/revision. Existing
English and grade values are preserved. Grade text is review-only, not an inferred
canonical grade. This tool deliberately has no database apply mode.

Token use: **zero model tokens** for downloading, extraction, matching, and reports.
Use the summary and filtered candidates rather than sending raw HTML or the full
corpus to an LLM. Leave unresolved records unchanged; if later manual/model review
is desired, submit only individual unresolved pairs and cache the decisions.

The separate title-only writer rechecks the protections and Arabic match against
locked live rows, saves complete before-values and source provenance to
`title-update-audit.json`, then updates only missing `title_en` values. It leaves
translations and grades unchanged. The database trigger advances `lastmod`.
It refreshes and verifies all five English title fields in Elasticsearch, and
compares every other database field with the saved before-values.

```sh
node bin/utils/apply-abuamina-titles.js --apply
node bin/utils/apply-abuamina-titles.js --verify
```

An existing audit makes `--apply` verify the committed database changes and retry
search maintenance without repeating SQL updates. If database verification fails,
inspect the audit before retrying or starting another batch. This script does not
deploy code or flush web page caches.

Tests: `npx jest spec/abuamina-download.spec.js --runInBand`.

## Expanded read-only identification

```sh
node bin/utils/download-abuamina-hadiths.js --offline --identify-db
```

This saves `identification-report.json` and `identification-summary.json` separately
from the conservative `enrichment-plan.json`. It does not update the database or
feed expanded candidates into the title writer automatically.

To explicitly apply the confident, title-eligible matches:

```sh
node bin/utils/apply-abuamina-titles.js --apply --confident
node bin/utils/apply-abuamina-titles.js --verify --confident
```

This uses a separate `confident-title-update-audit.json`, retaining the original
44-record batch audit. Before writing, it locks the cited canonical-number peers,
rechecks Arabic identity, title/revision protections and duplicate source articles,
and records any now-ineligible matches as skipped. Other database fields are
checked before commit (allowing the automatic modification timestamp). Search
refresh and verification follow the same workflow as the original batch. Rerunning
the same batch resumes verification/indexing without repeating database writes.

The identifier resolves collection aliases through the live books catalog, adds
Nasai's Kubra, Bayhaqi, Bazzar, both Musannafs, Tabarani's Awsat/Saghir, Abu Yala,
Ahmad's Zuhd and Shuab al-Iman, and retains volume/page locators without treating
page numbers as hadith numbers. An unqualified `al-Sunan al-Kubra` remains
unsupported because it does not identify an author unambiguously.

Arabic normalization removes vocalization before expanded blessing phrases and
handles Unicode blessing ligatures. It compares the database body with the source
report without requiring narrator prefixes to be identical. A confirmed identity
requires the cited canonical number, the complete normalized database body (at
least 60 characters), at least 45% source coverage, and exactly one confirmed row.
Existing titles and revision markers affect title eligibility, not identification.
Multiple articles for a record and multiple source blocks remain held for review.

For unresolved reports, a three-word index searches the entire cited collection,
including alternate `numActual` numbering. Retrieval considers the top 20 scores
and all cutoff ties. Exact excerpt matches and substantial contiguous spans are
reported with canonical references, number agreement, matched text, coverage and
protection reasons; these are **review candidates**, not confirmed identities.
At most ten candidate details are displayed per article, with the total candidate
count retained. A different edition, excerpt, or wording variant is never silently
accepted because its wording resembles another narration. No cross-collection
substitution is performed. Unsupported sources remain explicitly unresolved.

Tests:
`npx jest spec/abuamina-download.spec.js spec/abuamina-identify.spec.js --runInBand`.

The identifier also ignores the reporting phrase `أَوْ كَمَا قَالَ`, including
unvocalized and differently vocalized forms, on either side of the comparison.
For these reports only, a complete body of at least eight words and 30 Arabic
characters may establish identity at the unique cited canonical number (with the
same 45% source coverage requirement). This covers Bukhari 4644; generic short
wording and other phrases retain the usual restrictions.

Additional approved batches can retain earlier audits with a named audit file:

```sh
node bin/utils/apply-abuamina-titles.js --apply --confident --batch=reporting-phrase
node bin/utils/apply-abuamina-titles.js --verify --confident --batch=reporting-phrase
```

The remaining-report pass parses parallel citations such as
`Sahih al-Bukhari 5997, Sahih Muslim 2318` as a primary citation plus preserved
additional references, and accepts a trailing citation comma. It also normalizes
`شىء` to `شيء`. Complete bodies with at least eight words and 30 Arabic characters
can now match a unique cited canonical number at 35% source coverage. Other short
bodies retain the 60-character confirmation requirement.

For differences in introductory narration formulas, the matcher may compare the
speech after an explicit Prophet attribution or a leading `كان يقول`/`يقول`/`قال`.
Full speech matches require at least 60 characters and 12 words; contained source
excerpts require at least 80 characters and 12 words. Both require at least 70%
coverage of the shorter/longer relevant speech comparison. Negations and other
substantive wording remain part of the exact comparison. Different numbering and
noncontiguous/fuzzy wording remain review-only.
