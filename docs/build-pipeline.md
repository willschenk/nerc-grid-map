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
npm run nerc:qa           # schema, area-alias conflicts, PJM/MISO drift guard, locations
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

## Area-code source of truth (PJM / MISO / legacy)

**Where to edit area codes.** Change `src/data/nerc/area-aliases.json`, then
`npm run nerc:build` and `npm run nerc:qa`. Examples:

| Code | Edit in `area-aliases.json` | Typical target |
|------|----------------------------|----------------|
| ALTE, ALTW, MP, AMIL, CIN | `code` + `ncr_id` + `meaning` | MISO LBA org (see renderer list below) |
| CPLE, CPLW, YAD, DUK | same | Legacy BA / successor org (e.g. CPLE → NCR01298) |
| AECO, COMED, DEOK, … | same + **`market: "PJM"`** and **`kind: "transmission_zone"`** | PJM zone org |

**Generated payloads — never hand-edit.** `public/nerc/orgs.json`,
`orgs-render.json`, and `org-details.json` are build output. Area codes land on
orgs as `area_aliases[]` only via `applyAreaAliases` in `build-orgs.mjs`.

**PJM transmission zones — data is canonical.** PJM focus mode derives membership
from each org's built `area_aliases` intersecting
`PJM_TRANSMISSION_ZONE_CODES` in the renderer. Add or fix zone codes in
`area-aliases.json` (with `market` + `kind` as above); do not duplicate
code→org mappings elsewhere.

**MISO LBA codes — two places today (must agree).** MISO focus membership is
still hard-coded in `MISO_CONTROL_AREA_CODES` inside `nerc-org-map.ts`
(`ncr_id` → codes such as ALTE/ALTW/CIN). The same codes must also exist in
`area-aliases.json` pointing at the same `ncr_id`. `npm run nerc:qa` runs
`validateMarketAreaAliases` and fails on drift (e.g. ALTE on the wrong org).
Longer term: collapse MISO membership into one source; until then, edit **both**
files or QA will fail.

**Legacy / project-owner codes.** Verified labels such as CIN, YAD, CPLE, CPLW,
AMIL, ALTE, ALTW are priority evidence per `docs/standards/name-shortest.md`.
Do not rename or re-target them without explicit research; preserve
`allow_acronym_conflict` where APS/AEP/PSEG/NSP/MP already declare it.

**Pricing hubs are not orgs.** `WESTERN HUB` lives in `area-aliases.json`
→ `interfaces`, not `aliases`. Do not promote it to an org alias.

**Logic:** `src/lib/nerc/area-aliases.mjs` (load, apply, validate) ·
**QA:** `scripts/nerc/qa.mjs` step 14/14b ·
**Renderer constants:** `PJM_TRANSMISSION_ZONE_CODES`, `MISO_CONTROL_AREA_CODES`
in `nerc-org-map.ts`.
