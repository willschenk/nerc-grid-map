# Cursor research queue — geocode NERC entities one by one

This is the hand-off for researching the remaining NERC registry entities. The MRO
and NPCC regions are essentially done; this queue is everything still missing
coordinates. Work top to bottom — the order is the priority.

## What to do

1. Open **`src/data/nerc/research-queue.jsonl`** — one record per line, already in the
   geocoding prompt's input shape: `{ncr_id, entity_name, region, roles}`.
   (`research-queue.csv` is the same list, human-readable, with an `order` column.)
2. Use **`scripts/nerc/geocoding-agent-prompt.md`** as the system prompt. For each
   queue line, research the entity and produce ONE JSON object per that prompt's
   schema (lat/lng, acronym, city/state, confidence, source, notes…).
3. Append each result object to the `orgs` array in
   **`src/data/nerc/geocoded-orgs.json`**. Do not edit `entity_name`, `roles`, or
   `region` — those come from the authoritative NERC CSV and must be echoed exactly.
4. After every ~25–50 records: `npm run nerc:build && npm run nerc:qa`, then fix any
   warnings (PO boxes, ocean points, region/state conflicts) before continuing.

## Queue size and order

Regenerate any time with `node scripts/nerc/build-research-queue.mjs` (it recomputes
ingested-minus-geocoded, so finished records drop off automatically).

| order | region    | remaining | note |
|------:|-----------|----------:|------|
| 1     | MRO       | 9         | finish the region |
| 2     | NPCC      | 1         | finish the region |
| 3     | RF        | 261       | already partially done — complete it |
| 4     | SERC      | 379       | untouched |
| 5     | Texas RE  | 407       | untouched |
| 6     | WECC      | 579       | untouched |
| **total** | | **1636** | |

## Seeds retire themselves — don't worry about duplicates

The map currently shows ~52 placeholder "seed" entities (PJM, ERCOT, CAISO, the Duke
companies, etc.) with `NCR-SEED-xxx` ids. Many queue rows are the **real registry
twin** of one of those seeds (e.g. `NCR00879` is PJM, `NCR04056` is ERCOT,
`NCR05048` is CAISO). Just geocode the real row normally — **do not** delete or
special-case the seed. `scripts/nerc/build-orgs.mjs` reads
`src/data/nerc/seed-twins.json` and automatically drops a seed once its twin is
geocoded, so there is never a duplicate dot and the entity never disappears
mid-transition. If you discover a new seed↔twin pair, add it to `seed-twins.json`.

## Tips specific to this registry

- Many rows are umbrella registrations: `"<Operator> as agent for A; B; C…"`. Geocode
  the operator's principal office; that one dot represents the whole umbrella.
- EIA-861 / plant-name rows (lots of wind/solar LLCs) are fine to place at the plant
  if no corporate HQ exists — note it and mark MEDIUM. Guessing from the name + region
  is explicitly acceptable; never leave lat/lng null.
- NERC region is the strongest geographic constraint. A found address that contradicts
  the region should downgrade confidence, not override the region.
