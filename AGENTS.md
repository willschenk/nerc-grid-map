# Agents

This is an interactive data-visualization site: one Astro page that renders NERC-registered grid organizations with vanilla D3. Unlike a static text archive, client JavaScript is the whole point. There are no "keep it plain / no JS" constraints here. Make the map more useful: better readability, filtering, hover behavior, search, and reviewability.

> **New here? Read [LESSONS.md](LESSONS.md) first** — distilled, hard-won lessons from this project's history (display-vs-data rule, the shared working tree, renderer/iOS/coordinate-space gotchas, and the `?audit` tuning harness). This file (AGENTS.md) is the structure/commands; LESSONS.md is the why-and-how-not-to-break-things.

## What the project is

Every dot is one entity from the NERC Compliance Registry, placed at its headquarters. An entity's roles (BA, TOP, TO, TP, RC, TSP, GO, GOP, LSE, DP, PSE, ...) come from NERC's functional model. Color encodes the role mix; size encodes total role weight. The data is baked to `public/nerc/orgs.json` at build time and fetched at runtime.

## Edit map

- Map page: `src/pages/index.astro`
- Map client (D3): `src/lib/nerc/map/nerc-org-map.ts`
- Map styles: `src/lib/nerc/map/nerc-org-map.css` (scoped under `#nerc-app`)
- Role tables (weights, color anchors, names, tiers): `src/lib/nerc/roles.mjs`
- Build-time enrichment: `src/lib/nerc/enrich.mjs`
- Pipeline scripts: `scripts/nerc/{ingest,build-orgs,qa,build-research-queue,build-location-queue,migrate-locations}.mjs`
- Manual research hand-off: `scripts/nerc/cursor-research-queue.md` + `src/data/nerc/research-queue.{jsonl,csv}`
- Alternate-location queue: `src/data/nerc/location-queue.{jsonl,csv}` (shared rank-1 coordinates)
- Source data: `src/data/nerc/*`, raw CSV in `data/`

## Data pipeline

1. `npm run nerc:ingest data/<registry>.csv` -> `src/data/nerc/ingested-records.json` (normalized rows).
2. Geocode each record with the agent (below) -> `src/data/nerc/geocoded-orgs.json` (`{ "orgs": [...] }`).
3. `npm run nerc:build` enriches and writes `public/nerc/orgs.json` plus the US basemap.
4. `npm run nerc:qa` validates the output. Fix warnings, rebuild.

`build-orgs.mjs` prefers `geocoded-orgs.json` and falls back to `seed-orgs.json`, so the site always builds.

### Research queue and seed retirement

Only MRO and NPCC are geocoded so far. `build-research-queue.mjs` diffs the ingest
against the geocoded set and writes the remaining work to `research-queue.{jsonl,csv}`
(WECC, Texas RE, SERC, and the rest of RF). See `cursor-research-queue.md` for the
hand-off. The ~60 `NCR-SEED-xxx` records are placeholder duplicates of real registry
rows; `seed-twins.json` maps each to its authoritative twin id, and `build-orgs.mjs`
auto-drops a seed once any twin is geocoded — so geocode real rows normally and never
hand-delete a seed.

## Geocoding and entity search

`scripts/nerc/geocoding-agent-prompt.md` is the production prompt. Use it to locate each entity and to find a short map label. Rules that matter:

- Treat acronyms and short names as map data. Search public sources for the official short name: the organization's own site, NERC CORES, FERC filings, EIA, SEC filings, and known market-operator usage (PJM, MISO, CAISO, SPP, ISO-NE, NYISO, ERCOT).
- If no source gives a short name, build a deterministic initialism from the legal name (drop legal suffixes) and record it as inferred (`acronym_source: "name_initialism"`).
- Every record gets coordinates. Never null. Estimate from name + NERC region before giving up, and mark it ESTIMATED.
- Preserve established punctuation in names (PG&E, PSE&G, OG&E, ISO-NE).
- NERC region is the strongest geographic constraint. If a found address contradicts the region, downgrade confidence and note the conflict.
- Subsidiaries use their own geography, not the parent's.
- Each org may have up to three geographic slots in `locations[]` (rank 1 = HQ, ranks 2–3 = alternates). Fill ranks 2–3 when multiple entities share rank-1 coordinates; see `location-queue.csv`. Rank 1 always drives published `lat`/`lng`; the map tries rank 1→2→3 at runtime when declutter cannot place a dot near the current slot.

### Map-combines and alternate locations

`map-combines.json` folds same-entity co-registrations into one dot. Alternate `locations[]` slots belong to the canonical combined org only; member rows are not merged slot-by-slot.

## Map conventions

- Keep the role color schema from `roleSetColor` in `enrich.mjs`. A circle's color encodes its role mix (a weighted centroid of role anchors). Do not restyle color as decoration; identical role sets must share one color.
- At low zoom, labels use acronyms or short names, not full legal names.
- The renderer never recomputes weight, color, or flags; those are precomputed at build time in `enrich.mjs`. Change the math there, not in the client.

## Commands

```bash
npm run dev       # build data + serve
npm run build     # build data + static site
npm run check     # astro + TypeScript
npm run nerc:qa              # validate public/nerc/orgs.json
npm run nerc:migrate-locations  # backfill locations[] on source JSON
npm run nerc:location-queue     # export shared-coordinate rows needing ranks 2–3
```
