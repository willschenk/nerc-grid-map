# nerc-grid-map

This is a map of organizations listed in the NERC Compliance Registry. NERC publishes the registry as a spreadsheet of registered entities and the reliability functions they perform: things like BA, TOP, TO, TP, RC, GO, GOP, LSE, DP, and PSE. The spreadsheet does not include map-ready coordinates, so this project turns the registry into a static dataset that can be inspected visually.

Each dot is one registered entity. It is placed at a headquarters, office, plant, project, or best-known operating location depending on what could be found. Color represents the entity's mix of NERC functions. Size represents a simple role weight, so entities with broader or more system-level responsibilities stand out.

AI was used for the tedious research step: looking up each entity, finding a reasonable short label, and finding coordinates from public sources such as organization websites, NERC/CORES references, FERC filings, EIA data, SEC filings, state records, market-operator material, and map/search results. The scripts do not blindly trust that work. Each location carries a confidence level and notes, and low-confidence or estimated records are marked for review.

This is not an official NERC product and it is not a compliance source of truth. It is a working visualization of public registry data plus researched location metadata.

Live: https://willschenk.github.io/nerc-grid-map/

The site is a single Astro page with vanilla D3. The organization data is baked into `public/nerc/orgs.json` at build time, so the deployed page is static and only fetches JSON.

## Quick start

```bash
npm install
npm run dev      # builds the data, then serves the map at http://localhost:4321/
npm run build    # builds the data, then the static site into dist/
npm run preview  # preview the production build
npm run check    # astro + TypeScript check
```

`dev` and `build` both run `scripts/nerc/build-orgs.mjs` first (npm `predev` / `prebuild`), so the rendered data is always current with `src/data/nerc/`.

## Data

The starting point is a CSV export of the NERC Compliance Registry. The pipeline normalizes the spreadsheet rows, adds researched location metadata, computes map fields, and writes the static JSON file used by the browser.

Only the location-research step used AI. The rest is deterministic Node scripts.

```
data/*.csv                         raw NERC Compliance Registry export, saved as CSV
  -> scripts/nerc/ingest.mjs       normalize to { ncr_id, entity_name, region, roles }
src/data/nerc/ingested-records.json
  -> AI-assisted research          add lat/lng + short label + confidence + notes
src/data/nerc/geocoded-orgs.json
  -> scripts/nerc/build-orgs.mjs   enrich (weight, color, flags) + copy US basemap
public/nerc/orgs.json              <- the file the map fetches at runtime
  -> scripts/nerc/qa.mjs           validate coordinates, colors, weights, confidence
```

Run the deterministic parts:

```bash
npm run nerc:ingest data/nerc-active-compliance-matrix-functions-2026-05-26.csv
# geocode src/data/nerc/ingested-records.json -> src/data/nerc/geocoded-orgs.json
npm run nerc:build
npm run nerc:qa
```

If `src/data/nerc/geocoded-orgs.json` is absent, `build-orgs.mjs` falls back to the curated `src/data/nerc/seed-orgs.json`, so the map always builds.

### AI-assisted location research

`scripts/nerc/geocoding-agent-prompt.md` is the prompt used for the research pass. The goal is to find:

- coordinates
- a short map label or acronym
- source type and source URL when available
- confidence level
- notes explaining the choice

The research is intentionally conservative. If an entity's legal headquarters does not match the NERC region or the operating asset, the record should say so. If no solid source is found, the point is estimated from the entity name and region rather than left blank. Those records are marked `LOW` or `ESTIMATED` so they can be reviewed later.

The final researched file is `src/data/nerc/geocoded-orgs.json` in this shape:

```json
{ "orgs": [] }
```

## Layout

```
src/pages/index.astro              the map page (markup + role legend)
src/lib/nerc/map/nerc-org-map.ts   the D3 client (rendering, zoom, filters, search, tour)
src/lib/nerc/map/nerc-org-map.css  all map styles (scoped under #nerc-app)
src/lib/nerc/roles.mjs             role tables: weights, color anchors, full names, tiers
src/lib/nerc/enrich.mjs            build-time enrichment (weight, color, org type, acronym)
src/lib/nerc/types.ts             shared types
scripts/nerc/                      ingest, build-orgs, qa, geocoding-agent-prompt.md
src/data/nerc/                     seed, ingested, and geocoded records
public/nerc/                       generated orgs.json + US states basemap (committed)
data/                              raw registry CSV exports
```

## Deploy

The site is published to GitHub Pages at the URL above, served from the `gh-pages` branch. The base path (`/nerc-grid-map/`) is set in `astro.config.mjs`; the map reads `import.meta.env.BASE_URL`, so all asset URLs follow it.

Redeploy after changes:

```bash
npm run deploy   # builds, then pushes dist/ to the gh-pages branch
```

To automate deploys with GitHub Actions instead, move the template at `ci/pages-deploy.yml` to `.github/workflows/deploy.yml` (this needs the `workflow` token scope: `gh auth refresh -s workflow`), then set the repo's Pages source to "GitHub Actions".

## Notes

This is an experimental visualization, not a compliance record. Role assignments in the seed set are illustrative until the full registry is ingested. Coordinates carry a confidence level; estimated points are drawn with a dashed outline.
