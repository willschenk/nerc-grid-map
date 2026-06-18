# `name_shortest` organization-label standard

This is the authoritative standard for researching and reviewing organization
labels. It applies to every source record, including organizations that are
currently hidden by zoom disclosure, folded into a combined map bubble, excluded
from the published map, or supplied through `supplemental-orgs.json`.

The goal is a short, useful, map-friendly label:

1. Actual alias or code first.
2. Actual acronym second.
3. If neither exists, use the shortest meaningful label that helps the user.
4. Do not invent utility codes.
5. Do not make labels long merely to make them prettier.

## Length targets

- Best: fewer than 9 characters.
- Strong: 9-12 characters.
- Avoid: 13-15 characters; make one more shortening pass.
- Hard practical maximum: 15 characters.
- More than 15 characters requires an unavoidable, documented actual alias.
- Minimum: 3 characters unless the label is a real alias, code, or acronym.

These are curation limits for the researched `shortest` value in
`src/data/nerc/org-names.json`. The current renderer may derive a tighter token
for a bubble when the researched value does not fit. Do not shorten a researched,
real alias merely to satisfy a temporary renderer limit.

## Decision tree

1. Does the organization have an actual alias or code? Use it.
2. If not, does it have an actual acronym? Use it.
3. For a private GO/GOP/TO project, does the parent or project have an acronym?
   Use the acronym plus the site or project.
4. If there is a duplicate or conflict, add the shortest distinguishing word.
5. If no alias or acronym exists, use the shortest meaningful organization,
   project, or location label.
6. If the result is over 12 characters, shorten common words.
7. If it is still over 15 characters, remove filler words, then selected vowels.

## Research and evidence

Before changing a label, check what the entity calls itself when practical:

- NERC record
- OASIS page
- ISO/RTO material
- Company website
- Project owner page
- Public filings
- Press releases
- Existing `area_aliases` in the data

Prefer the company's own branding, capitalization, acronym, and project naming.
Do not replace a real company-used name merely because another label looks nicer.

Record the decision in `org-names.json` with:

- `shortest_type`: `alias_code`, `acronym`, `parent_project`,
  `meaningful_name`, or `location`
- `shortest_source`: the evidence category, such as `official_website`,
  `nerc_record`, `oasis`, `iso_rto_material`, `public_filing`,
  `press_release`, `area_alias`, or `inferred`
- `shortest_source_url`: evidence URL when available
- `review_notes`: brief reasoning, especially for inferred labels and exceptions
- `review_status`: `approved` only after the record has been checked
- `reviewed_at`: ISO date (`YYYY-MM-DD`)

An actual alias always wins, even if it is less obvious to a casual user.
Examples: `ALTE`, `ALTW`, `DPC`, `OTP`, `MP`, `MHEB`, `GLH`, `SPA`, `WAUE`,
and `WR`. Real aliases should usually be 2-8 characters, but a longer actual
alias is acceptable.

If there is no better alias, use the real acronym. Examples: `ATC`, `WAPA`,
`GRDA`, `NIPSCO`, `OVEC`, `MMPA`, `NYPA`, `CEF`, `NBSO`, `NGG`, and `NGUSA`.

## No fake codes

Do not invent compressed utility codes such as `NVE`, `BOW`, `BCW`, `CRW`,
`EFW`, `CYTRDG`, or `BLKOAK`.

If no real code exists, use a short meaningful label:

- `Black Oak`
- `Apple Riv`
- `Boot Hill`
- `Coyote Rdg`
- `North Star`
- `River Fls`
- `Cos Cob`

Readability beats fake compression. Prefer `Reedsburg` over `RDSBRG`,
`Kingfisher` over `KNGFSH`, and `Cent Hudson` over `CHGE` unless `CHGE` is a
real, preferred alias.

## Short and generic labels

Avoid two-letter labels unless they are real, recognized aliases. Labels that
require evidence include `AR`, `BH`, `BC`, `CR`, `EF`, `ER`, `GE`, `GP`, `GW`,
`IS`, `LR`, `NB`, `NF`, `NS`, `PC`, `PH`, `PR`, `RF`, `RR`, `SS`, `WC`, and
`WS`.

