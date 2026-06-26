# `name_shortest` organization-label standard

This is the authoritative standard for `name_shortest`. It applies to every
source record, including combined members, supplemental records, retired seeds,
and organizations currently hidden by the renderer.

## Core rule

The map label is the shortest correct identifier, not the prettiest company
nickname and not an automatically invented code.

Use this order:

0. User-provided known-good acronym, alias, or mapping from the project owner.
1. Official or authoritative alias/code.
2. Official acronym.
3. Canonical public acronym that should replace a legacy/modelled format.
4. Parent or project acronym plus a distinguishing suffix.
5. Shortest meaningful readable label.

Project-owner acronym tables and explicit project-owner corrections are top
priority evidence. If the project owner supplied a value as known-good from
personal experience, use it even when older documentation called the same value
legacy/modelled. Store it as `shortest`; set `shortest_type` to the correct kind
such as `alias_code` or `acronym`; set `shortest_source` to `user_provided` when
no better public evidence URL is available.

An official acronym wins over a longer readable name. Do not replace `AMMO`,
`DPC`, `SECI`, `MHEB`, `SPC`, `OTP`, `SMP`, `SPA`, `WR`, `WEC`, `BREC`, `HE`,
`GLH`, `LGEE`, `NBSO`, `AECI`, `CIN`, `YAD`, or similar verified values merely
because a company name looks friendlier.

## Evidence and canonical forms

Check, in this order when available: project-owner supplied acronym tables or
explicit corrections, the NERC record, OASIS, ISO/RTO material, the
organization's website, public filings, project-owner material, and existing
`area_aliases`.

User-provided acronym tables are authoritative unless a value is explicitly
marked uncertain, not found, likely combined, or requiring verification.

When a legacy form maps to a better canonical public acronym, use the canonical
form as `shortest` and retain the legacy form as an alias/reference. Examples:

- `ISNE` -> `ISO-NE`
- `NYIS` -> `NYISO`
- `ONT` -> `IESO`
- `NIPS` -> `NIPSCO`
- `SIGE` -> `SIGECO`
- `CE` -> `ComEd`
- `DECO` -> `DTE`
- `TEC` -> `TECO`
- `OKGE` -> `OG&E`
- `GVL` -> `GRU`
- `HST` -> `HPS`
- `TAL` -> `TLH`
- `LAFA` -> `LUS`

Do not promote an unverified legacy planning-area value such as `SMT`, `SPIF`,
`LAGT`, `LEGN`, `MPS`, `MIUP`, `SEHA`, `SERU`, `SETH`, or similar values without
evidence that it is the correct visible identifier for that record. However,
project-owner supplied values such as `CIN`, `YAD`, or other personally verified
mappings count as evidence and should be used.

## Length

- Best: fewer than 9 characters.
- Strong: 9-15 characters.
- Acceptable readable fallback: 16-22 characters when the extra words are needed
  for users to understand the organization, project, or place.
- Hard practical maximum: 22 characters, unless an unavoidable official alias,
  code, or clear readable site/project label is longer.
- Two-letter labels are allowed only when verified as official or supplied by the
  project owner, for example `FE`, `HE`, `MP`, `SC`, `CE`, and `WR`.

These limits apply to the researched `shortest` value in
`src/data/nerc/org-names.json`. The renderer may derive a tighter token for
bubble fit; do not weaken an authoritative researched value to satisfy a
temporary render limit.

If there is no acronym, be more lenient with readable place/project names. Users
should be able to recognize the organization. For example, `NRG El Segundo` is a
better `shortest` label than a cryptic invented code because the parent and place
are both useful. Remove obvious clutter such as commas, `LLC`, `Inc.`, `Company`,
`Corporation`, and similar legal suffixes, but do not remove the parent or place
when that would make the record unclear.

## Collisions and project records

If an official acronym collides with a nearby or related record, keep the
acronym and add the smallest useful suffix.

Suffix priority:

1. State
2. Region or district
3. Unit number
4. Project or site
5. Function

Examples: `USACE KC`, `USACE LR`, `WAPA RM`, `CPV Shore`, `CPV MD`,
`GSP Newgtn`, `Indeck Olean`, `RE Stratton`, `NRG Golden`, `NRG El Segundo`,
`AMMO Gen`, `DOM Nuke`, `DOM Gen`, and `FPL NW`.

For private GO/GOP/TO entities, use `[parent acronym] + [site/project]` when a
parent has multiple records. Do not collapse every CPV, GSP, Indeck, ReEnergy,
NRG, or similar parent to the parent acronym alone, and do not discard the parent
identity in favor of a location-only label.

Preserve distinguishing unit numbers, phases, and ordinals.

## No unsupported acronyms

Do not automatically invent compressed utility codes merely because they are
short. Values such as `NVE`, `BOW`, `BCW`, `CRW`, `EFW`, `BLKOAK`, `CYTRDG`,
`MNTPLR`, `SNFLWR`, `WHTSBR`, and `CLDWTR` require evidence; otherwise use a
readable fallback.

