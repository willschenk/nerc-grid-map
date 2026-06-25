# Build pipeline (ingest → render → deploy)

How a NERC Compliance Registry export becomes the rendered map. Each stage has a
single responsibility; the renderer never recomputes data the build already
produced (roles, weights, colors, flags, labels).

## Stages

```
registry CSV
  │  npm run nerc:ingest -- data/<registry>.csv
  ▼
src/data/nerc/geocoded-orgs.json        (canonical source rows; falls back to seed-orgs.json)
  │  npm run nerc:build  (scripts/nerc/build-orgs.mjs)
  │    1. applyRegistryRegions → applyNames (org-names.json) → enrichOrg (enrich.mjs)
  │       per registry row: normalized roles, weight, color, classification flags,
  │       and the researched name_shortest/short/normal.
  │    2. applyMapCombines (map-combines.json): fold same-HQ co-registrations into
  │       one canonical bubble; satellites are dropped from the output.
  │    3. loadSupplemental (supplemental-orgs.json): add non-registry orgs (AK/HI,
  │       merchant lines, etc.), each also run through applyNames + enrichOrg.
  │    4. applyAreaAliases (area-aliases.json): attach PJM zone / MISO LBA codes.
  ▼
public/nerc/orgs.json                   (canonical complete output — QA + dev)
  │  split inside build-orgs.mjs:
  ├── public/nerc/orgs-render.json       (only RENDER_ORG_FIELDS — minimal first paint)
  └── public/nerc/org-details.json       (panel-only fields — loaded lazily on select)
  │  astro build  (copies public/ → dist/)
  ▼
the renderer: src/lib/nerc/map/nerc-org-map.ts
  reads orgs-render.json for first paint, fetches org-details.json on demand.
```

## Label precedence (what wins for `name_shortest`)

1. `SHORT_NAME_OVERRIDES` in `enrich.mjs` (entity_name-keyed, authoritative).
2. `shortest` from `org-names.json` (if ≤8 chars; longer needs an override).
3. The org's `acronym`.
4. Algorithmic shortening (`compactDisplayName` in `enrich.mjs`).

Supplemental orgs may also carry their own `name_shortest` in
`supplemental-orgs.json`, which `applyNames` overrides when an org-names entry
exists.

## Checks (run before committing data changes)

```bash
npm run nerc:build        # regenerate payloads from source
npm run nerc:qa           # schema, area-alias conflicts, locations, confidence
npm run nerc:payload-check # canonical vs render vs details counts match
npm run ux-check          # label lengths, casing, collisions (≤8-char mobile rule)
npm run check             # astro/tsc typecheck
```

## Deploy

```bash
npm run deploy            # astro build + scripts/deploy-pages.sh → gh-pages branch
```

`public/nerc/*.json` are generated — never hand-edit them. Change the **source**
(`org-names.json`, `map-combines.json`, `supplemental-orgs.json`,
`area-aliases.json`, or `enrich.mjs`) and re-run `nerc:build`.

## Where to change what

| Want to change… | Edit | Then |
|---|---|---|
| A bubble's short label | `src/data/nerc/org-names.json` (or `SHORT_NAME_OVERRIDES`) | `nerc:build` |
| Fold co-located regs into one bubble | `src/data/nerc/map-combines.json` | `nerc:build` |
| A PJM/MISO area code → org | `src/data/nerc/area-aliases.json` | `nerc:build` + `nerc:qa` |
| Roles / weight / color logic | `src/lib/nerc/enrich.mjs` | `nerc:build` |
| How bubbles/dots/labels render | `src/lib/nerc/map/nerc-org-map.ts` + `.css` | `npm run build` |
