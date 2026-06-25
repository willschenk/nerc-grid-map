# Cursor research prompts (batch lookups)

Copy-paste prompts for running bulk research in Cursor, ~50 records at a time.
They are written for a **low-capability model**, so they are deliberately
mechanical: exact files, exact columns, exact output, and a short "do NOT" list.

**Key safety rule baked into every prompt:** Cursor only **appends rows to a
review CSV**. It never edits `org-names.json`, `geocoded-orgs.json`,
`map-combines.json`, or any renderer/source file. A human applies the verified
rows afterward. This keeps the build safe no matter what the model does.

How to use:
1. Pick a prompt below.
2. Replace `<START>` and `<END>` with a 50-row window (e.g. `1` and `50`, then
   `51` and `100` next time). The `order` column in the queue CSVs is the index.
3. Paste into Cursor. When it finishes, skim the output CSV and tell it the next
   window.

---

## Prompt 1 — Short map labels (`name_shortest`)

```
You are doing data-entry research. Work ONLY on the rows of
src/data/nerc/name-queue.csv whose "order" column is between <START> and <END>
inclusive. That is your batch. Do not touch any other row.

For EACH row in the batch, decide the best short map label ("shortest") for that
organization, then APPEND one line to a file named
src/data/nerc/_proposals/name-proposals.csv (create the file and a header row if
it does not exist).

Header row (write it once, exactly):
order,ncr_id,entity_name,current_shortest,proposed_shortest,changed,evidence_url,confidence,needs_review,note

RULES for choosing "proposed_shortest" (follow in this order, stop at the first
that applies):
1. If the row's "current_shortest" already follows the rules below, keep it
   (set proposed_shortest = current_shortest and changed = no).
2. Use an official acronym or official alias/code (from the company website,
   the ISO/RTO, OASIS, or the row's "area_aliases"). Example: "FPL", "TVA".
3. If no official acronym exists, use the shortest clearly-correct readable name.
4. Length: aim for 8 characters or fewer; 12 is the most you may use; never more
   than 15. Two-letter labels only if officially used (e.g. "FE", "MP").
5. If two organizations would get the same label, keep the acronym and add the
   SMALLEST suffix in this order: state, then region, then unit number, then
   project, then function. Examples: "USACE KC", "DOM Gen", "CPV MD".

For each appended line:
- evidence_url = the ONE web page you used (company site, ISO page, filing). If
  you did not open a page, leave it empty and set needs_review = yes.
- confidence = high, medium, or low.
- changed = yes if proposed_shortest differs from current_shortest, else no.
- needs_review = yes if you are not sure or found no clear evidence, else no.
- note = at most 10 words, or empty.

You HAVE a little agency: you may open web pages to verify an acronym, and you
may choose the suffix. You do NOT have agency to:
- edit any file other than src/data/nerc/_proposals/name-proposals.csv
- change roles, coordinates, regions, or any field other than the label
- invent an acronym that you cannot find on a real page (set needs_review = yes
  instead of guessing)
- work on rows outside the <START>..<END> window

When done, print: "Batch <START>-<END> done: N lines appended, M need review."
Then STOP. Do not start another batch.
```

---

## Prompt 2 — Co-located registrations to combine into one bubble

```
You are finding organizations that should share ONE map dot because they are the
same company at the same headquarters.

Work ONLY on the rows of src/data/nerc/location-queue.csv whose "order" column is
between <START> and <END> inclusive (if there is no "order" column, use the row
number, where the first data row is 1). That is your batch.

These rows already share a coordinate with one or more other orgs (see the
"shared_with" column). For EACH row in the batch, decide: are this org and the
org(s) in "shared_with" the SAME legal entity / same company family at the SAME
headquarters address?

APPEND one line per batch row to src/data/nerc/_proposals/combine-proposals.csv
(create it with this header once):
ncr_id,entity_name,shared_with,same_entity,canonical_ncr_id,reason,confidence,needs_review

- same_entity = yes only if the names clearly show the same company (e.g.
  "Dominion Energy Virginia - Nuclear" and "...- Power Generation"), or one is
  plainly a subsidiary/agent of the other. Otherwise no.
- canonical_ncr_id = the ncr_id that should be the kept bubble (prefer the one
  with the most grid roles / the transmission or balancing-authority record). Only
  fill this when same_entity = yes.
- reason = at most 12 words.
- confidence = high, medium, low.
- needs_review = yes whenever you are unsure, else no.

Do NOT combine two DIFFERENT companies just because they share an address
(office parks and capital cities have many). When in doubt, same_entity = no and
needs_review = yes.

Agency: you may read the entity names and infer corporate family; you may open a
web page to confirm a parent/subsidiary link. You may NOT edit any file other
than the proposals CSV, and you may NOT work outside the window.

When done print "Batch <START>-<END> done: K combine candidates found." then STOP.
```

---

## Prompt 3 — Verify MISO / PJM area codes point to the right org

```
You are checking that market-area codes map to the correct organization.

Open src/data/nerc/area-aliases.json. Work ONLY on the entries whose "order" (or
array position, first = 1) is between <START> and <END> inclusive.

For EACH entry, it has a "code" (e.g. "ALTE"), a "meaning" (e.g. "ALLETE /
Minnesota Power"), and an "ncr_id" target. Confirm that the code really belongs
to that organization in that market (MISO LBA codes, PJM transmission-zone codes).

APPEND one line per entry to src/data/nerc/_proposals/area-code-proposals.csv
(header once):
code,meaning,current_ncr_id,looks_correct,suggested_ncr_id,evidence_url,confidence,needs_review,note

- looks_correct = yes if the code, meaning, and target org agree; else no.
- suggested_ncr_id = only if looks_correct = no AND you found the right org's
  ncr_id inside public/nerc/orgs.json (search entity_name there). Else empty.
- evidence_url = the MISO/PJM/ISO page you used, or empty + needs_review = yes.
- Known thing to check carefully: is "ALTE" Alliant Energy East, or ALLETE /
  Minnesota Power? Report exactly what the official MISO LBA list says.

Agency: you may open MISO/PJM pages and search public/nerc/orgs.json for an
ncr_id. You may NOT edit area-aliases.json or any file except the proposals CSV,
and you may NOT change the codes — only report.

When done print "Batch <START>-<END> done." then STOP.
```

---

## After a batch

A human (or a careful pass) reviews the `_proposals/*.csv` files and applies the
`changed = yes` / `same_entity = yes` / `looks_correct = no` rows to the real
source files (`org-names.json`, `map-combines.json`, `area-aliases.json`), then
runs:

```bash
npm run nerc:build && npm run nerc:qa && npm run ux-check && npm run check
```

Only rows with `needs_review = no` and `confidence = high` should be applied
without a second look.
