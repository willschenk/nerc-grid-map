# NERC Grid Map

## [Open the live map →](https://willschenk.github.io/nerc-grid-map/)

A browser-based map of electric grid organizations in and around the NERC Compliance Registry.

The project turns registry rows into a visual reference: organizations are placed on a map, sized by role weight, colored by reliability-function mix, and labeled for quick scanning. It is meant to make the grid landscape easier to understand than a spreadsheet.

This is not an official NERC product and should not be used as a compliance source of truth.

## What it does

- Ingests public NERC registry data.
- Normalizes entities, reliability functions, labels, aliases, and role weights.
- Adds researched locations from public sources, with confidence notes for review.
- Builds static JSON for an Astro + D3 map hosted on GitHub Pages.

## Run locally

Requires Node.js `>=20.3.0`.

```bash
npm install
npm run dev
```

Other useful commands:

```bash
npm run build      # build the static site
npm run check      # Astro + TypeScript checks
npm run nerc:qa    # data QA checks
npm run deploy     # deploy to GitHub Pages
```

## Data flow

```text
data/*.csv
  -> scripts/nerc/ingest.mjs
src/data/nerc/ingested-records.json
  -> researched location and label data
src/data/nerc/geocoded-orgs.json
  -> scripts/nerc/build-orgs.mjs
public/nerc/orgs.json
  -> browser map
```

## Key files

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
