# nerc-grid-map

★ Website: https://willschenk.github.io/nerc-grid-map/

A small interactive map of organizations in the NERC Compliance Registry. NERC publishes the registry as a spreadsheet of entities and reliability functions, but it does not include map-ready coordinates.

This project normalizes the registry, adds researched locations, and builds a static JSON file for an Astro + D3 map. Each dot is one registered entity. Color shows its function mix; size shows a simple role weight.

AI was used to help research locations and short labels from public sources: organization websites, NERC/CORES references, FERC filings, EIA data, SEC filings, state records, market-operator material, and search/map results. The output includes confidence levels and notes. Low-confidence and estimated points are marked for review.

This is not an official NERC product or a compliance source of truth.

## Run

```bash
npm install
npm run dev      # build data, then serve locally
npm run build    # build data and static site
npm run check    # Astro + TypeScript
```

## Data

```text
data/*.csv
  -> scripts/nerc/ingest.mjs
src/data/nerc/ingested-records.json
  -> AI-assisted location research
src/data/nerc/geocoded-orgs.json
  -> scripts/nerc/build-orgs.mjs
public/nerc/orgs.json
  -> browser map
```

Useful commands:

```bash
npm run nerc:ingest data/nerc-active-compliance-matrix-functions-2026-05-26.csv
npm run nerc:build
npm run nerc:qa
```

The research prompt is `scripts/nerc/geocoding-agent-prompt.md`.

## Files

```text
src/pages/index.astro              page markup
src/lib/nerc/map/nerc-org-map.ts   D3 map client
src/lib/nerc/map/nerc-org-map.css  map styles
src/lib/nerc/roles.mjs             role weights, names, colors
src/lib/nerc/enrich.mjs            build-time enrichment
scripts/nerc/                      ingest, build, QA, research prompt
src/data/nerc/                     source and researched records
public/nerc/                       generated map JSON and basemap
```

## Deploy

GitHub Pages serves the `gh-pages` branch.

```bash
npm run deploy
```
