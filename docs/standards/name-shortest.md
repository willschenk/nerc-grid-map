# `name_shortest` organization-label standard

This is the authoritative standard for `name_shortest`. It applies to every
source record, including combined members, supplemental records, retired seeds,
and organizations currently hidden by the renderer.

## Core rule

The map label is the shortest correct identifier, not the prettiest company
nickname.

Use this order:

1. Official or authoritative alias/code.
2. Official acronym.
3. Parent or project acronym plus a distinguishing suffix.
4. Shortest meaningful readable label.

An official acronym wins over a longer readable name. Do not replace `AMMO`,
`DPC`, `SECI`, `MHEB`, `SPC`, `OTP`, `SMP`, `SPA`, `WR`, `WEC`, `BREC`, `HE`,
`GLH`, `LGEE`, `NBSO`, `AECI`, or similar verified values merely because a
company name looks friendlier.

## Evidence and canonical forms

Check the NERC record, OASIS, ISO/RTO material, the organization's website,
public filings, project-owner material, and existing `area_aliases`.

User-provided acronym tables are authoritative unless a value is explicitly
marked uncertain, legacy/modelled, not found, likely combined, or requiring
verification.

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
`LAGT`, `LEGN`, `CIN`, `MPS`, `MIUP`, `SEHA`, `SERU`, `SETH`, or `YAD` without
evidence that it is the correct visible identifier for that record.

## Length

- Best: fewer than 9 characters.
- Strong: 9-12 characters.
- Avoid: 13-15 characters.
- Hard practical maximum: 15 characters, unless an unavoidable official
  alias/code is longer.
- Two-letter labels are allowed only when verified as official, for example
  `FE`, `HE`, `MP`, `SC`, `CE`, and `WR`.

These limits apply to the researched `shortest` value in
`src/data/nerc/org-names.json`. The renderer may derive a tighter token for
bubble fit; do not weaken an authoritative researched value to satisfy a
temporary render limit.

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
`GSP Newgtn`, `Indeck Olean`, `RE Stratton`, `NRG Golden`, `AMMO Gen`,
`DOM Nuke`, `DOM Gen`, and `FPL NW`.

For private GO/GOP/TO entities, use `[parent acronym] + [site/project]` when a
parent has multiple records. Do not collapse every CPV, GSP, Indeck, ReEnergy,
or NRG record to the parent acronym alone, and do not discard the parent identity
in favor of a location-only label.

Preserve distinguishing unit numbers, phases, and ordinals.

## No invented acronyms

Do not invent compressed utility codes merely because they are short. Values
such as `NVE`, `BOW`, `BCW`, `CRW`, `EFW`, `BLKOAK`, `CYTRDG`, `MNTPLR`,
`SNFLWR`, `WHTSBR`, and `CLDWTR` require evidence; otherwise use a readable
fallback.

Avoid generic labels such as `and`, `the`, `one`, `water`, `power`, `company`,
`corporation`, `utility`, `department`, `city`, and `town`.

## Readable fallback

Use a readable label only when no official alias/acronym or useful parent
acronym exists. Examples: `Black Oak`, `Blue Cloud`, `Boot Hill`, `East Fork`,
`Iron Star`, `River Fls`, `Cos Cob`, `Ravenswood`, and `Indian Pt 3`.

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

1. Use the official alias/code or acronym.
2. Apply an asset abbreviation.
3. Shorten directions and common words.
4. Remove legal suffixes and filler words.
5. Remove selected vowels only if the result remains recognizable.

Do not apply fallback beautification when an official acronym exists.

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
- `shortest_source`: evidence category
- `shortest_source_url`: evidence URL when available

Do not add review statuses, dates, or notes unless the schema and consumers are
explicitly changed first.

## Review workflow

1. Take the next records from `scripts/nerc/name-review-first-500.md`.
2. Use `src/data/nerc/name-queue.jsonl` or `.csv` for context.
3. Research and update the matching object in
   `src/data/nerc/org-names.json`.
4. Delete completed worklist lines; leave uncertain records in place.
5. Keep label edits separate from renderer, coordinate, role, and weight changes.
6. Validate before publishing:

```bash
node -e 'const d=require("./src/data/nerc/org-names.json"); const ids=d.names.map(x=>x.ncr_id); if(ids.length!==new Set(ids).size) process.exit(1)'
npm run nerc:build
npm run nerc:payload-check
npm run ux-check
npm run check
```

Do not run `npm run nerc:name-queue` during a pinned batch; the queue is a
reference export, not the progress tracker.

## Final check

Every `name_shortest` must be authoritative where possible, short, unique where
needed, recognizable, non-generic, and free of unnecessary legal words.

The prior practice of replacing verified official acronyms with prettier display
names was wrong. Keep the official acronym in `name_shortest`; put the readable
organization name in `short` or `normal`.