Obvious, common-place acronyms may be used when they are well understood in the
industry or supplied by the project owner. For example, `SC` may be appropriate
for Southern Company when the record context supports it. This is an exception,
not the default: avoid turning every multi-word name into initials.

Avoid generic labels such as `and`, `the`, `one`, `water`, `power`, `company`,
`corporation`, `utility`, `department`, `city`, and `town`.

## Readable fallback

Use a readable label when no official alias/acronym, project-owner acronym, or
useful parent acronym exists. Examples: `Black Oak`, `Blue Cloud`, `Boot Hill`,
`East Fork`, `Iron Star`, `River Fls`, `Cos Cob`, `Ravenswood`, `Indian Pt 3`,
and `NRG El Segundo`.

Location-only labels are appropriate only when the location is the clearest
identifier and does not create a collision.

For utilities, cooperatives, and municipals, use the official acronym when one
exists. Otherwise use the shortest recognizable city or utility name.

## Fallback abbreviations

Apply these only to non-acronym fallback labels:

| Short form | Meaning |
| --- | --- |
| `PV` | Solar |
| `WF` | Wind / Wind Farm |
| `EC` | Energy Center |
| `GS` | Generating Station |
| `CC` | Combined Cycle |
| `Cogen` | Cogeneration |
| `Hydro` | Hydroelectric / Hydropower |
| `Tx` / `Trans` | Transmission |
| `Svc` | Service / Services |
| `Ops` | Operations |
| `O&M` | Operations & Maintenance |
| `Gen` | Generation / Generating |
| `ES` | Energy Storage |

Common directional and word forms include `NE`, `NW`, `SE`, `SW`, `Cent`, `N`,
`S`, `E`, `W`, `Mun`, `Util`, `Elec`, `Coop`, `Cnty`, `Crk`, `Rdg`, `Riv`,
`Fls`, `Spg`, and `St`.

Shorten in this order:

1. Use the project-owner supplied value, official alias/code, or acronym.
2. Use the parent acronym plus a meaningful site/project/place suffix.
3. Apply an asset abbreviation such as `WF` or `PV`.
4. Shorten directions and common words.
5. Remove legal suffixes and filler words.
6. Remove selected vowels only if the result remains recognizable.

Do not apply fallback beautification when an official or project-owner supplied
acronym exists.

## Long-name review

While reviewing a label, inspect `entity_name`, `short`, `normal`, `acronym`,
and `area_aliases` for obvious spelling, capitalization, spacing, punctuation,
stale-name, and alias-mapping problems.

Apply long-name corrections in a separately scoped data change. Do not mix them
silently into a label-only batch.

## Stored metadata

`org-names.json` currently supports:

- `shortest_type`: `alias_code`, `acronym`, `parent_project`,
  `meaningful_name`, or `location`
- `shortest_source`: evidence category such as `user_provided`, `nerc_record`,
  `oasis`, `iso_rto_material`, `organization_website`, `public_filing`,
  `project_owner_material`, `area_aliases`, `common_market_name`, or
  `researched_fallback`
- `shortest_source_url`: evidence URL when available; use `null` or omit it when
  the source is a project-owner supplied value without a public URL

Do not add review statuses, dates, or notes unless the schema and consumers are
explicitly changed first.

## Review workflow

1. When starting a full pass, delete stale generated working lists such as
   `src/data/nerc/name-queue.jsonl`, `src/data/nerc/name-queue.csv`, and any
   temporary first-500 worklist, then regenerate a fresh queue from current data.
2. Take the next unreviewed records from the current queue/worklist in order.
3. Use `src/data/nerc/name-queue.jsonl` or `.csv` for context.
4. Research and update the matching object in
   `src/data/nerc/org-names.json`.
5. Record metadata for every changed `shortest`: `shortest_type`,
   `shortest_source`, and `shortest_source_url` when available.
6. Leave a clear placeholder/progress marker where review stops so the next pass
   can continue without redoing completed records.
7. Keep label edits separate from renderer, coordinate, role, and weight changes.
8. Validate before publishing:

```bash
node -e 'const d=require("./src/data/nerc/org-names.json"); const ids=d.names.map(x=>x.ncr_id); if(ids.length!==new Set(ids).size) process.exit(1)'
npm run nerc:build
npm run nerc:payload-check
npm run ux-check
npm run check
```

Do not run `npm run nerc:name-queue` in the middle of a pinned batch unless the
batch is intentionally being reset; the queue is a reference export, not the
progress tracker.

## Final check

Every `name_shortest` must be authoritative where possible, short enough for the
map, unique where needed, recognizable, non-generic, and free of unnecessary
legal words.

The prior practice of replacing verified official acronyms with prettier display
names was wrong. Keep the official or project-owner supplied acronym in
`name_shortest`; put the readable organization name in `short` or `normal`.