Avoid generic labels that do not identify the organization, including filler
words such as `and`, `the`, `one`, `water`, `power`, `company`, `corporation`,
`utility`, `department`, `city`, and `town`.

## Collisions

No two nearby, similar, or related organizations should share the same
`name_shortest`. Add the smallest useful distinction:

- `Astoria En` / `Astoria Gen`
- `Prairie` / `Prairie II`
- `Sunflower EC` / `Sunflower WF`
- `Montpelier GS` / `Montpelier PV`

Prefer the disambiguated result under 12 characters. Never exceed 15 unless an
unavoidable actual alias requires it.

Preserve a unit number, phase, or ordinal when it distinguishes records:
`Flat Ridge 1`, `FR2`, `FR3`, `Prairie II`, `Indian Pt 3`, `Horus WV1`, and
`Dakota III`.

## Private projects and parent identity

For private companies mainly engaged in GO, GOP, or TO, do not use only the
location when company or project identity matters.

Use:

- `CEF - L`, not `Lordstown`
- `RE Stratton`, not `Stratton`
- `GSP Schiller`, not `Schiller`
- `NRG Golden`, not `Golden`

Preferred pattern: `[parent acronym] + [site/project]`.

Examples:

- `CEF - L`
- `CPV Shore`
- `GSP Newingtn`
- `Indeck Oswego`
- `RE Stratton`
- `NRG Golden`
- `Avangrid Svc`

Target 5-12 characters, with 15 as the maximum.

For a parent with many project records, do not label every record only by the
parent. Use `CPV Shore`, `GSP Newingtn`, `Indeck Olean`, `RE Stratton`,
`NRG Golden`, and `Avangrid Svc` instead of repeating only `CPV`, `GSP`,
`Indeck`, `ReEnergy`, `NRG`, or `Avangrid`.

Use a location-only label only when no real alias exists, no useful acronym
exists, parent identity is unimportant, and the location is the clearest
identifier. Examples: `Cos Cob`, `Ravenswood`, `Indian Pt 3`, and `Cannon Fls`.

## Asset abbreviations

Use standard asset words when they preserve meaning:

| Short form | Meaning |
| --- | --- |
| `PV` | Solar |
| `WF` | Wind / Wind Farm |
| `EC` | Energy Center |
| `GS` | Generating Station |
| `CC` | Combined Cycle |
| `Cogen` | Cogeneration |
| `Hydro` | Hydroelectric / Hydropower |
| `Tx` | Transmission, only when clear |
| `Trans` | Transmission when `Tx` is too cryptic |
| `O&M` | Operations & Maintenance |
| `Svc` | Service / Services |
| `Ops` | Operations |
| `Gen` | Generation / Generating |
| `Pwr` | Power, only when needed |
| `Elec` | Electric, only when needed |

For solar records, use `PV` when helpful:

- `Montpelier Solar` -> `Montpelier PV`
- `North Star Solar` -> `N Star PV`
- `Rocking R Solar` -> `Rocking R PV`
- `Northeast Texas Solar` -> `NE Texas PV`
- `Prairie Rose Solar` -> `Prairie PV` when there is no conflict

For wind records, use `WF` when helpful:

- `Sunflower Wind` -> `Sunflower WF`
- `Prairie Rose Wind` -> `Prairie WF`
- `Black Oak Wind` -> `Black Oak`, or `Black Oak WF` when needed
- `Coyote Ridge Wind` -> `Coyote Rdg`, or `Coyote WF` when needed

If the project word alone is distinctive, the asset suffix may be omitted.

## Direction and common-word shortening

Use common directional abbreviations:

| Long form | Short form |
| --- | --- |
| Northeast | `NE` |
| Northwest | `NW` |
| Southeast | `SE` |
| Southwest | `SW` |
| Central | `Cent` |
| Northern | `N` |
| Southern | `S` |
| Eastern | `E` |
| Western | `W` |

Examples: `NE Texas`, `Cent Hudson`, `SW Power`, and `N Indiana` unless
`NIPSCO` is the real acronym.

Shorten common words before removing vowels:

