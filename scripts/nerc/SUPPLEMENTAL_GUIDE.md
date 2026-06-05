# Adding supplemental (non-NERC) organizations

This is the playbook for filling in utilities/businesses that are **not in the
NERC Compliance Registry** (or are missing from our NERC extract): Alaska &
Hawaii utilities, community choice aggregators (CCAs), small municipals and
co-ops below the NERC threshold, merchant/IPPs, etc. It's designed so an AI
agent (e.g. Cursor) can do the repetitive geocoding/labeling work safely.

## The pieces

- `src/data/nerc/supplemental-candidates.csv` — the **research queue** (raw list
  of names to consider). Drop new rows here.
- `scripts/nerc/build-supplemental.mjs` — converts new CSV rows into entries in
  the JSON below. **Merge-only**: it never overwrites an entry that already
  exists (matched by name), so your edits are safe. Run:
  `node scripts/nerc/build-supplemental.mjs`
- `src/data/nerc/supplemental-orgs.json` — the **canonical, editable data file**.
  This is what you edit. The site build reads it.
- `scripts/nerc/build-orgs.mjs` — runs on `npm run build`; merges these into
  `public/nerc/orgs.json` (the file the map loads). It dedupes against NERC orgs
  by name and **drops any entry without `lat`/`lng`**.

## The loop (what to repeat)

1. (Optional) Paste new candidate names into `supplemental-candidates.csv`, then
   run `node scripts/nerc/build-supplemental.mjs` to append them as stubs.
2. Open `supplemental-orgs.json`. For each entry where `lat` is `null` (and
   `out_of_footprint` is `false`), fill in `lat`, `lng`, `city`, and refine
   `org_type` / `roles` / `acronym`.
3. Run `node scripts/nerc/build-orgs.mjs` and confirm the count went up and there
   are no warnings about your entry.
4. Repeat. Commit when a batch is done.

## Entry schema (`supplemental-orgs.json`)

```jsonc
{
  "entity_name": "Chugach Electric Association, Inc.", // exact legal/common name
  "acronym": "CEA",            // optional; short label shown on the map dot
  "state": "AK",               // 2-letter
  "city": "Anchorage",         // HQ city (helps the next person)
  "lat": 61.19,                // HQ latitude  (REQUIRED to appear on the map)
  "lng": -149.88,              // HQ longitude (REQUIRED to appear on the map)
  "roles": ["DP"],             // best-effort NERC function tags; [] is fine
  "org_type": "cooperative",   // see "org_type values" below
  "nerc_registered": false,    // leave false for everything here
  "geo_confidence": "MEDIUM",  // HIGH if you verified the HQ, ESTIMATED if rough
  "out_of_footprint": false,   // true for territories (see note)
  "geo_source": "EIA-861 / public utility records",
  "geo_source_url": "https://www.eia.gov/electricity/data/eia861/",
  "geo_notes": "Anchorage-area co-op; largest in the Railbelt."
}
```

### How to geocode (`lat`/`lng`)
Use the organization's **headquarters city** (or main office). City-level decimal
degrees are fine — e.g. Anchorage = `61.19, -149.88`. Set `geo_confidence` to
`HIGH` only if you confirmed the actual HQ; otherwise `MEDIUM`/`ESTIMATED`.
Round to ~4 decimals. Longitude is **negative** in the US.

### `org_type` values (pick the closest)
`ISO_RTO` (don't use — real ones are already NERC), `IOU` (investor-owned, e.g.
"... Electric Company, Inc."), `cooperative` (co-op / "Electric Association" /
EMC), `municipal` (city utility, public utility district, public power agency,
joint-action), `federal`, `merchant` (independent generator, IPP, power
marketer, trader, DER aggregator, wind/solar/storage/geothermal LLC or LP),
`cca` (community choice aggregator), `other`. Dot size is driven by this.

### `roles` (best-effort, optional)
These entities are **not** NERC-registered, so there is no official role. Give a
reasonable functional guess if obvious, else leave `[]`:
- distribution utility / co-op / muni → `["DP"]`
- independent generator (a plant/farm) → `["GO"]`
- CCA / merchant / pure retail → `[]`
Valid tags: `BA RC PC TP TO TOP TSP RP DP GO GOP`. (`LSE`/`PSE` are retired NERC
functions — don't use them.) If `roles` is `[]`, the dot is colored by
`org_type`; if it has roles, it's colored like a NERC org with those roles.

## Rules / gotchas

- **No NERC ID.** Leave `nerc_registered: false`. The build assigns a
  placeholder id (`SUP-<slug>`) for internal use; the map shows "No NERC ID".
- **Don't duplicate NERC orgs.** Before adding, check the org isn't already on the
  map. The candidate CSV's `best_existing_match` / `similarity` columns flag
  likely duplicates (similarity ≥ ~0.9 with the same real entity = skip). The
  build also auto-skips supplemental entries whose name matches an existing NERC
  org, but don't rely on it for near-matches/aliases.
- **U.S. territories don't render yet.** Puerto Rico, Guam, American Samoa, USVI,
  and N. Mariana (`out_of_footprint: true`) cannot be plotted because the map
  uses `geoAlbersUsa` (50 states only). Leave them queued; do **not** invent
  coordinates. (Showing them needs a projection/inset change — a separate task.)
- **Alaska & Hawaii DO render** (Albers USA has insets). Geocode them normally.
- Keep entries sorted/clean; the converter re-sorts by state then name on run.

## Where to find more candidates

- **EIA-861** (annual electric utility report) — the master list of U.S. retail
  utilities, co-ops, munis, and CCAs with IDs and locations:
  https://www.eia.gov/electricity/data/eia861/
- EIA-860 (generators) for merchant plants; FERC market-based-rate sellers for
  marketers. The candidate CSV already seeds AK/HI/territories + a CA/TX/WA
  sample — expand from EIA-861 by state.
