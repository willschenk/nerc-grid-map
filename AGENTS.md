# Project instructions

This repository is an Astro site with one client-rendered D3 map of organizations
from the NERC Compliance Registry.

## Scope and priorities

- Prioritize Phase 1: registry ingest, normalization, reviewable outputs, data
  quality, and dashboard/map statistics.
- Do not add compliance-duty or compliance-modeling features.
- Treat Phase 1 as the project aim: improve the existing registry-to-map
  workflow before considering new functionality.
- Prefer deterministic pipelines, stable schemas, explicit failures, and
  lightweight dependencies.
- Treat registry files and researched external data as untrusted input.
- Keep changes minimal and scoped; avoid drive-by refactors and placeholder
  abstractions.

## Working-tree and git rules

- Pull with `git pull --ff-only` before starting.
- The working tree may contain another process's uncommitted work. Inspect
  `git status`, preserve unrelated changes, and stage explicit file paths only.
- Generated files under `public/nerc/` are never hand-edited.
- Run `npm run check` before every commit. Run the relevant data checks for
  pipeline or naming changes.
- Commit and push after each coherent change. Keep history linear.
- Do not deploy unless the user explicitly requests it.

## Data versus display

Decide whether a task changes source data or presentation before editing.

- Source/researched data: `src/data/nerc/`
- Generated payloads: `public/nerc/`
- Build-time enrichment: `src/lib/nerc/enrich.mjs`
- Renderer: `src/lib/nerc/map/nerc-org-map.ts`
- Styles: `src/lib/nerc/map/nerc-org-map.css`

For display-only work, do not modify source data. The renderer must not recompute
role weights, colors, or flags; change that logic in `enrich.mjs`.

## Geographic scope

Canonical rules live in `src/lib/nerc/geography-scope.mjs`. Do not treat Alaska
or Hawaii like excluded or out-of-footprint territories.

| Area | In NERC extract? | On map? | How |
|------|------------------|---------|-----|
| Lower 48 + Canada context | Yes (registry) | Yes | Main Albers projection |
| Alaska & Hawaii | No (supplemental only) | Yes | geoAlbersUsa AK/HI insets; real lat/lng |
| Puerto Rico & U.S. Virgin Islands | No (supplemental) | Yes | `out_of_footprint` offshore inset boxes |
| Guam, American Samoa, N. Mariana Islands | No | No | Excluded from data and basemap |

Alaska and Hawaii utilities belong in `supplemental-orgs.json` with
`state: "AK"` or `"HI"`, `out_of_footprint: false`, and HQ coordinates inside
their state. They are not NERC-registered and must not be marked
`out_of_footprint` (that flag is PR/VI only).

**Renderer:** Alaska/Hawaii land always draws on the geoAlbersUsa insets.
Supplemental inset utilities defer until ~k 1.5–2.5 so the tiny overview inset
stays clean; mainland bubble packing is fenced out of the inset bounds so dots
never drift across regions. City dots, city names, and inset state labels inside
AK/HI defer until ~k 3.2 so the inset reads as land-only context at overview.

## Key files

- Page: `src/pages/index.astro`
- Map client: `src/lib/nerc/map/nerc-org-map.ts`
- Map styles: `src/lib/nerc/map/nerc-org-map.css`
- Role definitions: `src/lib/nerc/roles.mjs`
- Display-name helpers: `src/lib/nerc/display-names.mjs`
- Name curation: `src/data/nerc/org-names.json`
- Name standard: `docs/standards/name-shortest.md`
- Pipeline scripts: `scripts/nerc/`
- Registry source/export files: `data/`

## Registry pipeline

The official registry is distributed as `.xlsx`. The current ingester accepts a
CSV/TSV export and fails explicitly on Excel input.

1. Export the workbook to CSV.
2. Run `npm run nerc:ingest -- data/<registry>.csv`.
3. Research any missing locations using
   `scripts/nerc/geocoding-agent-prompt.md`.
4. Run `npm run nerc:build`.
5. Run `npm run nerc:qa`, `npm run nerc:payload-check`, `npm run ux-check`, and
   `npm run check`.

`ingest.mjs` validates headers, normalizes rows to a stable schema, merges
multi-region rows by NCR ID, and prints dashboard statistics. Do not silently
accept malformed headers, unknown shapes, or null required fields.

`build-orgs.mjs` prefers `geocoded-orgs.json` and falls back to `seed-orgs.json`.
Seeds retire automatically through `seed-twins.json`; never hand-delete a seed.
`map-combines.json` folds same-entity co-registrations into one map bubble.

Each organization may have up to three `locations[]` entries. Rank 1 is the
published HQ and must match top-level `lat`/`lng`; ranks 2-3 are real alternate
facilities used for placement. Never invent alternate coordinates.

## Runtime payloads

`build-orgs.mjs` writes:

- `public/nerc/orgs.json`: canonical complete output for QA and development.
- `public/nerc/orgs-render.json`: minimal first-paint fields used by the map.
- `public/nerc/org-details.json`: panel-only details, loaded lazily.

Only add a field to `RENDER_ORG_FIELDS` when the renderer reads it. After changing
either payload field list, run `npm run nerc:payload-check`. To regenerate only
the split files from the canonical output, run:

```bash
node scripts/nerc/build-orgs.mjs --resplit
```

## Map invariants

- Mainland bubble disclosure is gated by `labelFitsInside()` and successful
  non-overlapping placement. Every visible mainland bubble carries a readable
  inside label.
- The capacity gate and live D3 force simulation run in screen-at-zoom-bucket
  space. Reheat on zoom-bucket changes, not pan, so panning remains stable.
- Keep bubbles geographically bounded. `_x`/`_y` are true projected coordinates;
  `_dx`/`_dy` are declutter offsets divided by zoom at render time.
- Coordinate spaces are distinct: base projection, transformed screen, and
  placement/solver space. Land-mask checks require the expected space.
- Role-set color is data, not decoration. Identical role sets must resolve to the
  same build-time color.
- Mobile is a separate tuning target. Gate phone-specific density, sizing, and
  interaction changes on the compact layout rather than degrading desktop.
- Do not reintroduce unlabeled background dots, viewport-driven disclosure, or
  renderer-side weight/color calculations.

## Name review

`docs/standards/name-shortest.md` is the only policy source for
`name_shortest`. `scripts/nerc/name-review-first-500.md` is the active pinned
worklist; `src/data/nerc/name-queue.{jsonl,csv}` is reference context.

During a pinned batch:

- Edit only `src/data/nerc/org-names.json` and completed worklist lines.
- Do not regenerate the name queue.
- Preserve official acronyms; do not replace them with prettier display names.
- Keep name changes separate from coordinates, roles, weights, and renderer
  behavior.

## Commands

```bash
npm run dev
npm run build
npm run check
npm run nerc:ingest -- data/<registry>.csv
npm run nerc:build
npm run nerc:qa
npm run nerc:payload-check
npm run ux-check
npm run nerc:name-queue
npm run nerc:migrate-locations
npm run nerc:location-queue
```