| Long form | Short form |
| --- | --- |
| Municipal | `Mun` |
| Utilities | `Util` |
| Electric | `Elec` |
| Cooperative | `Coop` |
| Generation / Generating | `Gen` |
| Transmission | `Trans` or `Tx` |
| Services | `Svc` |
| Operations | `Ops` |
| Energy Center | `EC` |
| Generating Station | `GS` |
| Combined Cycle | `CC` |

## Shortening sequence

When a label is too long, shorten it in this order:

1. Use the actual alias or code.
2. Use the actual acronym.
3. Replace asset types (`Solar` -> `PV`, `Wind` -> `WF`, `Energy Center` ->
   `EC`, `Generating Station` -> `GS`, `Combined Cycle` -> `CC`).
4. Replace geography and directions (`Northeast` -> `NE`, `Central` -> `Cent`,
   `Southwest` -> `SW`).
5. Remove legal suffixes (`LLC`, `Inc.`, `LP`, `L.P.`, `Company`,
   `Corporation`).
6. Remove filler words (`Project`, `Energy`, `Power`, `The`, `Of`).
7. Shorten common words (`Municipal` -> `Mun`, `Utilities` -> `Util`,
   `Cooperative` -> `Coop`).
8. Remove vowels only when the result is still too long.
9. Do not exceed 15 characters.

Only remove vowels after normal abbreviation leaves the label over 12
characters, and only when the result remains recognizable.

Prefer:

- `Cent Hudson`, not `CNTR HDSN`
- `NE Texas`, not `NRTHST TX`
- `Montpelier PV`, not `MNTPLR PV`
- `Prairie WF`

## Organization-type guidance

For public utilities, cooperatives, and municipals:

1. Use the actual alias or acronym when known.
2. Otherwise use the city or utility name.
3. Shorten common words only when needed.

Examples: `Paragould`, `Oconomowoc`, `Jefferson`, `McPherson`, `River Fls`,
`Cent Hudson`, and `NE Texas`.

For federal or regional entities with multiple sub-records, include the agency
plus region or district: `USACE KC`, `USACE LR`, `USACE Omaha`, `WAPA RM`,
and `WAUE`.

## Long-name audit

While reviewing `name_shortest`, also inspect:

- `entity_name`
- `name_short`
- `name_normal`
- `acronym`

Look for spelling errors, capitalization, missing spaces, punctuation, stale
company names, awkward legal ordering, grammar, duplicate labels, bad aliases,
and labels that no longer match company branding.

Fix obvious long-name errors in the source record during a later, explicitly
scoped data-edit pass. Examples:

- `Big Blue WInd Farm` -> `Big Blue Wind Farm`
- `Canal Generating llc` -> `Canal Generating LLC`
- `Horus West Virginia 1,LLC` -> `Horus West Virginia 1, LLC`
- `Fairport Municipal Commision` -> `Fairport Municipal Commission`
- User-facing `Board Of` -> `Board of`
- User-facing `City Of` -> `City of`

Do not mix these long-name corrections into a label-only batch without noting
the separate source-data change.

## Final quality check

Every reviewed `name_shortest` must be:

- short
- unique where nearby or related
- recognizable
- real, not invented
- not overly generic
- not misleading
- free of unnecessary legal words
- no longer than needed
- useful on a crowded map

The final test is: "Can a user recognize this bubble quickly without the label
taking too much map space?"

## Review workflow

1. Run `npm run nerc:name-queue`.
2. Open `src/data/nerc/name-queue.jsonl` or `.csv`.
3. Review records in order. The queue includes published, zoom-hidden,
   map-combined, retired-seed, and source-only records.
4. Update the matching object in `src/data/nerc/org-names.json`.
5. Set `review_status` to `approved` and add the evidence metadata above.
6. Re-run `npm run nerc:name-queue`; approved records leave the default queue.
7. Run `npm run nerc:name-queue-all` to inspect every source record, including
   approved records.
8. Before publishing name changes, run `npm run nerc:build`,
   `npm run nerc:payload-check`, `npm run ux-check`, and `npm run check`, then
   compare the map at matched desktop and mobile zoom levels.

Queue generation is an audit operation only. It never writes organization names.
