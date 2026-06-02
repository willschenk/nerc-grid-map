# nerc-grid-map

Interactive map of organizations registered with the North American Electric Reliability Corporation (NERC) to plan, operate, own, or trade on the bulk power system. Each dot is one registered entity placed at its headquarters. Color encodes the entity's mix of functional roles; dot size encodes how much grid authority those roles carry. Filter by role, region, organization type, and geocoding confidence, or search by name.

Live: https://willschenk.github.io/nerc-grid-map/

The map is a single Astro page that ships vanilla D3 (no UI framework). Organization data is baked into a static JSON file at build time, so the page just fetches and renders.

## Quick start

```bash
npm install
npm run dev      # builds the data, then serves the map at http://localhost:4321/
npm run build    # builds the data, then the static site into dist/
npm run preview  # preview the production build
npm run check    # astro + TypeScript check
```

`dev` and `build` both run `scripts/nerc/build-orgs.mjs` first (npm `predev` / `prebuild`), so the rendered data is always current with `src/data/nerc/`.

## Data pipeline

Source registry data flows through four steps. Only the geocoding step needs an agent; the rest are plain Node scripts.

```
data/*.csv                         raw NERC Compliance Registry export (Save As CSV)
  -> scripts/nerc/ingest.mjs       normalize to { ncr_id, entity_name, region, roles }
src/data/nerc/ingested-records.json
  -> geocoding agent               add lat/lng + acronym + confidence (see below)
src/data/nerc/geocoded-orgs.json
  -> scripts/nerc/build-orgs.mjs   enrich (weight, color, flags) + copy US basemap
public/nerc/orgs.json              <- the file the map fetches at runtime
  -> scripts/nerc/qa.mjs           validate coordinates, colors, weights, confidence
```

Run it end to end:

```bash
npm run nerc:ingest data/nerc-active-compliance-matrix-functions-2026-05-26.csv
# geocode src/data/nerc/ingested-records.json -> src/data/nerc/geocoded-orgs.json
npm run nerc:build
npm run nerc:qa
```

If `src/data/nerc/geocoded-orgs.json` is absent, `build-orgs.mjs` falls back to the curated `src/data/nerc/seed-orgs.json`, so the map always builds.

### Geocoding and entity search (the agent step)

`scripts/nerc/geocoding-agent-prompt.md` is the full prompt for the agent that locates each entity and finds a short map label. It searches official sites, NERC CORES, FERC eLibrary, EIA-861, SEC EDGAR, state PUC registries, and mapping services for a headquarters address and an official acronym, and falls back to a deterministic estimate so every record gets coordinates. Feed it one ingested record at a time, collect the JSON objects, and write them to `src/data/nerc/geocoded-orgs.json` as `{ "orgs": [ ... ] }`. See also `AGENTS.md`.

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
