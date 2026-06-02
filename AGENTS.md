# Agents

This is an interactive data-visualization site: one Astro page that renders NERC-registered grid organizations with vanilla D3. Unlike a static text archive, client JavaScript is the whole point. There are no "keep it plain / no JS" constraints here. Make the map more useful: better readability, filtering, hover behavior, search, and reviewability.

## What the project is

Every dot is one entity from the NERC Compliance Registry, placed at its headquarters. An entity's roles (BA, TOP, TO, TP, RC, TSP, GO, GOP, LSE, DP, PSE, ...) come from NERC's functional model. Color encodes the role mix; size encodes total role weight. The data is baked to `public/nerc/orgs.json` at build time and fetched at runtime.

## Edit map

- Map page: `src/pages/index.astro`
- Map client (D3): `src/lib/nerc/map/nerc-org-map.ts`
- Map styles: `src/lib/nerc/map/nerc-org-map.css` (scoped under `#nerc-app`)
- Role tables (weights, color anchors, names, tiers): `src/lib/nerc/roles.mjs`
- Build-time enrichment: `src/lib/nerc/enrich.mjs`
- Pipeline scripts: `scripts/nerc/{ingest,build-orgs,qa}.mjs`
- Source data: `src/data/nerc/*`, raw CSV in `data/`

## Data pipeline

1. `npm run nerc:ingest data/<registry>.csv` -> `src/data/nerc/ingested-records.json` (normalized rows).
2. Geocode each record with the agent (below) -> `src/data/nerc/geocoded-orgs.json` (`{ "orgs": [...] }`).
3. `npm run nerc:build` enriches and writes `public/nerc/orgs.json` plus the US basemap.
4. `npm run nerc:qa` validates the output. Fix warnings, rebuild.

`build-orgs.mjs` prefers `geocoded-orgs.json` and falls back to `seed-orgs.json`, so the site always builds.

## Geocoding and entity search

`scripts/nerc/geocoding-agent-prompt.md` is the production prompt. Use it to locate each entity and to find a short map label. Rules that matter:

- Treat acronyms and short names as map data. Search public sources for the official short name: the organization's own site, NERC CORES, FERC filings, EIA, SEC filings, and known market-operator usage (PJM, MISO, CAISO, SPP, ISO-NE, NYISO, ERCOT).
- If no source gives a short name, build a deterministic initialism from the legal name (drop legal suffixes) and record it as inferred (`acronym_source: "name_initialism"`).
- Every record gets coordinates. Never null. Estimate from name + NERC region before giving up, and mark it ESTIMATED.
- Preserve established punctuation in names (PG&E, PSE&G, OG&E, ISO-NE).
- NERC region is the strongest geographic constraint. If a found address contradicts the region, downgrade confidence and note the conflict.
- Subsidiaries use their own geography, not the parent's.

## Map conventions

- Keep the role color schema from `roleSetColor` in `enrich.mjs`. A circle's color encodes its role mix (a weighted centroid of role anchors). Do not restyle color as decoration; identical role sets must share one color.
- At low zoom, labels use acronyms or short names, not full legal names.
- The renderer never recomputes weight, color, or flags; those are precomputed at build time in `enrich.mjs`. Change the math there, not in the client.

## Commands

```bash
npm run dev       # build data + serve
npm run build     # build data + static site
npm run check     # astro + TypeScript
npm run nerc:qa   # validate public/nerc/orgs.json
```
